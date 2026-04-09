import json
import logging
import logging.handlers
import pathlib
import threading
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

from sqlalchemy import text

from config.settings import settings


# ─────────────────────────── LOGGING SETUP ───────────────────────────────────

def _setup_logger() -> logging.Logger:
    log_dir = pathlib.Path(settings.DATA_DIR) / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "app.log"

    logger = logging.getLogger("text2sql")
    if logger.handlers:
        return logger

    logger.setLevel(logging.DEBUG)
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S")

    fh = logging.handlers.RotatingFileHandler(log_path, maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(fmt)

    ch = logging.StreamHandler()
    ch.setLevel(logging.INFO)
    ch.setFormatter(fmt)

    logger.addHandler(fh)
    logger.addHandler(ch)
    return logger


log = _setup_logger()



import time as _time

_query_contexts: dict[str, dict] = {}
_query_ctx_lock = threading.Lock()
_CTX_MAX_AGE = 600  


def store_query_context(query_id: str, context: dict):
    with _query_ctx_lock:
        _cleanup_stale_contexts()
        context["_created_at"] = _time.time()
        _query_contexts[query_id] = context


def get_query_context(query_id: str) -> Optional[dict]:
    with _query_ctx_lock:
        _cleanup_stale_contexts()
        return _query_contexts.get(query_id)


def update_query_context(query_id: str, updates: dict):
    with _query_ctx_lock:
        ctx = _query_contexts.get(query_id)
        if ctx is not None:
            ctx.update(updates)


def _cleanup_stale_contexts():
    now = _time.time()
    expired = [qid for qid, ctx in _query_contexts.items()
               if now - ctx.get("_created_at", 0) > _CTX_MAX_AGE]
    for qid in expired:
        del _query_contexts[qid]



def save_feedback(
    session_id: str,
    user_query: str,
    generated_sql: str = "",
    answer: str = "",
    execution_time: float = 0.0,
    error_message: str = "",
    chat_id: str = "",
    mcq_questions: list = None,
    mcq_answers: list = None,
    token_usage: dict = None,
    chart_type: str = None,
    user_name: str = None,
    user_email: str = None,
    user_role: str = None,
    user_id: str = None,
    model: str = None,
    lms_type: str = None,
    thoughts: str = "",
    is_mcq_answer: bool = False,
    user_msg_id: str = None,
    data: list = None,
    existing_feedback_id: str = None,
    sql_auto_fixed: bool = False,
    sql_error: str = None,
    extra: dict = None,
) -> str:
    """Insert a query/response pair into query_logs table and track token usage."""
    from config.database import get_auth_engine
    from services.llm_service import calculate_cost

    feedback_id = existing_feedback_id or str(uuid.uuid4())
    now_utc = datetime.now(timezone.utc)

    mcq_data = None
    if mcq_questions and mcq_answers is not None:
        mcq_log = []
        for i, q in enumerate(mcq_questions):
            ans = mcq_answers[i] if i < len(mcq_answers) else None
            if isinstance(ans, str):
                selected_text = ans
            elif isinstance(ans, int):
                opts = q.get("options", [])
                selected_text = opts[ans].get("text") if 0 <= ans < len(opts) else None
            else:
                selected_text = None
            mcq_log.append({
                "question_id": q.get("question_id"),
                "question_text": q.get("question_text"),
                "selected_answer": ans,
                "selected_text": selected_text,
            })
        mcq_data = json.dumps({"questions": mcq_log}, default=str)

    token_usage_json = json.dumps(token_usage, default=str) if token_usage else None

    _db_saved = False
    try:
        engine = get_auth_engine()
        with engine.begin() as conn:
            log.info("UPSERT query_logs ID=%s chat_id=%s has_data=%s", feedback_id, chat_id, data is not None)
            conn.execute(text("""
                INSERT INTO query_logs (
                    id, user_id, user_name, user_email, user_role, session_id, chat_id, user_query, generated_sql,
                    answer, execution_time, error_message, model, lms_type,
                    token_usage, chart_type, mcq_data,
                    created_at_utc, created_at_ist
                ) VALUES (
                    :id, :user_id, :user_name, :user_email, :user_role, :session_id, :chat_id, :user_query, :generated_sql,
                    :answer, :execution_time, :error_message, :model, :lms_type,
                    CAST(:token_usage AS jsonb), :chart_type, CAST(:mcq_data AS jsonb),
                    :now, :now AT TIME ZONE 'Asia/Kolkata'
                )
                ON CONFLICT (id) DO UPDATE SET
                    answer = EXCLUDED.answer,
                    generated_sql = EXCLUDED.generated_sql,
                    execution_time = EXCLUDED.execution_time,
                    token_usage = EXCLUDED.token_usage,
                    chart_type = EXCLUDED.chart_type,
                    mcq_data = EXCLUDED.mcq_data
            """), {
                "id": feedback_id,
                "user_id": user_id,
                "user_name": user_name,
                "user_email": user_email,
                "user_role": user_role,
                "session_id": session_id,
                "chat_id": chat_id or "",
                "user_query": user_query,
                "generated_sql": generated_sql,
                "answer": answer,
                "execution_time": execution_time,
                "error_message": error_message,
                "model": model,
                "lms_type": lms_type,
                "token_usage": token_usage_json,
                "chart_type": chart_type,
                "mcq_data": mcq_data,
                "now": now_utc,
            })

            if chat_id:
                try:
                    conn.execute(text("""
                        INSERT INTO chats (id, user_id, title, last_message, updated_at_utc, updated_at_ist)
                        VALUES (:id, :uid, 'New Chat', :last_msg, :now, :now AT TIME ZONE 'Asia/Kolkata')
                        ON CONFLICT (id) DO UPDATE SET
                            last_message = EXCLUDED.last_message,
                            updated_at_utc = now(),
                            updated_at_ist = now() AT TIME ZONE 'Asia/Kolkata'
                    """), {
                        "id": chat_id,
                        "uid": user_id,
                        "last_msg": (answer[:50] if answer else user_query[:50]),
                        "now": now_utc,
                    })

                    if not existing_feedback_id:
                        final_user_msg_id = user_msg_id or f"u-{uuid.uuid4()}"
                        conn.execute(text("""
                            INSERT INTO chat_messages (id, chat_id, type, text, created_at_utc, created_at_ist)
                            VALUES (:id, :cid, 'user', :text, :now, :now AT TIME ZONE 'Asia/Kolkata')
                            ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text
                        """), {
                            "id": final_user_msg_id,
                            "cid": chat_id,
                            "text": user_query,
                            "now": now_utc,
                        })
                except Exception as e:
                    log.error("Failed to auto-populate chat entry in save_feedback: %s", e)

            target_msg_id = user_msg_id or (f"a-{feedback_id}" if not is_mcq_answer else f"m-{feedback_id}")
            
            rich_extra = extra or {}
            if data is not None: rich_extra["data"] = data
            if thoughts: rich_extra["thoughts"] = thoughts
            if mcq_data: rich_extra["mcq_data"] = json.loads(mcq_data)
            
            conn.execute(text("""
                INSERT INTO chat_messages (
                    id, chat_id, type, text, sql, answer, chart_type, execution_time, 
                    model, session_id, user_query, feedback_id, token_usage, 
                    sql_auto_fixed, error, extra, created_at_utc, created_at_ist
                ) VALUES (
                    :id, :cid, :type, :text, :sql, :ans, :chart, :etime,
                    :model, :sid, :q, :fid, CAST(:tokens AS jsonb),
                    :saf, :err, CAST(:extra AS jsonb), :now, :now AT TIME ZONE 'Asia/Kolkata'
                )
                ON CONFLICT (id) DO UPDATE SET
                    sql = EXCLUDED.sql,
                    answer = EXCLUDED.answer,
                    chart_type = EXCLUDED.chart_type,
                    execution_time = EXCLUDED.execution_time,
                    token_usage = EXCLUDED.token_usage,
                    sql_auto_fixed = EXCLUDED.sql_auto_fixed,
                    error = EXCLUDED.error,
                    extra = EXCLUDED.extra
            """), {
                "id": target_msg_id,
                "cid": chat_id,
                "type": "ai" if not is_mcq_answer else "mcq",
                "text": answer,
                "sql": generated_sql,
                "ans": answer,
                "chart": chart_type,
                "etime": execution_time,
                "model": model,
                "sid": session_id,
                "q": user_query,
                "fid": feedback_id,
                "tokens": token_usage_json,
                "saf": sql_auto_fixed,
                "err": sql_error or error_message,
                "extra": json.dumps(rich_extra, default=str),
                "now": now_utc
            })


        _db_saved = True

        if token_usage and model:
            in_t = token_usage.get('input_tokens', 0)
            out_t = token_usage.get('output_tokens', 0)
            in_c, out_c = calculate_cost(model, in_t, out_t)
            
            with engine.begin() as conn:
                conn.execute(text("""
                    INSERT INTO token_usage_logs (
                        query_id, user_id, model, input_tokens, output_tokens, 
                        input_token_cost, output_token_cost, created_at_utc, updated_at_utc
                    ) VALUES (
                        :qid, :uid, :model, :in_t, :out_t, :in_c, :out_c, now(), now()
                    )
                """), {
                    "qid": feedback_id,
                    "uid": user_id,
                    "model": model,
                    "in_t": in_t,
                    "out_t": out_t,
                    "in_c": in_c,
                    "out_c": out_c
                })
    except Exception as e:
        log.error("Failed to save query log to DB (id=%s will not persist): %s", feedback_id[:8], e)

    if error_message:
        log.error("feedback[%s] session=%s query=%r error=%s", feedback_id[:8], session_id, user_query[:80], error_message)
    else:
        log.info("feedback[%s] session=%s exec=%.3fs query=%r", feedback_id[:8], session_id, execution_time, user_query[:80])

    if _db_saved:
        append_session_turn(session_id, user_query, generated_sql, answer, feedback_id, user_id=user_id)

    return feedback_id


def get_history(limit: int = 50) -> list[dict]:
    """Retrieve last N entries from query_logs."""
    from config.database import get_auth_engine
    try:
        engine = get_auth_engine()
        with engine.connect() as conn:
            rows = conn.execute(text("""
                SELECT id as feedback_id, session_id, chat_id, user_query, generated_sql,
                       answer, execution_time, error_message, created_at_utc as timestamp
                FROM query_logs
                ORDER BY created_at_utc DESC
                LIMIT :limit
            """), {"limit": limit}).fetchall()
        return [dict(r._mapping) for r in rows]
    except Exception as e:
        log.error("Failed to get history: %s", e)
        return []


_ALLOWED_FEEDBACK_COLUMNS = frozenset({
    "has_logic_feedback", "logic_feedback_text",
    "has_sql_feedback", "corrected_sql",
    "has_english_feedback", "english_feedback_text", "regenerated_sql",
    "has_any_feedback",
})

def update_query_log_field(feedback_id: str, updates: dict):
    """Update specific columns on a query_logs row (used by feedback endpoints)."""
    from config.database import get_auth_engine
    if not updates:
        return
    invalid = set(updates) - _ALLOWED_FEEDBACK_COLUMNS
    if invalid:
        log.error("update_query_log_field: disallowed column(s) %s", invalid)
        return
    set_parts = ", ".join(f"{k}=:{k}" for k in updates)
    updates["feedback_id"] = feedback_id
    try:
        engine = get_auth_engine()
        with engine.begin() as conn:
            conn.execute(text(f"UPDATE query_logs SET {set_parts} WHERE id=:feedback_id"), updates)
    except Exception as e:
        log.error("Failed to update query log %s: %s", feedback_id, e)


# ─────────────────────────── SESSION MEMORY (DB) ──────────────────────────────

def _ensure_session(conn, session_id: str, user_id: str = None):
    """Create session row if it doesn't exist."""
    now_utc = datetime.now(timezone.utc)
    conn.execute(text("""
        INSERT INTO sessions (id, user_id, created_at_utc, created_at_ist, updated_at_utc, updated_at_ist)
        VALUES (:id, :uid, :now, :now AT TIME ZONE 'Asia/Kolkata', :now, :now AT TIME ZONE 'Asia/Kolkata')
        ON CONFLICT (id) DO NOTHING
    """), {"id": session_id, "uid": user_id, "now": now_utc})


def get_session(session_id: str) -> dict:
    """Return session dict with 'turns' list (for backward compatibility)."""
    from config.database import get_auth_engine
    print(f"Fetching session {session_id} from DB")
    try:
        engine = get_auth_engine()
        with engine.connect() as conn:
            rows = conn.execute(text("""
                SELECT content FROM session_turns
                WHERE session_id = :sid
                ORDER BY created_at_utc DESC LIMIT :max_turns   
            """), {"sid": session_id, "max_turns": settings.SESSION_MAX_TURNS}).fetchall()

        turns = []
        for row in rows:
            try:
                turn = json.loads(row.content)
                turns.append(turn)
            except Exception:
                pass
        
        turns.reverse()
        return {"turns": turns}
    except Exception as e:
        log.error("get_session error: %s", e)
        return {"turns": []}


def append_session_turn(session_id: str, user_query: str, generated_sql: str, answer: str, feedback_id: str, user_id: str = None):
    """Insert a turn into session_turns (keeps last SESSION_MAX_TURNS rows)."""
    from config.database import get_auth_engine
    now_utc = datetime.now(timezone.utc)
    content = json.dumps({
        "user_query": user_query,
        "generated_sql": generated_sql,
        "answer": answer,
        "feedback_id": feedback_id,
    })
    try:
        engine = get_auth_engine()
        with engine.begin() as conn:
            # Force ensure session exists using the session_id (which will be the chat_id)
            _ensure_session(conn, session_id, user_id)
            
            conn.execute(text("""
                INSERT INTO session_turns (id, session_id, role, content, created_at_utc, created_at_ist)
                VALUES (:id, :sid, 'turn', :content, :now, :now AT TIME ZONE 'Asia/Kolkata')
            """), {"id": str(uuid.uuid4()), "sid": session_id, "content": content, "now": now_utc})

            # Trim to SESSION_MAX_TURNS — keep last N
            max_turns = settings.SESSION_MAX_TURNS
            conn.execute(text("""
                DELETE FROM session_turns
                WHERE session_id = :sid
                  AND id NOT IN (
                    SELECT id FROM session_turns
                    WHERE session_id = :sid
                    ORDER BY created_at_utc DESC
                    LIMIT :max_turns
                  )
            """), {"sid": session_id, "max_turns": max_turns})

            # Update session updated_at
            conn.execute(text("""
                UPDATE sessions SET updated_at_utc=:now, updated_at_ist=:now AT TIME ZONE 'Asia/Kolkata'
                WHERE id=:sid
            """), {"now": now_utc, "sid": session_id})
    except Exception as e:
        log.error("append_session_turn error: %s", e)


def update_session_turn(session_id: str, feedback_id: str, new_sql: str, new_answer: str):
    """Update the answer/sql on a session turn that matches feedback_id."""
    from config.database import get_auth_engine
    try:
        engine = get_auth_engine()
        with engine.connect() as conn:
            rows = conn.execute(text("""
                SELECT id, content FROM session_turns
                WHERE session_id = :sid
                ORDER BY created_at_utc DESC
                LIMIT :max_turns
            """), {"sid": session_id, "max_turns": settings.SESSION_MAX_TURNS}).fetchall()

        for row in rows:
            try:
                turn = json.loads(row.content)
                if turn.get("feedback_id") == feedback_id:
                    turn["generated_sql"] = new_sql
                    turn["answer"] = new_answer
                    with engine.begin() as conn:
                        conn.execute(text(
                            "UPDATE session_turns SET content=:content WHERE id=:id"
                        ), {"content": json.dumps(turn), "id": row.id})
                    break
            except Exception:
                pass
    except Exception as e:
        log.error("update_session_turn error: %s", e)


def format_session_for_prompt(session_id: str) -> str:
    """Format last N session turns as LLM context string."""
    session = get_session(session_id)
    turns = session.get("turns", [])
    if not turns:
        return ""

    prompt_turns = min(settings.SESSION_MAX_TURNS, len(turns))
    recent = turns[-prompt_turns:]

    lines = ["\n### CONVERSATION HISTORY (use this for follow-up questions):\n"]
    for t in recent:
        lines.append(f'User: {t.get("user_query", "")}')
        sql = t.get("generated_sql")
        if sql:
            lines.append(f'SQL: {sql}')
        lines.append(f'Answer: {t.get("answer", "")}\n')
    print(f"Formatted session {session_id} for prompt with {len(recent)} turns")
    return "\n".join(lines)


def save_mcq_step(chat_id: str, session_id: str, query_id: str, user_query: str, questions: list, model: str, user_id: str = None, msg_id: str = None, user_msg_id: str = None):
    """Save the MCQ generation step to chat_messages so it persists on refresh."""
    from config.database import get_auth_engine
    if not chat_id:
        return
    
    now_utc = datetime.now(timezone.utc)
    engine = get_auth_engine()
    
    try:
        with engine.begin() as conn:
            if chat_id:
                chat_title = (user_query[:50] + '...') if len(user_query) > 50 else user_query
                conn.execute(text("""
                    INSERT INTO chats (id, user_id, title, last_message, created_at_utc, updated_at_utc)
                    VALUES (:id, :uid, :title, :msg, :now, :now)
                    ON CONFLICT (id) DO NOTHING
                """), {
                    "id": chat_id,
                    "uid": user_id,
                    "title": chat_title,
                    "msg": user_query,
                    "now": now_utc
                })

            # 1. Save User Question
            final_user_msg_id = user_msg_id or f"u-{uuid.uuid4()}"
            conn.execute(text("""
                INSERT INTO chat_messages (id, chat_id, type, text, created_at_utc, created_at_ist)
                VALUES (:id, :cid, 'user', :text, :now, :now AT TIME ZONE 'Asia/Kolkata')
                ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text
            """), {"id": final_user_msg_id, "cid": chat_id, "text": user_query, "now": now_utc})

            mcq_msg_id = msg_id or f"m-{query_id}"
            extra = {
                "questions": questions,
                "query_id": query_id,
                "original_query": user_query,
                "sessionId": session_id,
                "chatId": chat_id,
                "model": model
            }
            conn.execute(text("""
                INSERT INTO chat_messages (id, chat_id, type, text, extra, model, session_id, user_query, created_at_utc, created_at_ist)
                VALUES (:id, :cid, 'mcq', :text, CAST(:extra AS jsonb), :model, :sid, :q, :now, :now AT TIME ZONE 'Asia/Kolkata')
                ON CONFLICT (id) DO UPDATE SET
                    text = EXCLUDED.text,
                    extra = EXCLUDED.extra,
                    model = EXCLUDED.model
            """), {
                "id": mcq_msg_id,
                "cid": chat_id,
                "text": "Please clarify your request:",
                "extra": json.dumps(extra),
                "model": model,
                "sid": session_id,
                "q": user_query,
                "now": now_utc
            })
            log.info("Saved MCQ step to chat_messages chat=%s qid=%s", chat_id, query_id)
    except Exception as e:
        log.error("Failed to save MCQ step to chat_messages: %s", e)


def _load_sessions() -> dict:
    """Legacy function — returns empty dict (sessions are now in DB)."""
    return {}
