import json
import logging
import logging.handlers
import pathlib
import threading
import uuid
from datetime import datetime, timezone
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


# ─────────────────────────── MCQ QUERY CONTEXT (in-memory) ────────────────────

import time as _time

_query_contexts: dict[str, dict] = {}
_query_ctx_lock = threading.Lock()
_CTX_MAX_AGE = 600  # 10 minutes


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


# ─────────────────────────── QUERY LOG (DB) ────────────────────────────────────

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
    user_id: str = None,
    lms_type: str = None,
    model: str = None,
    token_usage: dict = None,
    chart_type: str = None,
) -> str:
    """Insert a query/response pair into query_logs table."""
    from config.database import get_auth_engine

    feedback_id = str(uuid.uuid4())
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
        mcq_data = json.dumps({"questions": mcq_log})

    token_usage_json = json.dumps(token_usage) if token_usage else None

    _db_saved = False
    try:
        engine = get_auth_engine()
        with engine.begin() as conn:
            conn.execute(text("""
                INSERT INTO query_logs (
                    id, user_id, session_id, chat_id, user_query, generated_sql,
                    answer, execution_time, error_message, model, lms_type,
                    token_usage, chart_type, mcq_data,
                    created_at_utc, created_at_ist
                ) VALUES (
                    :id, :user_id, :session_id, :chat_id, :user_query, :generated_sql,
                    :answer, :execution_time, :error_message, :model, :lms_type,
                    CAST(:token_usage AS jsonb), :chart_type, CAST(:mcq_data AS jsonb),
                    :now, :now AT TIME ZONE 'Asia/Kolkata'
                )
            """), {
                "id": feedback_id,
                "user_id": user_id,
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
        _db_saved = True
    except Exception as e:
        log.error("Failed to save query log to DB (id=%s will not persist): %s", feedback_id[:8], e)

    if error_message:
        log.error("feedback[%s] session=%s query=%r error=%s", feedback_id[:8], session_id, user_query[:80], error_message)
    else:
        log.info("feedback[%s] session=%s exec=%.3fs query=%r", feedback_id[:8], session_id, execution_time, user_query[:80])

    # Append to session memory only when DB save succeeded (feedback_id must exist in query_logs)
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
    try:
        engine = get_auth_engine()
        with engine.connect() as conn:
            rows = conn.execute(text("""
                SELECT content FROM session_turns
                WHERE session_id = :sid
                ORDER BY created_at_utc ASC
            """), {"sid": session_id}).fetchall()

        turns = []
        for row in rows:
            try:
                turn = json.loads(row.content)
                turns.append(turn)
            except Exception:
                pass
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
        lines.append(f'SQL: {t.get("generated_sql", "")}')
        lines.append(f'Answer: {t.get("answer", "")}\n')
    return "\n".join(lines)


def _load_sessions() -> dict:
    """Legacy function — returns empty dict (sessions are now in DB)."""
    return {}


