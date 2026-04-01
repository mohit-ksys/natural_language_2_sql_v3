import logging
import time
import traceback
import uuid

from fastapi import APIRouter, HTTPException

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


def _enforce_query_rate_limit(session_id: str):
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


@router.post("/query", response_model=QueryResponse)
def process_query(req: QueryRequest):
    """
    Simplified query flow:
    1. Load session history (last 5 turns)
    2. Generate SQL via LLM
    3. Validate SQL
    4. Execute (if requested)
    5. Log to conversational_log.jsonl
    """
    start_time = time.time()

    if req.user_query.strip() == "":
        raise HTTPException(status_code=400, detail="user_query is required.")

    _enforce_query_rate_limit(req.session_id)

    req_model = req.model or llm_service.get_active_model()
    if req.model and req.model not in llm_service.ALLOWED_MODELS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model. Allowed: {llm_service.ALLOWED_MODELS}",
        )

    log.info("QUERY session=%s query=%r model=%s", req.session_id, req.user_query[:100], req_model)

    # Load session history (last 5 turns for context)
    session_history = memory_service.format_session_for_prompt(req.session_id)

    # Check if session has 5+ turns for context alert
    session = memory_service.get_session(req.session_id)
    turns_count = len(session.get("turns", []))
    should_show_context_alert = turns_count >= 5

    # Generate SQL with session context
    log.info("LLM call model=%s query=%r", req_model, req.user_query[:100])
    try:
        generated_sql, thoughts, sql_usage = llm_service.generate_sql(
            user_query=req.user_query,
            session_history=session_history,
            learned_rules="",  # No universal memory anymore
            model=req_model,
            thinking_enabled=req.thinking_enabled,
            thinking_level=req.thinking_level,
            include_thoughts=req.include_thoughts,
        )
        log.debug("generated SQL: %s", generated_sql[:200])
    except Exception as e:
        traceback.print_exc()
        log.error("SQL generation failed: %s", str(e))
        fid = memory_service.save_feedback(
            session_id=req.session_id,
            user_query=req.user_query,
            error_message=f"SQL generation failed: {str(e)}",
            chat_id=req.chat_id or "",
        )
        _emsg = str(e)
        if "429" in _emsg or "RESOURCE_EXHAUSTED" in _emsg:
            raise HTTPException(status_code=429, detail="LLM quota exhausted. Please wait and retry.")
        raise HTTPException(status_code=500, detail=f"Failed to generate SQL: {str(e)}")

    # Validate SQL
    if not llm_service.validate_sql(generated_sql):
        fid = memory_service.save_feedback(
            session_id=req.session_id,
            user_query=req.user_query,
            generated_sql=generated_sql,
            error_message="Security block: non-read-only SQL generated.",
            chat_id=req.chat_id or "",
        )
        raise HTTPException(
            status_code=403,
            detail={
                "message": "Generated SQL is not read-only. Operation blocked.",
                "sql": generated_sql,
                "feedback_id": fid,
            },
        )

    execution_time = round(time.time() - start_time, 3)

    # Save feedback with empty answer (will be updated after execution if needed)
    fid = memory_service.save_feedback(
        session_id=req.session_id,
        user_query=req.user_query,
        generated_sql=generated_sql,
        execution_time=execution_time,
        chat_id=req.chat_id or "",
    )

    if not req.execute:
        # Return SQL only — caller will hit /execute when ready
        _token_usage = {'model': req_model, **sql_usage} if sql_usage else None
        return QueryResponse(
            feedback_id=fid,
            session_id=req.session_id,
            sql=generated_sql,
            execution_time=execution_time,
            cached=False,
            executed=False,
            session_context_alert="⚠️ Session context limited to last 5 queries" if should_show_context_alert else None,
            token_usage=_token_usage,
        )

    # --- Execute against DB ---
    results = []
    try:
        results = execute_sql(generated_sql)
    except Exception as sql_err:
        fixed_sql = llm_service.auto_fix_sql(req.user_query, generated_sql, str(sql_err), model=req_model)
        if fixed_sql and llm_service.validate_sql(fixed_sql):
            generated_sql = fixed_sql
            try:
                results = execute_sql(generated_sql)
            except Exception as e2:
                fid = memory_service.save_feedback(
                    session_id=req.session_id,
                    user_query=req.user_query,
                    generated_sql=generated_sql,
                    error_message=str(e2),
                    chat_id=req.chat_id or "",
                )
                traceback.print_exc()
                raise HTTPException(status_code=500, detail=f"SQL execution failed after auto-fix: {str(e2)}")
        else:
            traceback.print_exc()
            fid = memory_service.save_feedback(
                session_id=req.session_id,
                user_query=req.user_query,
                generated_sql=generated_sql,
                error_message=str(sql_err),
                chat_id=req.chat_id or "",
            )
            raise HTTPException(status_code=500, detail=f"SQL execution failed: {str(sql_err)}")

    # Generate answer
    ans_usage = {}
    try:
        answer, chart_type, ans_usage = llm_service.generate_answer(req.user_query, results, model=req_model)
    except Exception:
        answer = f"Query returned {len(results)} rows."
        chart_type = "Table"

    # Accumulate token usage across both LLM calls
    _total_input = sql_usage.get('input_tokens', 0) + ans_usage.get('input_tokens', 0)
    _total_output = sql_usage.get('output_tokens', 0) + ans_usage.get('output_tokens', 0)
    _token_usage = {'model': req_model, 'input_tokens': _total_input, 'output_tokens': _total_output}

    # Update session memory with answer (don't save again to conversational log)
    memory_service.update_session_turn(req.session_id, fid, generated_sql, answer)

    return QueryResponse(
        feedback_id=fid,
        session_id=req.session_id,
        sql=generated_sql,
        answer=answer,
        chart_type=chart_type,
        data=results,
        execution_time=execution_time,
        cached=False,
        executed=True,
        session_context_alert="⚠️ Session context limited to last 5 queries" if should_show_context_alert else None,
        token_usage=_token_usage,
    )


