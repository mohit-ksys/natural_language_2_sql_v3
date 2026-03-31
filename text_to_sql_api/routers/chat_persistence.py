"""
Chat persistence router - saves/loads frontend chat UI state to backend.
Uses sessions.json for storage.
"""

import json
import logging
from pathlib import Path
from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from config.settings import settings
import threading

log = logging.getLogger("text2sql")
router = APIRouter()

SESSIONS_FILE = Path(settings.DATA_DIR) / "sessions.json"
_save_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class ChatMessage(BaseModel):
    id: str
    type: str                                    # 'user' | 'ai' | 'ai-error'
    text: Optional[str] = None
    isFix: Optional[bool] = False               # true when this is a fix-request message
    timestamp: Optional[str] = None             # ISO timestamp set by frontend

    # AI-message fields
    model: Optional[str] = None
    isRegen: Optional[bool] = False
    sql: Optional[str] = None
    answer: Optional[str] = None
    chart_type: Optional[str] = None
    data: Optional[List[Dict[str, Any]]] = None
    execution_time: Optional[float] = None
    session_context_alert: Optional[str] = None
    sessionId: Optional[str] = None
    userQuery: Optional[str] = None
    feedbackId: Optional[str] = None
    token_usage: Optional[Dict[str, Any]] = None  # {model, input_tokens, output_tokens}
    error: Optional[str] = None


class Chat(BaseModel):
    id: str
    title: str
    messages: List[ChatMessage]
    lastMessage: str
    createdAt: Optional[str] = None
    isPinned: Optional[bool] = False            # pinned/starred in sidebar


class SaveChatsRequest(BaseModel):
    chats: List[Chat]
    lastChatId: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sessions_to_chats(sessions_data: dict) -> list:
    """Convert internal sessions.json format → frontend Chat list."""
    chats = []
    for session_id, session_data in sessions_data.items():
        turns = session_data.get("turns", [])
        messages = []

        for i, turn in enumerate(turns):
            # User message
            messages.append({
                "id": f"u-{i + 1}",
                "type": "user",
                "text": turn.get("user_query", ""),
                "isFix": turn.get("isFix", False),
                "timestamp": turn.get("timestamp_user") or None,
            })

            # AI response
            messages.append({
                "id": f"ai-{i + 1}",
                "type": "ai",
                "sql": turn.get("generated_sql", ""),
                "answer": turn.get("answer", ""),
                "chart_type": turn.get("chart_type", ""),
                "execution_time": turn.get("execution_time", 0),
                "model": turn.get("model", ""),
                "sessionId": session_id,
                "userQuery": turn.get("user_query", ""),
                "feedbackId": turn.get("feedback_id", ""),
                "token_usage": turn.get("token_usage") or None,
                "isRegen": turn.get("isRegen", False),
                "timestamp": turn.get("timestamp_ai") or None,
            })

        last_text = ""
        for m in reversed(messages):
            if m.get("text"):
                last_text = m["text"][:50]
                break

        chats.append({
            "id": session_id.replace("session-", "chat-"),
            "title": session_data.get("title", "Chat"),
            "messages": messages,
            "lastMessage": last_text,
            "createdAt": session_data.get("created_at", ""),
            "isPinned": session_data.get("isPinned", False),
        })

    return chats


