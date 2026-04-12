import logging
import threading
import time
import traceback
import uuid
from datetime import datetime, timezone
from typing import Optional, List

import io
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from auth.dependencies import get_current_user
from config.database import execute_sql
from models.schemas import (
    DisambiguateRequest,
    DisambiguateResponse,
    EnhancedFeedbackRequest,
    ExecuteRequest,
    ExecuteResponse,
    HistoryResponse,
    MCQAnswerRequest,
    MCQOption,
    MCQQuestion,
    ModelSwitchRequest,
    ModelSwitchResponse,
    QueryRequest,
    QueryResponse,
    SessionsResponse,
)
from pydantic import BaseModel
from services import llm_service, mcq_service, memory_service
from config.settings import settings

log = logging.getLogger("text2sql")

router = APIRouter()
QUERY_WINDOW_SECONDS = 120
QUERY_WINDOW_LIMIT = 20
_QUERY_ACTIVITY: dict[str, list[float]] = {}
_RATE_LOCK = threading.Lock()


def _enforce_query_rate_limit(session_id: str):
    with _RATE_LOCK:
        now = time.time()
        window_start = now - QUERY_WINDOW_SECONDS
        history = [ts for ts in _QUERY_ACTIVITY.get(session_id, []) if ts >= window_start]
        if len(history) >= QUERY_WINDOW_LIMIT:
            raise HTTPException(
                status_code=429,
                detail=(
                    f"Too many SQL generations for session '{session_id}'. "
                    f"Limit is {QUERY_WINDOW_LIMIT} per {QUERY_WINDOW_SECONDS} seconds."
                ),
            )
        history.append(now)
        _QUERY_ACTIVITY[session_id] = history
        # Prune sessions that have gone idle to prevent unbounded dict growth
        idle = [sid for sid, ts_list in _QUERY_ACTIVITY.items() if not ts_list]
        for sid in idle:
            del _QUERY_ACTIVITY[sid]


def _resolve_database_id(current_user: dict, req_database_id: str = None) -> str:
    """Super admin uses request body database_id; others use their user record."""
    if current_user["role"] == "super_admin":
        return req_database_id or "degreefyd_online_lms"
    return str(current_user["database_id"]) if current_user.get("database_id") else "degreefyd_online_lms"


