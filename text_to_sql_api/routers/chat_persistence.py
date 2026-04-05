"""
Chat persistence router — saves/loads frontend chat UI state via user_chats table.
"""

import json
import logging
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from sqlalchemy import text

from auth.dependencies import get_current_user
from config.database import get_auth_engine

log = logging.getLogger("text2sql")
router = APIRouter()


# ─── Pydantic models ─────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    id: str
    type: str
    text: Optional[str] = None
    isFix: Optional[bool] = False
    timestamp: Optional[str] = None
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
    token_usage: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


class Chat(BaseModel):
    id: str
    title: str
    messages: List[ChatMessage]
    lastMessage: str
    createdAt: Optional[str] = None
    isPinned: Optional[bool] = False


class SaveChatsRequest(BaseModel):
    chats: List[Chat]
    lastChatId: Optional[str] = None


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/chats/load")
def load_chats(current_user: dict = Depends(get_current_user)):
    """Load chats blob for the current user from user_chats table."""
    user_id = str(current_user["id"])
    engine = get_auth_engine()

    try:
        with engine.connect() as conn:
            row = conn.execute(
                text("SELECT chats_blob, last_chat_id FROM user_chats WHERE user_id = :uid"),
                {"uid": user_id},
            ).fetchone()

        if row is None or row.chats_blob is None:
            return {"ok": True, "chats": [], "lastChatId": None}

        chats = row.chats_blob if isinstance(row.chats_blob, list) else []
        return {"ok": True, "chats": chats, "lastChatId": row.last_chat_id}
    except Exception as e:
        log.error("Failed to load chats for user %s: %s", user_id, e)
        return {"ok": False, "error": str(e), "chats": []}


@router.post("/chats/save")
def save_chats(req: SaveChatsRequest, current_user: dict = Depends(get_current_user)):
    """Upsert chats blob for the current user into user_chats table."""
    user_id = str(current_user["id"])
    engine = get_auth_engine()

    chats_json = json.dumps([c.model_dump() for c in req.chats])

    try:
        with engine.begin() as conn:
            conn.execute(text("""
                INSERT INTO user_chats (user_id, chats_blob, last_chat_id, updated_at_utc, updated_at_ist)
                VALUES (:uid, CAST(:blob AS jsonb), :last_chat_id, now(), now() AT TIME ZONE 'Asia/Kolkata')
                ON CONFLICT (user_id) DO UPDATE SET
                    chats_blob = EXCLUDED.chats_blob,
                    last_chat_id = EXCLUDED.last_chat_id,
                    updated_at_utc = now(),
                    updated_at_ist = now() AT TIME ZONE 'Asia/Kolkata'
            """), {"uid": user_id, "blob": chats_json, "last_chat_id": req.lastChatId})

        return {"ok": True, "message": f"Saved {len(req.chats)} chats"}
    except Exception as e:
        log.error("Failed to save chats for user %s: %s", user_id, e)
        return {"ok": False, "error": str(e)}
