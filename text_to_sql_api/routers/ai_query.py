import logging
import threading
import time
import traceback
import uuid

from fastapi import APIRouter, Depends, HTTPException

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
from services import llm_service, mcq_service, memory_service

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


def _resolve_lms_type(current_user: dict, req_lms_type: str = None) -> str:
    """Super admin uses request body lms_type; others use their user record."""
    if current_user["role"] == "super_admin":
        return req_lms_type or "online"
    return str(current_user["lms_type"]) if current_user["lms_type"] else "online"


@router.post("/query", response_model=QueryResponse)
def process_query(req: QueryRequest, current_user: dict = Depends(get_current_user)):
    start_time = time.time()

    if req.user_query.strip() == "":
        raise HTTPException(status_code=400, detail="user_query is required.")

    _enforce_query_rate_limit(req.session_id)

    req_model = req.model or llm_service.get_active_model()
    if req.model and req.model not in llm_service.ALLOWED_MODELS:
        raise HTTPException(status_code=400, detail=f"Invalid model. Allowed: {llm_service.ALLOWED_MODELS}")

    lms_type = _resolve_lms_type(current_user, req.lms_type)
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
            lms_type=lms_type,
        )

    except Exception as e:
        traceback.print_exc()
        log.error("SQL generation failed: %s", str(e))
        fid = memory_service.save_feedback(
            session_id=req.session_id, user_query=req.user_query,
            error_message=f"SQL generation failed: {str(e)}",
            chat_id=req.chat_id or "", user_id=user_id, lms_type=lms_type, model=req_model,
            user_name=current_user.get("full_name"), user_email=current_user.get("email"),
            user_role=current_user.get("role"),
        )


        _emsg = str(e)
        if "429" in _emsg or "RESOURCE_EXHAUSTED" in _emsg:
            raise HTTPException(status_code=429, detail="LLM quota exhausted. Please wait and retry.")
        raise HTTPException(status_code=500, detail=f"Failed to generate SQL: {str(e)}")

    if not llm_service.validate_sql(generated_sql):
        fid = memory_service.save_feedback(
            session_id=req.session_id, user_query=req.user_query, generated_sql=generated_sql,
            error_message="Security block: non-read-only SQL generated.",
            chat_id=req.chat_id or "", user_id=user_id, lms_type=lms_type, model=req_model,
            user_name=current_user.get("full_name"), user_email=current_user.get("email"),
            user_role=current_user.get("role"),
        )

        raise HTTPException(status_code=403, detail={
            "message": "Generated SQL is not read-only. Operation blocked.",
            "sql": generated_sql, "feedback_id": fid,
        })

    execution_time = round(time.time() - start_time, 3)
    fid = memory_service.save_feedback(
        session_id=req.session_id, user_query=req.user_query, generated_sql=generated_sql,
        execution_time=execution_time, chat_id=req.chat_id or "",
        user_id=user_id, lms_type=lms_type, model=req_model,
        user_name=current_user.get("full_name"), user_email=current_user.get("email"),
        user_role=current_user.get("role"),
    )


    if not req.execute:
        _token_usage = {'model': req_model, **sql_usage} if sql_usage else None
        return QueryResponse(
            feedback_id=fid, session_id=req.session_id, sql=generated_sql,
            execution_time=execution_time, cached=False, executed=False,
            session_context_alert="⚠️ Session context limited to last 5 queries" if should_show_context_alert else None,
            token_usage=_token_usage,
        )

    results = []
    sql_auto_fixed = False
    sql_error: str | None = None

    try:
        results = execute_sql(generated_sql, lms_type)
    except Exception as sql_err:
        original_error = str(sql_err)
        log.warning("SQL execution failed, attempting auto-fix. Error: %s", original_error[:200])
        fixed_sql = llm_service.auto_fix_sql(req.user_query, generated_sql, original_error, model=req_model, lms_type=lms_type)

        if fixed_sql and llm_service.validate_sql(fixed_sql):
            generated_sql = fixed_sql
            sql_auto_fixed = True
            try:
                results = execute_sql(generated_sql, lms_type)
                sql_error = None  # fix worked — clear the error
            except Exception as e2:
                # Auto-fixed SQL also failed — return a graceful error response so user can see
                # the SQL and use "Fix via English" rather than a blind 500
                final_error = str(e2)
                log.error("Auto-fixed SQL also failed: %s", final_error)
                fid = memory_service.save_feedback(
                    session_id=req.session_id, user_query=req.user_query, generated_sql=generated_sql,
                    error_message=f"[auto-fix attempt] {final_error}", chat_id=req.chat_id or "",
                    user_id=user_id, lms_type=lms_type, model=req_model,
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
                user_id=user_id, lms_type=lms_type, model=req_model,
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
        feedback_id=fid, session_id=req.session_id, sql=generated_sql,
        answer=answer, chart_type=chart_type, data=results,
        execution_time=execution_time, cached=False, executed=True,
        sql_auto_fixed=sql_auto_fixed,
        session_context_alert="⚠️ Session context limited to last 5 queries" if should_show_context_alert else None,
        token_usage=_token_usage,
    )


