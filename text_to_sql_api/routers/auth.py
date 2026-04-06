"""
Auth router — login, refresh, logout, user management.
"""

import secrets
import string
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
import bcrypt as _bcrypt
from jose import jwt
from pydantic import BaseModel
from sqlalchemy import text
from typing import Optional

from auth.dependencies import get_current_user, require_super_admin
from config.database import get_auth_engine
from config.settings import settings

router = APIRouter(prefix="/auth", tags=["Auth"])


def _hash_pw(password: str) -> str:
    return _bcrypt.hashpw(password.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")


def _verify_pw(plain: str, hashed: str) -> bool:
    try:
        return _bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


# ─── Pydantic models ─────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class CreateUserRequest(BaseModel):
    username: str
    full_name: str
    role: str        # 'admin' | 'analyser' | 'super_admin'
    lms_type: Optional[str] = None  # 'online' | 'regular' | None


class ResetPasswordResponse(BaseModel):
    success: bool
    username: str
    new_password: str


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _make_access_token(user: dict) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=settings.JWT_EXPIRY_HOURS)
    payload = {
        "sub": str(user["id"]),
        "username": user["username"],
        "full_name": user["full_name"],
        "role": str(user["role"]),
        "lms_type": str(user["lms_type"]) if user["lms_type"] else None,
        "exp": expire,
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def _make_refresh_token_and_store(user_id: str) -> str:
    """Generate a secure refresh token, hash it, store in DB, return plaintext.

    Token format: "{token_id}.{secret}"
    The token_id is the DB row UUID — allows O(1) lookup on refresh/logout
    instead of scanning and bcrypt-comparing every active token.
    """
    token_id = str(uuid.uuid4())
    secret = secrets.token_urlsafe(48)  # token_urlsafe never contains "."
    raw = f"{token_id}.{secret}"
    hashed = _hash_pw(secret)           # only hash the secret portion
    now_utc = datetime.now(timezone.utc)
    expires_utc = now_utc + timedelta(days=settings.REFRESH_TOKEN_EXPIRY_DAYS)

    engine = get_auth_engine()
    with engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at_utc, expires_at_ist)
            VALUES (:id, :user_id, :token_hash, :exp_utc, :exp_utc AT TIME ZONE 'Asia/Kolkata')
        """), {
            "id": token_id,
            "user_id": user_id,
            "token_hash": hashed,
            "exp_utc": expires_utc,
        })
    return raw


def _generate_password(length: int = 12) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _update_last_login(user_id: str):
    now_utc = datetime.now(timezone.utc)
    engine = get_auth_engine()
    with engine.begin() as conn:
        conn.execute(text("""
            UPDATE users SET last_login_at_utc=:now,
            last_login_at_ist=:now AT TIME ZONE 'Asia/Kolkata'
            WHERE id=:uid
        """), {"now": now_utc, "uid": user_id})


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.post("/login")
def login(req: LoginRequest):
    engine = get_auth_engine()
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT id, username, hashed_password, full_name, role, lms_type, is_active FROM users WHERE username = :u"),
            {"u": req.username},
        ).fetchone()

    if row is None or not _verify_pw(req.password, row.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password.")

    user = dict(row._mapping)
    if not user["is_active"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is deactivated.")

    access_token = _make_access_token(user)
    refresh_token = _make_refresh_token_and_store(str(user["id"]))
    _update_last_login(str(user["id"]))

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": {
            "username": user["username"],
            "full_name": user["full_name"],
            "role": str(user["role"]),
            "lms_type": str(user["lms_type"]) if user["lms_type"] else None,
        },
    }


@router.post("/refresh")
def refresh_token(req: RefreshRequest):
    """Validate refresh token and issue a new access token."""
    # Token format: "{token_id}.{secret}" — look up by ID then verify secret
    token_id, dot, secret = req.refresh_token.partition(".")
    if not dot:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token.")

    engine = get_auth_engine()
    with engine.connect() as conn:
        row = conn.execute(text("""
            SELECT rt.id, rt.token_hash, rt.expires_at_utc, rt.revoked,
                   u.id as user_id, u.username, u.full_name, u.role, u.lms_type, u.is_active
            FROM refresh_tokens rt
            JOIN users u ON u.id = rt.user_id
            WHERE rt.id = :token_id AND rt.revoked = false AND rt.expires_at_utc > now()
        """), {"token_id": token_id}).fetchone()

    if row is None or not _verify_pw(secret, row.token_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token.")

    matched = dict(row._mapping)
    if not matched["is_active"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is deactivated.")

    user = {
        "id": matched["user_id"],
        "username": matched["username"],
        "full_name": matched["full_name"],
        "role": matched["role"],
        "lms_type": matched["lms_type"],
    }
    access_token = _make_access_token(user)
    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/logout")
def logout(req: RefreshRequest):
    """Revoke the given refresh token."""
    token_id, dot, secret = req.refresh_token.partition(".")
    if not dot:
        return {"success": True}  # malformed token — nothing to revoke

    engine = get_auth_engine()
    with engine.connect() as conn:
        row = conn.execute(text(
            "SELECT id, token_hash FROM refresh_tokens WHERE id = :token_id AND revoked = false"
        ), {"token_id": token_id}).fetchone()

    if row and _verify_pw(secret, row.token_hash):
        with engine.begin() as conn:
            conn.execute(text("UPDATE refresh_tokens SET revoked=true WHERE id=:id"), {"id": row.id})

    return {"success": True}


@router.post("/users/create")
def create_user(req: CreateUserRequest, _: dict = Depends(require_super_admin)):
    """Super admin only — create a new user. Returns plaintext password once."""
    if req.role not in ("super_admin", "admin", "analyser"):
        raise HTTPException(status_code=400, detail="Invalid role.")
    if req.lms_type and req.lms_type not in ("online", "regular"):
        raise HTTPException(status_code=400, detail="Invalid lms_type. Use 'online' or 'regular'.")

    engine = get_auth_engine()
    with engine.connect() as conn:
        existing = conn.execute(
            text("SELECT id FROM users WHERE username=:u"), {"u": req.username}
        ).fetchone()
    if existing:
        raise HTTPException(status_code=409, detail="Username already exists.")

    plain_pw = _generate_password()
    hashed = _hash_pw(plain_pw)
    uid = str(uuid.uuid4())
    now_utc = datetime.now(timezone.utc)

    with engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO users (id, username, hashed_password, full_name, role, lms_type, is_active, created_at_utc, created_at_ist)
            VALUES (:id, :username, :hashed, :full_name, :role, :lms_type, true, :now, :now AT TIME ZONE 'Asia/Kolkata')
        """), {
            "id": uid,
            "username": req.username,
            "hashed": hashed,
            "full_name": req.full_name,
            "role": req.role,
            "lms_type": req.lms_type,
            "now": now_utc,
        })

    return {
        "success": True,
        "username": req.username,
        "password": plain_pw,
        "role": req.role,
        "lms_type": req.lms_type,
    }