@router.post("/query", response_model=QueryResponse)
def process_query(req: QueryRequest, current_user: dict = Depends(get_current_user)):
    start_time = time.time()

    if req.user_query.strip() == "":
        raise HTTPException(status_code=400, detail="user_query is required.")

    _enforce_query_rate_limit(req.session_id)

    req_model = req.model or llm_service.get_active_model()
    if req.model and req.model not in llm_service.ALLOWED_MODELS:
        raise HTTPException(status_code=400, detail=f"Invalid model. Allowed: {llm_service.ALLOWED_MODELS}")

    database_id = _resolve_database_id(current_user, req.database_id)
    user_id = str(current_user["id"])

    log.info("QUERY user=%s session=%s query=%r model=%s", current_user["username"], req.session_id, req.user_query[:100], req_model)

    session_history = memory_service.format_session_for_prompt(req.session_id)
    session = memory_service.get_session(req.session_id)
    turns_count = len(session.get("turns", []))
    should_show_context_alert = turns_count >= 5

    try:
        generated_sql, thoughts, sql_usage = llm_service.generate_sql(
            user_query=req.user_query,
            session_history=session_history,
            learned_rules="",
            model=req_model,
            thinking_enabled=req.thinking_enabled,
            thinking_level=req.thinking_level,
            include_thoughts=req.include_thoughts,
            lms_type=database_id,
        )

    except Exception as e:
        traceback.print_exc()
        log.error("SQL generation failed: %s", str(e))
        fid = memory_service.save_feedback(
            session_id=req.session_id, user_query=req.user_query,
            error_message=f"SQL generation failed: {str(e)}",
            chat_id=req.chat_id or "", user_id=user_id, lms_type=database_id, model=req_model,
            user_name=current_user.get("full_name"), user_email=current_user.get("email"),
            user_role=current_user.get("role"),
            user_msg_id=req.user_msg_id
        )

        _emsg = str(e)
        if "429" in _emsg or "RESOURCE_EXHAUSTED" in _emsg:
            raise HTTPException(status_code=429, detail="LLM quota exhausted. Please wait and retry.")
        raise HTTPException(status_code=500, detail=f"Failed to generate SQL: {str(e)}")

    if not llm_service.validate_sql(generated_sql):
        fid = memory_service.save_feedback(
            session_id=req.session_id, user_query=req.user_query, generated_sql=generated_sql,
            error_message="Security block: non-read-only SQL generated.",
            chat_id=req.chat_id or "", user_id=user_id, lms_type=database_id, model=req_model,
            user_name=current_user.get("full_name"), user_email=current_user.get("email"),
            user_role=current_user.get("role"),
            user_msg_id=req.user_msg_id
        )

        raise HTTPException(status_code=403, detail={
            "message": "Generated SQL is not read-only. Operation blocked.",
            "sql": generated_sql, "feedback_id": fid,
        })

    chat_id = req.chat_id
    chat_id = req.chat_id
    if not chat_id:
        chat_id = str(uuid.uuid4())
        log.warning("Frontend did not provide chat_id. Falling back to generated ID: %s", chat_id)
        req.session_id = chat_id

    execution_time = round(time.time() - start_time, 3)
    fid = memory_service.save_feedback(
        session_id=req.session_id, user_query=req.user_query, generated_sql=generated_sql,
        execution_time=execution_time, chat_id=req.chat_id or "",
        user_id=user_id, lms_type=database_id, model=req_model,
        user_name=current_user.get("full_name"), user_email=current_user.get("email"),
        user_role=current_user.get("role"),
        token_usage=sql_usage,
        thoughts=thoughts,
        user_msg_id=req.user_msg_id,
        lms_id=req.lms_id
    )

    _token_usage = {'model': req_model, **sql_usage} if sql_usage else None
    return QueryResponse(
        feedback_id=fid, 
        session_id=req.session_id, 
        chat_id=chat_id,
        sql=generated_sql,
        execution_time=execution_time, 
        cached=False, 
        executed=False,
        session_context_alert="⚠️ Session context limited to last 5 queries" if should_show_context_alert else None,
        token_usage=_token_usage, 
        thoughts=thoughts
    )

    if not req.execute:
        _token_usage = {'model': req_model, **sql_usage} if sql_usage else None
        return QueryResponse(
            feedback_id=fid, session_id=req.session_id, sql=generated_sql,
            execution_time=execution_time, cached=False, executed=False,
            session_context_alert="⚠️ Session context limited to last 5 queries" if should_show_context_alert else None,
            token_usage=_token_usage, thoughts=thoughts
        )

    results = []
    sql_auto_fixed = False
    sql_error: str | None = None

    try:
        results = execute_sql(generated_sql, database_id)
    except Exception as sql_err:
        original_error = str(sql_err)
        log.warning("SQL execution failed, attempting auto-fix. Error: %s", original_error[:200])
        fixed_sql = llm_service.auto_fix_sql(req.user_query, generated_sql, original_error, model=req_model, lms_type=database_id)

        if fixed_sql and llm_service.validate_sql(fixed_sql):
            generated_sql = fixed_sql
            sql_auto_fixed = True
            try:
                results = execute_sql(generated_sql, database_id)
                sql_error = None  # fix worked — clear the error
            except Exception as e2:
                # Auto-fixed SQL also failed — return a graceful error response so user can see
                # the SQL and use "Fix via English" rather than a blind 500
                final_error = str(e2)
                log.error("Auto-fixed SQL also failed: %s", final_error)
                fid = memory_service.save_feedback(
                    session_id=req.session_id, user_query=req.user_query, generated_sql=generated_sql,
                    error_message=f"[auto-fix attempt] {final_error}", chat_id=req.chat_id or "",
                    user_id=user_id, lms_type=database_id, model=req_model,
                    user_name=current_user.get("name"), user_email=current_user.get("email"),
                )

                _token_usage = {'model': req_model, **sql_usage} if sql_usage else None
                return QueryResponse(
                    feedback_id=fid, session_id=req.session_id, sql=generated_sql,
                    answer=f"The query ran into a database error even after an automatic fix attempt.\n\n**Error:** `{final_error}`\n\nYou can describe what's wrong using **Fix via English** to help me correct it.",
                    chart_type=None, data=None,
                    execution_time=round(time.time() - start_time, 3), cached=False, executed=False,
                    sql_auto_fixed=True, sql_error=final_error,
                    session_context_alert="⚠️ Session context limited to last 5 queries" if should_show_context_alert else None,
                    token_usage=_token_usage,
                )
        else:
            # Auto-fix couldn't produce valid SQL — return graceful error response
            log.error("Auto-fix did not produce valid SQL. Original error: %s", original_error)
            fid = memory_service.save_feedback(
                session_id=req.session_id, user_query=req.user_query, generated_sql=generated_sql,
                error_message=original_error, chat_id=req.chat_id or "",
                user_id=user_id, lms_type=database_id, model=req_model,
                user_name=current_user.get("name"), user_email=current_user.get("email"),
            )

            _token_usage = {'model': req_model, **sql_usage} if sql_usage else None
            return QueryResponse(
                feedback_id=fid, session_id=req.session_id, sql=generated_sql,
                answer=f"The generated SQL failed to execute and the automatic fix attempt couldn't resolve it.\n\n**Error:** `{original_error}`\n\nYou can describe what's wrong using **Fix via English** to help me correct it.",
                chart_type=None, data=None,
                execution_time=round(time.time() - start_time, 3), cached=False, executed=False,
                sql_auto_fixed=False, sql_error=original_error,
                session_context_alert="⚠️ Session context limited to last 5 queries" if should_show_context_alert else None,
                token_usage=_token_usage,
            )

    ans_usage = {}
    try:
        answer, chart_type, ans_usage = llm_service.generate_answer(req.user_query, results, model=req_model)
    except Exception:
        answer = f"Query returned {len(results)} rows."
        chart_type = "Table"

    _total_input = (sql_usage or {}).get('input_tokens', 0) + ans_usage.get('input_tokens', 0)
    _total_output = (sql_usage or {}).get('output_tokens', 0) + ans_usage.get('output_tokens', 0)
    _token_usage = {'model': req_model, 'input_tokens': _total_input, 'output_tokens': _total_output}

    memory_service.update_session_turn(req.session_id, fid, generated_sql, answer)

    return QueryResponse(
        feedback_id=res.feedback_id,
        session_id=res.session_id,
        sql=res.sql,
        answer=res.answer,
        chart_type=res.chart_type,
        data=res.data,
        execution_time=res.execution_time,
        cached=False,
        executed=True,
        token_usage=res.token_usage,
        thoughts=res.thoughts,
        session_context_alert="⚠️ Session context limited to last 5 queries" if should_show_context_alert else None
    )


