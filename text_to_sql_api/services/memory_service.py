import json
import logging
import logging.handlers
import pathlib
import threading
import uuid
from datetime import datetime
from typing import Any, Optional

from config.settings import settings


# ─────────────────────────── LOGGING SETUP ───────────────────────────────────

def _setup_logger() -> logging.Logger:
    log_dir = pathlib.Path(settings.DATA_DIR) / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "app.log"

    logger = logging.getLogger("text2sql")
    if logger.handlers:
        return logger  # already configured

    logger.setLevel(logging.DEBUG)
    fmt = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
    )

    # Rotating file: 5 MB × 5 backups
    fh = logging.handlers.RotatingFileHandler(
        log_path, maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8"
    )
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(fmt)

    ch = logging.StreamHandler()
    ch.setLevel(logging.INFO)
    ch.setFormatter(fmt)

    logger.addHandler(fh)
    logger.addHandler(ch)
    return logger


log = _setup_logger()


DATA_DIR = pathlib.Path(settings.DATA_DIR)
CONVERSATIONAL_LOG = DATA_DIR / "conversational_log.jsonl"
SESSIONS_JSON = DATA_DIR / "sessions.json"


def _ensure_files():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not CONVERSATIONAL_LOG.exists():
        CONVERSATIONAL_LOG.write_text("", encoding="utf-8")
        print(f"✅ Initialized {CONVERSATIONAL_LOG.name}")
    if not SESSIONS_JSON.exists() or not SESSIONS_JSON.read_text(encoding="utf-8").strip():
        SESSIONS_JSON.write_text("{}", encoding="utf-8")
        print(f"✅ Initialized {SESSIONS_JSON.name}")


_ensure_files()


# ─────────────────────────── UNIFIED CONVERSATIONAL LOG ────────────────────────

_log_lock = threading.Lock()


def save_feedback(
    session_id: str,
    user_query: str,
    generated_sql: str = "",
    answer: str = "",
    execution_time: float = 0.0,
    error_message: str = "",
    chat_id: str = "",
) -> str:
    """Save a query/response pair to unified conversational log."""
    feedback_id = str(uuid.uuid4())

    log_entry = {
        "feedback_id": feedback_id,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "session_id": session_id,
        "chat_id": chat_id,
        "user_query": user_query,
        "generated_sql": generated_sql,
        "answer": answer,
        "execution_time": execution_time,
        "error_message": error_message,
    }

    with _log_lock:
        with open(CONVERSATIONAL_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(log_entry) + "\n")

    if error_message:
        log.error("feedback[%s] session=%s query=%r error=%s", feedback_id[:8], session_id, user_query[:80], error_message)
    else:
        log.info("feedback[%s] session=%s exec=%.3fs query=%r", feedback_id[:8], session_id, execution_time, user_query[:80])

    # Also append to session memory
    append_session_turn(session_id, user_query, generated_sql, answer, feedback_id)

    return feedback_id


def get_history(limit: int = 50) -> list[dict]:
    """Retrieve last N entries from conversational log."""
    if not CONVERSATIONAL_LOG.exists():
        return []

    with open(CONVERSATIONAL_LOG, "r", encoding="utf-8") as f:
        lines = f.readlines()

    entries = []
    for line in lines[-limit:]:
        try:
            entries.append(json.loads(line.strip()))
        except json.JSONDecodeError:
            continue

    return list(reversed(entries))


# ─────────────────────────── SESSION MEMORY ──────────────────────────────────

_sessions_lock = threading.Lock()


def _load_sessions() -> dict:
    if not SESSIONS_JSON.exists():
        return {}
    content = SESSIONS_JSON.read_text(encoding="utf-8-sig").strip()
    if not content:
        return {}
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        log.warning("sessions.json is corrupted — resetting to empty.")
        return {}


def _save_sessions(sessions: dict):
    SESSIONS_JSON.write_text(json.dumps(sessions, indent=2, ensure_ascii=False), encoding="utf-8")


def get_session(session_id: str) -> dict:
    with _sessions_lock:
        sessions = _load_sessions()
    return sessions.get(session_id, {"created_at": datetime.utcnow().isoformat(), "turns": []})


def append_session_turn(session_id: str, user_query: str, generated_sql: str, answer: str, feedback_id: str):
    """Append a turn to session history (kept to last SESSION_MAX_TURNS)."""
    with _sessions_lock:
        sessions = _load_sessions()
        if session_id not in sessions:
            sessions[session_id] = {"created_at": datetime.utcnow().isoformat(), "turns": []}

        sessions[session_id]["turns"].append({
            "user_query": user_query,
            "generated_sql": generated_sql,
            "answer": answer,
            "feedback_id": feedback_id,
        })

        max_turns = settings.SESSION_MAX_TURNS
        if len(sessions[session_id]["turns"]) > max_turns:
            sessions[session_id]["turns"] = sessions[session_id]["turns"][-max_turns:]

        _save_sessions(sessions)


def update_session_turn(session_id: str, feedback_id: str, new_sql: str, new_answer: str):
    with _sessions_lock:
        sessions = _load_sessions()
        if session_id not in sessions:
            return
        for turn in sessions[session_id]["turns"]:
            if turn.get("feedback_id") == feedback_id:
                turn["generated_sql"] = new_sql
                turn["answer"] = new_answer
                break
        _save_sessions(sessions)


def format_session_for_prompt(session_id: str) -> str:
    """Format last N session turns as context for LLM (5 turns max)."""
    session = get_session(session_id)
    turns = session.get("turns", [])
    if not turns:
        return ""

    # Use last 5 turns for context (SESSION_MAX_TURNS = 5)
    prompt_turns = min(settings.SESSION_MAX_TURNS, len(turns))
    recent = turns[-prompt_turns:]

    lines = ["\n### CONVERSATION HISTORY (use this for follow-up questions):\n"]
    for t in recent:
        lines.append(f'User: {t["user_query"]}')
        lines.append(f'SQL: {t["generated_sql"]}')
        lines.append(f'Answer: {t["answer"]}\n')
    return "\n".join(lines)