@router.post("/execute", response_model=ExecuteResponse)
def execute_query(req: ExecuteRequest, current_user: dict = Depends(get_current_user)):
    if not llm_service.validate_sql(req.sql):
        raise HTTPException(status_code=403, detail="Non-read-only SQL blocked.")

    lms_type = _resolve_lms_type(current_user, req.lms_type)
    user_id = str(current_user["id"])
    start_time = time.time()

    try:
        results = execute_sql(req.sql, lms_type)
    except Exception as sql_err:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"SQL execution failed: {str(sql_err)}")

    execution_time = round(time.time() - start_time, 3)
    _exec_model = req.model or llm_service.get_active_model()
    _exec_ans_usage = {}
    try:
        answer, chart_type, _exec_ans_usage = llm_service.generate_answer(
            req.original_query or req.sql, results, model=_exec_model,
        )
    except Exception:
        answer = f"Query returned {len(results)} rows."
        chart_type = "Table"

    _exec_token_usage = {'model': _exec_model, **_exec_ans_usage} if _exec_ans_usage else None
    return ExecuteResponse(
        answer=answer, chart_type=chart_type, data=results,
        execution_time=execution_time, feedback_id=req.feedback_id,
        token_usage=_exec_token_usage,
    )


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
    lms_type = _resolve_lms_type(current_user)
    try:
        sql = "SELECT student_name, created_at FROM students ORDER BY created_at DESC LIMIT 10"
        results = execute_sql(sql, lms_type)
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
    lms_type: str,
    user_id: str,
    current_user: dict,
    mcq_questions: list = None,
    mcq_answers: list = None,
) -> QueryResponse:
    session_history = memory_service.format_session_for_prompt(session_id)
    session = memory_service.get_session(session_id)
    turns_count = len(session.get("turns", []))
    should_show_context_alert = turns_count >= 5

    try:
        generated_sql, thoughts, sql_usage = llm_service.generate_sql(
            user_query=user_query, session_history=session_history,
            learned_rules="", model=req_model, lms_type=lms_type,
            extra_context=extra_context,
        )
    except Exception as e:
        traceback.print_exc()
        fid = memory_service.save_feedback(
            session_id=session_id, user_query=user_query,
            error_message=f"SQL generation failed: {str(e)}", chat_id=chat_id,
            mcq_questions=mcq_questions, mcq_answers=mcq_answers,
            user_id=user_id, lms_type=lms_type, model=req_model,
            user_name=current_user.get("name"), user_email=current_user.get("email"),
        )

        _emsg = str(e)
        if "429" in _emsg or "RESOURCE_EXHAUSTED" in _emsg:
            raise HTTPException(status_code=429, detail="LLM quota exhausted. Please wait and retry.")
        raise HTTPException(status_code=500, detail=f"Failed to generate SQL: {str(e)}")

    if not llm_service.validate_sql(generated_sql):
        fid = memory_service.save_feedback(
            session_id=session_id, user_query=user_query, generated_sql=generated_sql,
            error_message="Security block: non-read-only SQL generated.", chat_id=chat_id,
            mcq_questions=mcq_questions, mcq_answers=mcq_answers,
            user_id=user_id, lms_type=lms_type, model=req_model,
            user_name=current_user.get("name"), user_email=current_user.get("email"),
        )
        raise HTTPException(status_code=403, detail={
            "message": "Generated SQL is not read-only. Operation blocked.",
            "sql": generated_sql, "feedback_id": fid,
        })

    execution_time = round(time.time() - start_time, 3)
    fid = memory_service.save_feedback(
        session_id=session_id, user_query=user_query, generated_sql=generated_sql,
        execution_time=execution_time, chat_id=chat_id,
        mcq_questions=mcq_questions, mcq_answers=mcq_answers,
        user_id=user_id, lms_type=lms_type, model=req_model,
        user_name=current_user.get("name"), user_email=current_user.get("email"),
    )

    if not execute:
        _token_usage = {'model': req_model, **sql_usage} if sql_usage else None
        return QueryResponse(
            feedback_id=fid, session_id=session_id, sql=generated_sql,
            execution_time=execution_time, cached=False, executed=False,
            session_context_alert="⚠️ Session context limited to last 5 queries" if should_show_context_alert else None,
            token_usage=_token_usage,
        )

    results = []
    sql_auto_fixed = False

    try:
        results = execute_sql(generated_sql, lms_type)
    except Exception as sql_err:
        original_error = str(sql_err)
        log.warning("SQL execution failed in MCQ/feedback path, attempting auto-fix. Error: %s", original_error[:200])
        fixed_sql = llm_service.auto_fix_sql(user_query, generated_sql, original_error, model=req_model, lms_type=lms_type)

        if fixed_sql and llm_service.validate_sql(fixed_sql):
            generated_sql = fixed_sql
            sql_auto_fixed = True
            try:
                results = execute_sql(generated_sql, lms_type)
            except Exception as e2:
                final_error = str(e2)
                log.error("Auto-fixed SQL also failed in MCQ/feedback path: %s", final_error)
                fid2 = memory_service.save_feedback(
                    session_id=session_id, user_query=user_query, generated_sql=generated_sql,
                    error_message=f"[auto-fix attempt] {final_error}", chat_id=chat_id,
                    mcq_questions=mcq_questions, mcq_answers=mcq_answers,
                    user_id=user_id, lms_type=lms_type, model=req_model,
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
                user_id=user_id, lms_type=lms_type, model=req_model,
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
        feedback_id=fid, session_id=session_id, sql=generated_sql,
        answer=answer, chart_type=chart_type, data=results,
        execution_time=round(time.time() - start_time, 3), cached=False, executed=True,
        sql_auto_fixed=sql_auto_fixed,
        session_context_alert="⚠️ Session context limited to last 5 queries" if should_show_context_alert else None,
        token_usage=_token_usage,
    )