@router.get("/users")
def list_users(_: dict = Depends(require_super_admin)):
    """Super admin only — list all users."""
    engine = get_auth_engine()
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT id, username, full_name, role, lms_type, is_active,
                   created_at_ist, last_login_at_ist
            FROM users ORDER BY created_at_utc ASC
        """)).fetchall()
    return {"users": [dict(r._mapping) for r in rows]}


@router.patch("/users/{username}/reset-password")
def reset_password(username: str, _: dict = Depends(require_super_admin)):
    """Super admin only — reset user password. Returns plaintext password once."""
    engine = get_auth_engine()
    with engine.connect() as conn:
        row = conn.execute(text("SELECT id FROM users WHERE username=:u"), {"u": username}).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found.")

    plain_pw = _generate_password()
    hashed = _hash_pw(plain_pw)

    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET hashed_password=:h WHERE username=:u"), {"h": hashed, "u": username})

    return {"success": True, "username": username, "new_password": plain_pw}


@router.patch("/users/{username}/deactivate")
def deactivate_user(username: str, _: dict = Depends(require_super_admin)):
    """Super admin only — deactivate user and revoke all refresh tokens."""
    engine = get_auth_engine()
    with engine.connect() as conn:
        row = conn.execute(text("SELECT id FROM users WHERE username=:u"), {"u": username}).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found.")

    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET is_active=false WHERE username=:u"), {"u": username})
        conn.execute(text("DELETE FROM refresh_tokens WHERE user_id=:uid"), {"uid": row.id})

    return {"success": True, "username": username, "status": "deactivated"}


@router.patch("/users/{username}/reactivate")
def reactivate_user(username: str, _: dict = Depends(require_super_admin)):
    """Super admin only — reactivate a deactivated user."""
    engine = get_auth_engine()
    with engine.connect() as conn:
        row = conn.execute(text("SELECT id FROM users WHERE username=:u"), {"u": username}).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found.")

    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET is_active=true WHERE username=:u"), {"u": username})

    return {"success": True, "username": username, "status": "active"}