@router.post("/execute", response_model=ExecuteResponse)
def execute_query(req: ExecuteRequest, current_user: dict = Depends(get_current_user)):
    if not llm_service.validate_sql(req.sql):
        raise HTTPException(status_code=403, detail="Non-read-only SQL blocked.")

    database_id = _resolve_database_id(current_user, req.database_id)
    user_id = str(current_user["id"])
    start_time = time.time()

    results = []
    sql_auto_fixed = False
    sql_err_msg = None

    try:
        results = execute_sql(req.sql, database_id)
    except Exception as sql_err:
        original_error = str(sql_err)
        log.warning("SQL execution failed, attempting auto-fix. Error: %s", original_error[:200])
        fixed_sql = llm_service.auto_fix_sql(req.original_query or req.sql, req.sql, original_error, model=req.model, lms_type=lms_type)

        if fixed_sql and llm_service.validate_sql(fixed_sql):
            try:
                results = execute_sql(fixed_sql, lms_type)
                req.sql = fixed_sql
                sql_auto_fixed = True
            except Exception as e2:
                sql_err_msg = str(e2)
        else:
            sql_err_msg = original_error

    execution_time = round(time.time() - start_time, 3)
    _exec_model = req.model or llm_service.get_active_model()
    _exec_ans_usage = {}
    _exec_thoughts = ""
    
    if sql_err_msg:
        answer = f"The query failed with an error: `{sql_err_msg}`. You can try refining your question."
        chart_type = "Table"
        total_rows = len(results)
        truncated_results = results[:settings.DATA_LIMIT]
    else:
        try:
            total_rows = len(results)
            truncated_results = results[:settings.DATA_LIMIT]
            
            answer, chart_type, _exec_thoughts, _exec_ans_usage = llm_service.generate_answer(
                user_query=req.original_query,
                data=truncated_results,
                total_rows=total_rows,
                model=_exec_model
            )
        except Exception as e:
            import traceback
            log.error("Failed to generate answer from results: %s\n%s", e, traceback.format_exc())
            answer = f"The query was successful ({len(results)} rows), but I failed to generate a summary."
            chart_type = "Table"
            truncated_results = results[:500]
            total_rows = len(results)
            _exec_ans_usage = {}
            _exec_thoughts = ""

    

    fid = memory_service.save_feedback(
        session_id=req.session_id, user_query=req.original_query or req.sql, generated_sql=req.sql,
        answer=answer, chart_type=chart_type, data=truncated_results, # Save truncated data to avoid blowing up DB/Memory
        execution_time=execution_time, 
        chat_id=req.chat_id or "", user_id=user_id, lms_type=lms_type, model=_exec_model,
        user_name=current_user.get("full_name"), user_email=current_user.get("email"),
        user_role=current_user.get("role"),
        token_usage=_exec_ans_usage,
        thoughts=_exec_thoughts or req.thoughts,
        sql_auto_fixed=sql_auto_fixed,
        sql_error=sql_err_msg,
        existing_feedback_id=req.feedback_id,
        lms_id=req.lms_id,
        extra={"total_rows": total_rows} 
    )

    _exec_token_usage = {'model': _exec_model, **_exec_ans_usage} if _exec_ans_usage else None
    return ExecuteResponse(
        answer=answer, chart_type=chart_type, data=truncated_results,
        execution_time=execution_time, feedback_id=fid,
        sql=req.sql, session_id=req.session_id,
        token_usage=_exec_token_usage,
            thoughts=_exec_thoughts or req.thoughts,
        total_rows=total_rows 
    )