def _chats_to_sessions(req_chats: List[Chat], existing: dict) -> dict:
    """Merge frontend Chat list → internal sessions.json format."""
    sessions_data = existing.copy()

    for chat in req_chats:
        session_id = chat.id.replace("chat-", "session-")

        if session_id not in sessions_data:
            sessions_data[session_id] = {
                "created_at": chat.createdAt or "",
                "title": chat.title,
                "isPinned": chat.isPinned or False,
                "turns": [],
            }
        else:
            sessions_data[session_id]["title"] = chat.title
            sessions_data[session_id]["isPinned"] = chat.isPinned or False
            if chat.createdAt:
                sessions_data[session_id].setdefault("created_at", chat.createdAt)

        # Convert message pairs → turns
        turns = []
        messages = chat.messages
        i = 0
        while i < len(messages):
            if messages[i].type == "user":
                user_msg = messages[i]
                ai_msg = None

                # Find the next AI message
                if i + 1 < len(messages) and messages[i + 1].type == "ai":
                    ai_msg = messages[i + 1]

                if ai_msg:
                    turn = {
                        "user_query": user_msg.text or "",
                        "isFix": user_msg.isFix or False,
                        "timestamp_user": user_msg.timestamp or "",
                        "generated_sql": ai_msg.sql or "",
                        "answer": ai_msg.answer or "",
                        "feedback_id": ai_msg.feedbackId or "",
                        "chart_type": ai_msg.chart_type or "",
                        "execution_time": ai_msg.execution_time or 0,
                        "model": ai_msg.model or "",
                        "token_usage": ai_msg.token_usage or None,
                        "isRegen": ai_msg.isRegen or False,
                        "timestamp_ai": ai_msg.timestamp or "",
                    }
                    turns.append(turn)
                    i += 2
                else:
                    # User message with no AI response yet (still loading)
                    i += 1
            else:
                i += 1

        sessions_data[session_id]["turns"] = turns

    return sessions_data


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/chats/load")
def load_chats():
    """Load all chats from backend storage."""
    try:
        data_dir = Path(settings.DATA_DIR)
        data_dir.mkdir(parents=True, exist_ok=True)

        with _save_lock:
            if not SESSIONS_FILE.exists():
                return {"ok": True, "chats": [], "lastChatId": None}

            try:
                with open(SESSIONS_FILE, "r", encoding="utf-8") as f:
                    sessions_data = json.load(f)
            except (json.JSONDecodeError, ValueError) as e:
                log.error(f"Failed to parse sessions.json: {e}")
                return {"ok": True, "chats": [], "lastChatId": None}

            chats = _sessions_to_chats(sessions_data)

            # Restore last active chat
            last_chat_file = Path(settings.DATA_DIR) / "last_chat.txt"
            lastChatId = None
            if last_chat_file.exists():
                lastChatId = last_chat_file.read_text(encoding="utf-8").strip() or None

        log.info(f"✅ Loaded {len(chats)} chats from backend")
        return {"ok": True, "chats": chats, "lastChatId": lastChatId}

    except Exception as e:
        log.error(f"Failed to load chats: {e}")
        return {"ok": False, "error": str(e), "chats": []}


@router.post("/chats/save")
def save_chats(req: SaveChatsRequest):
    """Save frontend chats to backend storage."""
    try:
        data_dir = Path(settings.DATA_DIR)
        data_dir.mkdir(parents=True, exist_ok=True)

        with _save_lock:
            # Load existing data (preserves turns added by query endpoint)
            existing = {}
            if SESSIONS_FILE.exists():
                try:
                    with open(SESSIONS_FILE, "r", encoding="utf-8") as f:
                        existing = json.load(f)
                except (json.JSONDecodeError, ValueError):
                    log.warning("Corrupted sessions.json — starting fresh")

            sessions_data = _chats_to_sessions(req.chats, existing)

            # Atomic write
            with open(SESSIONS_FILE, "w", encoding="utf-8") as f:
                json.dump(sessions_data, f, indent=2, ensure_ascii=False)

            # Persist last active chat ID
            if req.lastChatId:
                last_chat_file = Path(settings.DATA_DIR) / "last_chat.txt"
                last_chat_file.write_text(req.lastChatId, encoding="utf-8")

        log.info(f"✅ Saved {len(req.chats)} chats to backend")
        return {"ok": True, "message": f"Saved {len(req.chats)} chats"}

    except Exception as e:
        log.error(f"Failed to save chats: {e}")
        return {"ok": False, "error": str(e)}
