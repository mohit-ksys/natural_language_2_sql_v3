"""
Chat persistence router — saves/loads frontend chat UI state via user_chats table.
"""

import json
import logging
from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from typing import List, Optional, Dict, Any
from sqlalchemy import text

from auth.dependencies import get_current_user
from config.database import get_auth_engine

log = logging.getLogger("text2sql")
router = APIRouter()


# ─── Pydantic models ─────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    # extra='allow' preserves MCQ fields (questions, query_id, original_query, chatId)
    # and any other frontend fields so they survive a save/load round-trip
    model_config = ConfigDict(extra='allow')

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
    execution_time: Optional[Any] = None   # float or None; Any avoids coercion errors
    session_context_alert: Optional[str] = None
    sessionId: Optional[str] = None
    userQuery: Optional[str] = None
    feedbackId: Optional[str] = None
    token_usage: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


class Chat(BaseModel):
    model_config = ConfigDict(extra='allow')

    id: str
    title: str
    messages: Optional[List[ChatMessage]] = None
    lastMessage: Optional[str] = ''
    createdAt: Optional[str] = None
    isPinned: Optional[bool] = False
    isDeleted: Optional[bool] = False


class SaveChatsRequest(BaseModel):
    chats: List[Chat]
    lastChatId: Optional[str] = None


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/chats/load")
def load_chats(current_user: dict = Depends(get_current_user)):
    """Load chats list (metadata only) for the current user."""
    user_id = str(current_user["id"])
    engine = get_auth_engine()

    try:
        with engine.connect() as conn:
            # Fetch all chats for this user from the NEW table, filtering out soft-deleted ones
            rows = conn.execute(
                text("SELECT * FROM chats WHERE user_id = :uid AND is_deleted = false ORDER BY updated_at_utc DESC"),
                {"uid": user_id},
            ).fetchall()
            
            # Note: information about which rows were filtered is logged if debug is on
            # but usually we just return the active ones.

            # Fetch last_chat_id
            last_chat_row = conn.execute(
                text("SELECT last_chat_id FROM user_chats WHERE user_id = :uid"),
                {"uid": user_id},
            ).fetchone()

        chats = []
        if rows:
            for row in rows:
                chats.append({
                    "id": row.id,
                    "title": row.title,
                    "lastMessage": row.last_message,
                    "isPinned": row.is_pinned,
                    "isDeleted": getattr(row, 'is_deleted', False),
                    "createdAt": row.created_at_utc.isoformat() if row.created_at_utc else None,
                    "messages": []
                })
        else:
            # FALLBACK: Try legacy blob storage if NEW table is empty
            with engine.connect() as conn:
                legacy_row = conn.execute(
                    text("SELECT chats_blob FROM user_chats WHERE user_id = :uid"),
                    {"uid": user_id}
                ).fetchone()
            
            if legacy_row and legacy_row.chats_blob:
                try:
                    legacy_chats = legacy_row.chats_blob if isinstance(legacy_row.chats_blob, list) else json.loads(legacy_row.chats_blob)
                    for c in legacy_chats:
                        chats.append({
                            "id": c.get("id"),
                            "title": c.get("title"),
                            "lastMessage": c.get("lastMessage", ""),
                            "isPinned": c.get("isPinned", False),
                            "createdAt": c.get("createdAt"),
                            "messages": []
                        })
                except Exception as e:
                    log.error("Failed to parse legacy chats blob: %s", e)

        return {
            "ok": True, 
            "chats": chats, 
            "lastChatId": last_chat_row.last_chat_id if last_chat_row else None
        }
    except Exception as e:
        log.error("Failed to load chats for user %s: %s", user_id, e)
        return {"ok": False, "error": str(e), "chats": []}