class ExportRequest(BaseModel):
    sql: str
    lms_type: Optional[str] = None
    filename: Optional[str] = "query_results.xlsx"


@router.post("/export-excel")
def export_excel(req: ExportRequest, current_user: dict = Depends(get_current_user)):
    """Expert full result set to Excel directly from backend to avoid frontend freezes."""
    try:
        lms_type = _resolve_lms_type(current_user, req.lms_type)
        results = execute_sql(req.sql, lms_type, apply_limit=False)
        
        if not results:
            raise HTTPException(status_code=404, detail="No data found for export.")

        df = pd.DataFrame(results)

        # Excel does not support timezone-aware datetimes. Convert them to timezone-unaware.
        for col in df.select_dtypes(include=['datetimetz']).columns:
            df[col] = df[col].dt.tz_localize(None)
        
        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, index=False, sheet_name='Results')
        
        output.seek(0)
        
        headers = {
            'Content-Disposition': f'attachment; filename="{req.filename}"'
        }
        
        return StreamingResponse(
            output, 
            headers=headers, 
            media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
    except Exception as e:
        log.error("Deep export failed: %s", e)
        print(f"❌ Export error: {e}")
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")


@router.get("/history", response_model=HistoryResponse)
def get_history(current_user: dict = Depends(get_current_user)):
    data = memory_service.get_history(limit=50)
    return HistoryResponse(success=True, data=data)


@router.post("/config/model", response_model=ModelSwitchResponse)
def switch_model(req: ModelSwitchRequest, _: dict = Depends(get_current_user)):
    try:
        active = llm_service.set_active_model(req.model)
        return ModelSwitchResponse(active_model=active)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/config/model", response_model=ModelSwitchResponse)
def get_model(_: dict = Depends(get_current_user)):
    return ModelSwitchResponse(active_model=llm_service.get_active_model())


@router.get("/sessions", response_model=SessionsResponse)
def get_all_sessions(_: dict = Depends(get_current_user)):
    return SessionsResponse(success=True, sessions={})


@router.get("/students/latest")
def get_latest_students(current_user: dict = Depends(get_current_user)):
    database_id = _resolve_database_id(current_user)
    try:
        sql = "SELECT student_name, created_at FROM students ORDER BY created_at DESC LIMIT 10"
        results = execute_sql(sql, database_id)
        return {"success": True, "students": results}
    except Exception as e:
        log.error("Failed to fetch latest students: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to fetch students: {str(e)}")


# ─────────────────────────── MCQ DISAMBIGUATION ──────────────────────────────

def _validate_model(model: str | None) -> str:
    req_model = model or llm_service.get_active_model()
    if model and model not in llm_service.ALLOWED_MODELS:
        raise HTTPException(status_code=400, detail=f"Invalid model. Allowed: {llm_service.ALLOWED_MODELS}")
    return req_model


def _generate_and_respond(
    user_query: str,
    session_id: str,
    chat_id: str,
    extra_context: str,
    req_model: str,
    execute: bool,
    start_time: float,
    database_id: str,
    user_id: str,
    current_user: dict,
    mcq_questions: list = None, mcq_answers: list = None,
    actual_llm_query: str = None,
    user_msg_id: str = None,
    lms_id: str = None
) -> QueryResponse:
    thoughts = ""
    sql_usage = {}
    actual_query = actual_llm_query or user_query
    
    session_history = memory_service.format_session_for_prompt(session_id)
    session = memory_service.get_session(session_id)
    turns_count = len(session.get("turns", []))
    should_show_context_alert = turns_count >= 5

    try:
        generated_sql, thoughts, sql_usage = llm_service.generate_sql(
            user_query=user_query, session_history=session_history,
            learned_rules="", model=req_model, lms_type=database_id,
            extra_context=extra_context,
        )
    except Exception as e:
        traceback.print_exc()
        fid = memory_service.save_feedback(
            session_id=session_id, user_query=user_query,
            error_message=f"SQL generation failed: {str(e)}", chat_id=chat_id,
            mcq_questions=mcq_questions, mcq_answers=mcq_answers,
            user_id=user_id, lms_type=database_id, model=req_model,
            user_name=current_user.get("name"), user_email=current_user.get("email"),
        )
        raise HTTPException(status_code=500, detail=f"Failed to generate SQL: {str(e)}")

    if not llm_service.validate_sql(generated_sql):
        fid = memory_service.save_feedback(
            session_id=session_id, user_query=user_query, generated_sql=generated_sql,
            error_message="Security block: non-read-only SQL generated.", chat_id=chat_id,
            mcq_questions=mcq_questions, mcq_answers=mcq_answers,
            user_id=user_id, lms_type=database_id, model=req_model,
            user_name=current_user.get("name"), user_email=current_user.get("email"),
        )
        raise HTTPException(status_code=403, detail="Non-read-only SQL generated.")

    if not chat_id:
        chat_id = str(uuid.uuid4())
        log.info("Generating new Chat ID (MCQ context): %s", chat_id)

    execution_time = round(time.time() - start_time, 3)
    fid = memory_service.save_feedback(
        session_id=session_id, user_query=user_query, generated_sql=generated_sql,
        execution_time=execution_time, chat_id=chat_id,
        mcq_questions=mcq_questions, mcq_answers=mcq_answers,
        user_id=user_id, lms_type=database_id, model=req_model,
        user_name=current_user.get("name"), user_email=current_user.get("email"),
        token_usage=sql_usage,
        thoughts=thoughts,
        is_mcq_answer=True,
        user_msg_id=user_msg_id,
        lms_id=lms_id
    )

    if not execute:
        _token_usage = {'model': req_model, **sql_usage} if sql_usage else None
        return QueryResponse(
            feedback_id=fid, session_id=session_id, chat_id=chat_id, sql=generated_sql,
            execution_time=execution_time, cached=False, executed=False,
            session_context_alert="⚠️ Session context limited to last 5 queries" if should_show_context_alert else None,
            token_usage=_token_usage, thoughts=thoughts
        )

    results = []
    sql_auto_fixed = False

    try:
        results = execute_sql(generated_sql, database_id)
    except Exception as sql_err:
        original_error = str(sql_err)
        log.warning("SQL execution failed in MCQ/feedback path, attempting auto-fix. Error: %s", original_error[:200])
        fixed_sql = llm_service.auto_fix_sql(user_query, generated_sql, original_error, model=req_model, lms_type=database_id)

        if fixed_sql and llm_service.validate_sql(fixed_sql):
            generated_sql = fixed_sql
            sql_auto_fixed = True
            try:
                results = execute_sql(generated_sql, database_id)
            except Exception as e2:
                final_error = str(e2)
                log.error("Auto-fixed SQL also failed in MCQ/feedback path: %s", final_error)
                fid2 = memory_service.save_feedback(
                    session_id=session_id, user_query=user_query, generated_sql=generated_sql,
                    error_message=f"[auto-fix attempt] {final_error}", chat_id=chat_id,
                    mcq_questions=mcq_questions, mcq_answers=mcq_answers,
                    user_id=user_id, lms_type=database_id, model=req_model,
                    user_name=current_user.get("name"), user_email=current_user.get("email"),
                )

                _token_usage = {'model': req_model, **sql_usage} if sql_usage else None
                return QueryResponse(
                    feedback_id=fid2, session_id=session_id, sql=generated_sql,
                    answer=f"The query ran into a database error even after an automatic fix attempt.\n\n**Error:** `{final_error}`\n\nYou can describe what's wrong using **Fix via English** to help me correct it.",
                    chart_type=None, data=None,
                    execution_time=round(time.time() - start_time, 3), cached=False, executed=False,
                    sql_auto_fixed=True, sql_error=final_error,
                    session_context_alert="⚠️ Session context limited to last 5 queries" if should_show_context_alert else None,
                    token_usage=_token_usage,
                )
        else:
            log.error("Auto-fix did not produce valid SQL in MCQ/feedback path. Original error: %s", original_error)
            fid2 = memory_service.save_feedback(
                session_id=session_id, user_query=user_query, generated_sql=generated_sql,
                error_message=original_error, chat_id=chat_id,
                mcq_questions=mcq_questions, mcq_answers=mcq_answers,
                user_id=user_id, lms_type=database_id, model=req_model,
                user_name=current_user.get("name"), user_email=current_user.get("email"),
            )

            _token_usage = {'model': req_model, **sql_usage} if sql_usage else None
            return QueryResponse(
                feedback_id=fid2, session_id=session_id, sql=generated_sql,
                answer=f"The generated SQL failed to execute and the automatic fix attempt couldn't resolve it.\n\n**Error:** `{original_error}`\n\nYou can describe what's wrong using **Fix via English** to help me correct it.",
                chart_type=None, data=None,
                execution_time=round(time.time() - start_time, 3), cached=False, executed=False,
                sql_auto_fixed=False, sql_error=original_error,
                session_context_alert="⚠️ Session context limited to last 5 queries" if should_show_context_alert else None,
                token_usage=_token_usage,
            )

    ans_usage = {}
    try:
        answer, chart_type, ans_usage = llm_service.generate_answer(user_query, results, model=req_model)
    except Exception:
        answer = f"Query returned {len(results)} rows."
        chart_type = "Table"

    _total_input = (sql_usage or {}).get('input_tokens', 0) + ans_usage.get('input_tokens', 0)
    _total_output = (sql_usage or {}).get('output_tokens', 0) + ans_usage.get('output_tokens', 0)
    _token_usage = {'model': req_model, 'input_tokens': _total_input, 'output_tokens': _total_output}
    memory_service.update_session_turn(session_id, fid, generated_sql, answer)

    return QueryResponse(
        feedback_id=res.feedback_id,
        session_id=res.session_id,
        chat_id=chat_id,
        sql=res.sql,
        answer=res.answer,
        chart_type=res.chart_type,
        data=res.data,
        execution_time=res.execution_time,
        cached=False,
        executed=True,
        token_usage=res.token_usage,
        thoughts=res.thoughts,
        session_context_alert="⚠️ Session context limited to last 5 queries" if should_show_context_alert else None
    )


@router.post("/disambiguate", response_model=DisambiguateResponse)
def disambiguate_query(req: DisambiguateRequest, current_user: dict = Depends(get_current_user)):
    _enforce_query_rate_limit(req.session_id)
    
    if (current_user.get("role") or "").lower() == "counsellor":
        raise HTTPException(status_code=403, detail="Counsellors do not have access to SQL disambiguation.")
        
    req_model = _validate_model(req.model)
    user_id = str(current_user["id"])

    log.info("DISAMBIGUATE session=%s query=%r", req.session_id, req.user_query[:100])

    session_history = memory_service.format_session_for_prompt(req.session_id)
    database_id_for_disambig = _resolve_database_id(current_user, req.database_id)
    questions, error = mcq_service.generate_mcqs(req.user_query, session_history, model=req_model, lms_type=database_id_for_disambig)

    if error or not questions:
        raise HTTPException(status_code=500, detail=f"Failed to generate MCQs: {error or 'empty response'}")

    query_id = str(uuid.uuid4())
    chat_id = req.chat_id
    if not chat_id:
        chat_id = str(uuid.uuid4())
        log.info("Generating new Chat ID (Disambiguate): %s", chat_id)
    
    mcq_msg_id = f"m-{uuid.uuid4()}"
    memory_service.save_mcq_step(
        chat_id=chat_id, 
        session_id=req.session_id, 
        query_id=query_id, 
        user_query=req.user_query, 
        questions=questions, 
        model=req_model,
        user_id=user_id,
        msg_id=mcq_msg_id,
        user_msg_id=req.user_msg_id,
        lms_id=req.lms_id
    )

    memory_service.store_query_context(query_id, {
        "original_query": req.user_query,
        "questions": questions,
        "session_id": req.session_id,
        "chat_id": req.chat_id or "",
        "user_id": str(current_user["id"]),
        "database_id": _resolve_database_id(current_user, req.database_id),
    })

    return DisambiguateResponse(
        query_id=query_id,
        session_id=req.session_id,
        chat_id=chat_id,
        mcq_msg_id=mcq_msg_id,
        questions=[
            MCQQuestion(
                question_id=q["question_id"],
                question_text=q["question_text"],
                options=[MCQOption(label=o["label"], text=o["text"]) for o in q["options"]],
            )
            for q in questions
        ],
        original_query=req.user_query,
    )


@router.post("/answer-mcq", response_model=QueryResponse)
def answer_mcq(req: MCQAnswerRequest, current_user: dict = Depends(get_current_user)):
    start_time = time.time()

    ctx = memory_service.get_query_context(req.query_id)
    if not ctx:
        raise HTTPException(status_code=404, detail="Query context not found or expired. Please start a new query.")

    if (current_user.get("role") or "").lower() == "counsellor":
        raise HTTPException(status_code=403, detail="Counsellors do not have access to SQL-based MCQ answering.")

    questions = ctx["questions"]
    original_query = ctx["original_query"]
    session_id = ctx["session_id"]
    chat_id = req.chat_id or ctx.get("chat_id", "")
    database_id = ctx.get("database_id") or _resolve_database_id(current_user)
    user_id = str(current_user["id"])

    if len(req.answers) != len(questions):
        raise HTTPException(status_code=400, detail=f"Expected {len(questions)} answers, got {len(req.answers)}.")

    _enforce_query_rate_limit(session_id)
    req_model = _validate_model(req.model)

    memory_service.update_query_context(req.query_id, {"answers": req.answers})
    enhanced_context = mcq_service.build_enhanced_context(original_query, questions, req.answers)

    return _generate_and_respond(
        user_query=original_query, session_id=session_id, chat_id=chat_id,
        extra_context=enhanced_context, req_model=req_model, execute=req.execute,
        start_time=start_time, database_id=database_id, user_id=user_id,
        current_user=current_user,
        mcq_questions=questions, mcq_answers=req.answers,
        user_msg_id=ctx.get("user_msg_id"),
        lms_id=req.lms_id or ctx.get("lms_id")
    )


@router.post("/english-feedback", response_model=QueryResponse)
def english_feedback(req: EnhancedFeedbackRequest, current_user: dict = Depends(get_current_user)):
    start_time = time.time()

    ctx = memory_service.get_query_context(req.query_id)
    if not ctx:
        raise HTTPException(status_code=404, detail="Query context not found or expired. Please start a new query.")

    if (current_user.get("role") or "").lower() == "counsellor":
        raise HTTPException(status_code=403, detail="Counsellors do not have access to SQL-based feedback.")

    original_query = ctx["original_query"]
    session_id = ctx["session_id"]
    chat_id = req.chat_id or ctx.get("chat_id", "")
    questions = ctx.get("questions")
    answers = ctx.get("answers")
    database_id = ctx.get("database_id") or _resolve_database_id(current_user)
    user_id = str(current_user["id"])

    _enforce_query_rate_limit(session_id)
    req_model = _validate_model(req.model)

    feedback_context = mcq_service.build_feedback_context(original_query, questions, answers, req.feedback)

    return _generate_and_respond(
        user_query=req.feedback,
        session_id=session_id, chat_id=chat_id,
        extra_context=feedback_context, req_model=req_model, execute=req.execute,
        start_time=start_time, database_id=database_id, user_id=user_id,
        current_user=current_user,
        mcq_questions=questions, mcq_answers=answers,
        actual_llm_query=original_query,
        user_msg_id=ctx.get("user_msg_id"),
        lms_id=req.lms_id or ctx.get("lms_id")
    )