@router.post("/disambiguate", response_model=DisambiguateResponse)
def disambiguate_query(req: DisambiguateRequest, current_user: dict = Depends(get_current_user)):
    _enforce_query_rate_limit(req.session_id)
    
    if (current_user.get("role") or "").lower() == "counsellor":
        raise HTTPException(status_code=403, detail="Counsellors do not have access to SQL disambiguation.")
        
    req_model = _validate_model(req.model)


    log.info("DISAMBIGUATE session=%s query=%r", req.session_id, req.user_query[:100])

    session_history = memory_service.format_session_for_prompt(req.session_id)
    lms_type_for_disambig = _resolve_lms_type(current_user, req.lms_type)
    questions, error = mcq_service.generate_mcqs(req.user_query, session_history, model=req_model, lms_type=lms_type_for_disambig)

    if error or not questions:
        raise HTTPException(status_code=500, detail=f"Failed to generate MCQs: {error or 'empty response'}")

    query_id = str(uuid.uuid4())
    memory_service.store_query_context(query_id, {
        "original_query": req.user_query,
        "questions": questions,
        "session_id": req.session_id,
        "chat_id": req.chat_id or "",
        "user_id": str(current_user["id"]),
        "lms_type": _resolve_lms_type(current_user, req.lms_type),
    })

    return DisambiguateResponse(
        query_id=query_id,
        session_id=req.session_id,
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
    lms_type = ctx.get("lms_type") or _resolve_lms_type(current_user)
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
        start_time=start_time, lms_type=lms_type, user_id=user_id,
        current_user=current_user,
        mcq_questions=questions, mcq_answers=req.answers,
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
    lms_type = ctx.get("lms_type") or _resolve_lms_type(current_user)
    user_id = str(current_user["id"])

    _enforce_query_rate_limit(session_id)
    req_model = _validate_model(req.model)

    feedback_context = mcq_service.build_feedback_context(original_query, questions, answers, req.feedback)

    return _generate_and_respond(
        user_query=original_query, session_id=session_id, chat_id=chat_id,
        extra_context=feedback_context, req_model=req_model, execute=req.execute,
        start_time=start_time, lms_type=lms_type, user_id=user_id,
        current_user=current_user,
    )