@router.get("/chats/{chat_id}/messages")
def load_chat_messages(
    chat_id: str, 
    limit: int = 20, 
    offset: int = 0, 
    current_user: dict = Depends(get_current_user)
):
    """Load paginated messages for a specific chat in descending order."""
    engine = get_auth_engine()
    user_id = str(current_user["id"])
    print("chats", {chat_id, limit, offset})
    try:
        with engine.connect() as conn:
            chat_status = conn.execute(
                text("SELECT user_id FROM chats WHERE id = :cid"),
                {"cid": chat_id}
            ).fetchone()

            if not chat_status:
                legacy_check = conn.execute(
                    text("SELECT 1 FROM user_chats WHERE user_id = :uid"),
                    {"uid": user_id}
                ).fetchone()
                
                pass
            elif str(chat_status.user_id) != user_id:
                log.warning("User %s tried to access chat %s belonging to %s", user_id, chat_id, chat_status.user_id)
                return {"ok": False, "error": "Unauthorized or chat not found", "messages": []}

            total_count = conn.execute(
                text("SELECT COUNT(*) FROM chat_messages WHERE chat_id = :cid"),
                {"cid": chat_id}
            ).scalar()

            rows = conn.execute(
                text("""
                    SELECT * FROM chat_messages 
                    WHERE chat_id = :cid 
                    ORDER BY created_at_utc ASC, (CASE WHEN type = 'user' THEN 0 ELSE 1 END) ASC 
                    LIMIT :limit OFFSET :offset
                """),
                {"cid": chat_id, "limit": limit, "offset": offset}
            ).fetchall()
        print(f"Loaded {len(rows)} messages for chat {chat_id} (offset {offset}/{total_count})")
        messages = []
        if rows:
            for r in rows:
                extra = r.extra if hasattr(r, 'extra') and r.extra else {}
                if isinstance(extra, str):
                    try: extra = json.loads(extra)
                    except: extra = {}

                msg = {
                    "id": r.id,
                    "type": r.type,
                    "text": r.text,
                    "isFix": r.is_fix,
                    "isRegen": r.is_regenerate,
                    "sql": r.sql if r.type == 'ai' else (extra.get('sql') if r.type == 'ai' else None),
                    "answer": r.answer if r.answer else (r.text if r.type == 'ai' else None),
                    "chart_type": r.chart_type,
                    "execution_time": r.execution_time,
                    "model": r.model,
                    "sessionId": r.session_id,
                    "chatId": r.chat_id,
                    "userQuery": r.user_query,
                    "feedbackId": r.feedback_id or '',
                    "token_usage": r.token_usage,
                    "error": r.error,
                    "lms_type": getattr(r, 'lms_type', None),
                    "timestamp": r.created_at_utc.isoformat() if r.created_at_utc else None,
                }
                if r.extra:
                    msg.update(r.extra)
                    if 'data' in r.extra:
                        msg['data'] = r.extra['data']
                
                msg['loading'] = False
                messages.append(msg)
            
            has_more = (offset + len(messages)) < total_count
        else:
            has_more = False
            if offset == 0:
                with engine.connect() as conn:
                    legacy_row = conn.execute(
                        text("SELECT chats_blob FROM user_chats WHERE user_id = :uid"),
                        {"uid": user_id}
                    ).fetchone()
                
                if legacy_row and legacy_row.chats_blob:
                    try:
                        legacy_chats = legacy_row.chats_blob if isinstance(legacy_row.chats_blob, list) else json.loads(legacy_row.chats_blob)
                        log.info("Checking legacy fallback for %s. Found %d chats in blob.", chat_id, len(legacy_chats))
                        
                        target_chat = None
                        stripped_id = chat_id.replace("chat-", "")
                        for c in legacy_chats:
                            cid = str(c.get("id", ""))
                            if cid == chat_id or cid == stripped_id or cid.replace("chat-", "") == stripped_id:
                                target_chat = c
                                break

                        if target_chat and target_chat.get("messages"):
                            raw_legacy = target_chat["messages"]
                            for m in raw_legacy:
                                m.setdefault("id", str(uuid.uuid4()))
                                m.setdefault("timestamp", datetime.now(timezone.utc).isoformat())
                            messages = raw_legacy
                            log.info("Loaded %d legacy messages for chat %s", len(messages), chat_id)
                    except Exception as e:
                        log.error("Failed to parse legacy messages for fallback: %s", e)

            if not messages and offset == 0:
                return {"ok": False, "error": "Conversation not found", "messages": []}

        return {"ok": True, "messages": messages, "has_more": has_more}
    except Exception as e:
        log.error("Failed to load messages for chat %s: %s", chat_id, e)
        return {"ok": False, "error": str(e)}