@router.post("/execute", response_model=ExecuteResponse)
def execute_query(req: ExecuteRequest):
    """Execute a previously-generated (or user-edited) SQL query against the DB."""
    if not llm_service.validate_sql(req.sql):
        raise HTTPException(status_code=403, detail="Non-read-only SQL blocked.")

    start_time = time.time()
    try:
        results = execute_sql(req.sql)
    except Exception as sql_err:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"SQL execution failed: {str(sql_err)}")

    execution_time = round(time.time() - start_time, 3)

    _exec_model = req.model or llm_service.get_active_model()
    _exec_ans_usage = {}
    try:
        answer, chart_type, _exec_ans_usage = llm_service.generate_answer(
            req.original_query or req.sql,
            results,
            model=_exec_model,
        )
    except Exception:
        answer = f"Query returned {len(results)} rows."
        chart_type = "Table"

    # Update feedback record if we have an ID
    if req.feedback_id:
        try:
            memory_service.save_feedback(
                session_id=req.session_id,
                user_query=req.original_query or req.sql,
                generated_sql=req.sql,
                answer=answer,
                execution_time=execution_time,
            )
        except Exception:
            traceback.print_exc()

    _exec_token_usage = {'model': _exec_model, **_exec_ans_usage} if _exec_ans_usage else None
    return ExecuteResponse(
        answer=answer,
        chart_type=chart_type,
        data=results,
        execution_time=execution_time,
        feedback_id=req.feedback_id,
        token_usage=_exec_token_usage,
    )


@router.get("/history", response_model=HistoryResponse)
def get_history():
    data = memory_service.get_history(limit=50)
    return HistoryResponse(success=True, data=data)


@router.post("/config/model", response_model=ModelSwitchResponse)
def switch_model(req: ModelSwitchRequest):
    try:
        active = llm_service.set_active_model(req.model)
        return ModelSwitchResponse(active_model=active)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/config/model", response_model=ModelSwitchResponse)
def get_model():
    return ModelSwitchResponse(active_model=llm_service.get_active_model())


@router.get("/sessions", response_model=SessionsResponse)
def get_all_sessions():
    """Return all sessions from disk for frontend sync on startup."""
    sessions = memory_service._load_sessions()
    return SessionsResponse(success=True, sessions=sessions)


@router.get("/students/latest")
def get_latest_students():
    """Fetch latest 10 students who entered the system."""
    try:
        sql = "SELECT student_name, created_at FROM students ORDER BY created_at DESC LIMIT 10"
        results = execute_sql(sql)
        return {"success": True, "students": results}
    except Exception as e:
        log.error("Failed to fetch latest students: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to fetch students: {str(e)}")