@router.post("/chats/save")
def save_chats(req: SaveChatsRequest, current_user: dict = Depends(get_current_user)):
    """Upsert chats and their messages into decoupled tables."""
    user_id = str(current_user["id"])
    engine = get_auth_engine()

    try:
        with engine.begin() as conn:
            # 1. Update last_chat_id in user_chats
            conn.execute(text("""
                INSERT INTO user_chats (user_id, last_chat_id, updated_at_utc, updated_at_ist)
                VALUES (:uid, :last_chat_id, now(), now() AT TIME ZONE 'Asia/Kolkata')
                ON CONFLICT (user_id) DO UPDATE SET
                    last_chat_id = EXCLUDED.last_chat_id,
                    updated_at_utc = now(),
                    updated_at_ist = now() AT TIME ZONE 'Asia/Kolkata'
            """), {"uid": user_id, "last_chat_id": req.lastChatId})

            for chat in req.chats:
                # 2. Upsert into chats table
                conn.execute(text("""
                    INSERT INTO chats (id, user_id, title, last_message, is_pinned, is_deleted, updated_at_utc, updated_at_ist)
                    VALUES (:id, :uid, :title, :last_msg, :pinned, :is_deleted, now(), now() AT TIME ZONE 'Asia/Kolkata')
                    ON CONFLICT (id) DO UPDATE SET
                        title = EXCLUDED.title,
                        last_message = EXCLUDED.last_message,
                        is_pinned = EXCLUDED.is_pinned,
                        is_deleted = EXCLUDED.is_deleted,
                        updated_at_utc = now(),
                        updated_at_ist = now() AT TIME ZONE 'Asia/Kolkata'
                """), {
                    "id": chat.id,
                    "uid": user_id,
                    "title": chat.title,
                    "last_msg": chat.lastMessage,
                    "pinned": chat.isPinned,
                    "is_deleted": chat.isDeleted or False
                })

                # 3. Upsert messages if provided
                if chat.messages:
                    for m in chat.messages:
                        # Separate extra fields
                        base_fields = {
                            "id", "type", "text", "isFix", "timestamp", "model", "isRegen", 
                            "sql", "answer", "chart_type", "execution_time", "sessionId", 
                            "userQuery", "feedbackId", "token_usage", "error"
                        }
                        m_dict = m.model_dump()
                        # UI-only fields we NEVER want to persist
                        banned_fields = {"loading", "isNavigating"}
                        extra = {k: v for k, v in m_dict.items() if k not in base_fields and k not in banned_fields}
                        
                        conn.execute(text("""
                            INSERT INTO chat_messages (
                                id, chat_id, type, text, is_fix, is_regenerate, sql, answer, 
                                chart_type, execution_time, model, session_id, user_query, 
                                feedback_id, token_usage, error, extra, created_at_utc, created_at_ist
                            ) VALUES (
                                :id, :chat_id, :type, :text, :is_fix, :is_regenerate, :sql, :answer,
                                :chart_type, :execution_time, :model, :session_id, :user_query,
                                :feedback_id, CAST(:token_usage AS jsonb), :error, CAST(:extra AS jsonb),
                                COALESCE(:ts, now()), COALESCE(:ts, now()) AT TIME ZONE 'Asia/Kolkata'
                            )
                            ON CONFLICT (id) DO UPDATE SET
                                text = EXCLUDED.text,
                                is_fix = EXCLUDED.is_fix,
                                is_regenerate = EXCLUDED.is_regenerate,
                                sql = EXCLUDED.sql,
                                answer = EXCLUDED.answer,
                                chart_type = EXCLUDED.chart_type,
                                execution_time = EXCLUDED.execution_time,
                                token_usage = EXCLUDED.token_usage,
                                error = EXCLUDED.error,
                                extra = EXCLUDED.extra
                        """), {
                            "id": m.id,
                            "chat_id": chat.id,
                            "type": m.type,
                            "text": m.text,
                            "is_fix": m.isFix,
                            "is_regenerate": m.isRegen,
                            "sql": m.sql,
                            "answer": m.answer,
                            "chart_type": m.chart_type,
                            "execution_time": m.execution_time,
                            "model": m.model,
                            "session_id": m.sessionId,
                            "user_query": m.userQuery,
                            "feedback_id": m.feedbackId,
                            "token_usage": json.dumps(m.token_usage) if m.token_usage else None,
                            "error": m.error,
                            "extra": json.dumps(extra) if extra else None,
                            "ts": m.timestamp
                        })

        return {"ok": True, "message": f"Saved {len(req.chats)} chats and messages"}
    except Exception as e:
        log.error("Failed to save chats for user %s: %s", user_id, e)
        return {"ok": False, "error": str(e)}