# ─────────────────────────── MCQ DISAMBIGUATION ──────────────────────────────


def _validate_model(model: str | None) -> str:
    """Return resolved model name or raise 400."""
    req_model = model or llm_service.get_active_model()
    if model and model not in llm_service.ALLOWED_MODELS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model. Allowed: {llm_service.ALLOWED_MODELS}",
        )
    return req_model


def _generate_and_respond(
    user_query: str,
    session_id: str,
    chat_id: str,
    extra_context: str,
    req_model: str,
    execute: bool,
    start_time: float,
) -> QueryResponse:
    """Shared logic: generate SQL (with optional extra context), validate, execute, return."""
    session_history = memory_service.format_session_for_prompt(session_id)
    session = memory_service.get_session(session_id)
    turns_count = len(session.get("turns", []))
    should_show_context_alert = turns_count >= 5

    # Inject extra MCQ / feedback context between session history and the query
    combined_history = session_history
    if extra_context:
        combined_history = session_history + "\n" + extra_context

    try:
        generated_sql, thoughts, sql_usage = llm_service.generate_sql(
            user_query=user_query,
            session_history=combined_history,
            learned_rules="",
            model=req_model,
        )
        log.debug("MCQ-enhanced SQL: %s", generated_sql[:200])
    except Exception as e:
        traceback.print_exc()
        log.error("SQL generation failed: %s", str(e))
        fid = memory_service.save_feedback(
            session_id=session_id,
            user_query=user_query,
            error_message=f"SQL generation failed: {str(e)}",
            chat_id=chat_id,
        )
        _emsg = str(e)
        if "429" in _emsg or "RESOURCE_EXHAUSTED" in _emsg:
            raise HTTPException(status_code=429, detail="LLM quota exhausted. Please wait and retry.")
        raise HTTPException(status_code=500, detail=f"Failed to generate SQL: {str(e)}")

    if not llm_service.validate_sql(generated_sql):
        fid = memory_service.save_feedback(
            session_id=session_id,
            user_query=user_query,
            generated_sql=generated_sql,
            error_message="Security block: non-read-only SQL generated.",
            chat_id=chat_id,
        )
        raise HTTPException(
            status_code=403,
            detail={"message": "Generated SQL is not read-only. Operation blocked.",
                    "sql": generated_sql, "feedback_id": fid},
        )

    execution_time = round(time.time() - start_time, 3)
    fid = memory_service.save_feedback(
        session_id=session_id,
        user_query=user_query,
        generated_sql=generated_sql,
        execution_time=execution_time,
        chat_id=chat_id,
    )

    if not execute:
        _token_usage = {'model': req_model, **sql_usage} if sql_usage else None
        return QueryResponse(
            feedback_id=fid, session_id=session_id, sql=generated_sql,
            execution_time=execution_time, cached=False, executed=False,
            session_context_alert="\u26a0\ufe0f Session context limited to last 5 queries" if should_show_context_alert else None,
            token_usage=_token_usage,
        )

    # Execute
    results = []
    try:
        results = execute_sql(generated_sql)
    except Exception as sql_err:
        fixed_sql = llm_service.auto_fix_sql(user_query, generated_sql, str(sql_err), model=req_model)
        if fixed_sql and llm_service.validate_sql(fixed_sql):
            generated_sql = fixed_sql
            try:
                results = execute_sql(generated_sql)
            except Exception as e2:
                memory_service.save_feedback(session_id=session_id, user_query=user_query,
                                            generated_sql=generated_sql, error_message=str(e2), chat_id=chat_id)
                traceback.print_exc()
                raise HTTPException(status_code=500, detail=f"SQL execution failed after auto-fix: {str(e2)}")
        else:
            traceback.print_exc()
            memory_service.save_feedback(session_id=session_id, user_query=user_query,
                                        generated_sql=generated_sql, error_message=str(sql_err), chat_id=chat_id)
            raise HTTPException(status_code=500, detail=f"SQL execution failed: {str(sql_err)}")

    ans_usage = {}
    try:
        answer, chart_type, ans_usage = llm_service.generate_answer(user_query, results, model=req_model)
    except Exception:
        answer = f"Query returned {len(results)} rows."
        chart_type = "Table"

    _total_input = sql_usage.get('input_tokens', 0) + ans_usage.get('input_tokens', 0)
    _total_output = sql_usage.get('output_tokens', 0) + ans_usage.get('output_tokens', 0)
    _token_usage = {'model': req_model, 'input_tokens': _total_input, 'output_tokens': _total_output}
    memory_service.update_session_turn(session_id, fid, generated_sql, answer)

    return QueryResponse(
        feedback_id=fid, session_id=session_id, sql=generated_sql,
        answer=answer, chart_type=chart_type, data=results,
        execution_time=round(time.time() - start_time, 3), cached=False, executed=True,
        session_context_alert="\u26a0\ufe0f Session context limited to last 5 queries" if should_show_context_alert else None,
        token_usage=_token_usage,
    )


@router.post("/disambiguate", response_model=DisambiguateResponse)
def disambiguate_query(req: DisambiguateRequest):
    """Generate 3 MCQ clarifying questions for an ambiguous query."""
    if not req.user_query.strip():
        raise HTTPException(status_code=400, detail="user_query is required.")

    _enforce_query_rate_limit(req.session_id)
    req_model = _validate_model(req.model)

    log.info("DISAMBIGUATE session=%s query=%r model=%s", req.session_id, req.user_query[:100], req_model)

    session_history = memory_service.format_session_for_prompt(req.session_id)
    questions, error = mcq_service.generate_mcqs(req.user_query, session_history, model=req_model)

    if error or not questions:
        raise HTTPException(status_code=500, detail=f"Failed to generate MCQs: {error or 'empty response'}")

    query_id = str(uuid.uuid4())
    memory_service.store_query_context(query_id, {
        "original_query": req.user_query,
        "questions": questions,
        "session_id": req.session_id,
        "chat_id": req.chat_id or "",
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
def answer_mcq(req: MCQAnswerRequest):
    """Process query after user answers the MCQ clarifying questions."""
    start_time = time.time()

    ctx = memory_service.get_query_context(req.query_id)
    if not ctx:
        raise HTTPException(status_code=404, detail="Query context not found or expired. Please start a new query.")

    questions = ctx["questions"]
    original_query = ctx["original_query"]
    session_id = ctx["session_id"]
    chat_id = req.chat_id or ctx.get("chat_id", "")

    if len(req.answers) != len(questions):
        raise HTTPException(status_code=400, detail=f"Expected {len(questions)} answers, got {len(req.answers)}.")

    _enforce_query_rate_limit(session_id)
    req_model = _validate_model(req.model)

    # Save answers into context so /english-feedback can reuse them
    memory_service.update_query_context(req.query_id, {"answers": req.answers})

    enhanced_context = mcq_service.build_enhanced_context(original_query, questions, req.answers)
    log.info("ANSWER-MCQ query_id=%s session=%s model=%s", req.query_id[:8], session_id, req_model)

    return _generate_and_respond(
        user_query=original_query,
        session_id=session_id,
        chat_id=chat_id,
        extra_context=enhanced_context,
        req_model=req_model,
        execute=req.execute,
        start_time=start_time,
    )


@router.post("/english-feedback", response_model=QueryResponse)
def english_feedback(req: EnhancedFeedbackRequest):
    """Refine SQL using English feedback, optionally combined with prior MCQ context."""
    start_time = time.time()

    ctx = memory_service.get_query_context(req.query_id)
    if not ctx:
        raise HTTPException(status_code=404, detail="Query context not found or expired. Please start a new query.")

    if not req.feedback.strip():
        raise HTTPException(status_code=400, detail="feedback text is required.")

    original_query = ctx["original_query"]
    session_id = ctx["session_id"]
    chat_id = req.chat_id or ctx.get("chat_id", "")
    questions = ctx.get("questions")
    answers = ctx.get("answers")  # May be None if user skipped MCQs

    _enforce_query_rate_limit(session_id)
    req_model = _validate_model(req.model)

    feedback_context = mcq_service.build_feedback_context(
        original_query, questions, answers, req.feedback,
    )
    log.info("ENGLISH-FEEDBACK query_id=%s session=%s model=%s", req.query_id[:8], session_id, req_model)

    return _generate_and_respond(
        user_query=original_query,
        session_id=session_id,
        chat_id=chat_id,
        extra_context=feedback_context,
        req_model=req_model,
        execute=req.execute,
        start_time=start_time,
    )
