"""
Seed script — run once after schema.sql is applied.
Creates the 6 initial super_admin users.

Usage:
    cd DataWhisper
    python seed_users.py
"""

import os
import sys
import uuid
from datetime import datetime, timezone

import bcrypt as _bcrypt
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

AUTH_DB_URL = os.environ.get("AUTH_DB_URL")
if not AUTH_DB_URL:
    print("❌ AUTH_DB_URL not set in .env")
    sys.exit(1)


def _hash(password: str) -> str:
    return _bcrypt.hashpw(password.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")

SEED_USERS = [
    {"username": "mohit.kapoor@degreefyd.com",             "full_name": "Mohit Kapoor",             "role": "super_admin"},
    {"username": "gaurav.sisodia@nuvoraed.com",            "full_name": "Gaurav Sisodia",           "role": "super_admin"},
    {"username": "bhanuri.chandrashekhar@degreefyd.com",   "full_name": "Bhanuri Chandrashekhar",   "role": "super_admin"},
    {"username": "sid@nuvoraed.com",                       "full_name": "Sid",                      "role": "super_admin"},
    {"username": "deepak@nuvoraed.com",                    "full_name": "Deepak",                   "role": "super_admin"},
    {"username": "harsh.pandey@degreefyd.com",             "full_name": "Harsh Pandey",             "role": "super_admin"},
]


def seed():
    engine = create_engine(AUTH_DB_URL, pool_pre_ping=True)
    now_utc = datetime.now(timezone.utc)

    # Seed Mohit first (created_by = NULL), then the rest reference Mohit's UUID
    mohit_id = None

    with engine.begin() as conn:
        for i, u in enumerate(SEED_USERS):
            username = u["username"]
            password = username  # password = username (email address)
            hashed = _hash(password)
            uid = str(uuid.uuid4())

            # Check if already exists
            existing = conn.execute(
                text("SELECT id FROM users WHERE username = :u"),
                {"u": username},
            ).fetchone()

            if existing:
                print(f"⚠️  Already exists: {username}")
                if i == 0:
                    mohit_id = str(existing[0])
                continue

            if i == 0:
                mohit_id = uid
                created_by = None
            else:
                created_by = mohit_id

            conn.execute(
                text("""
                    INSERT INTO users (id, username, hashed_password, full_name, role, lms_type, is_active, created_by, created_at_utc, created_at_ist)
                    VALUES (:id, :username, :hashed_password, :full_name, :role, NULL, true, :created_by, :now_utc, :now_utc AT TIME ZONE 'Asia/Kolkata')
                """),
                {
                    "id": uid,
                    "username": username,
                    "hashed_password": hashed,
                    "full_name": u["full_name"],
                    "role": u["role"],
                    "created_by": created_by,
                    "now_utc": now_utc,
                },
            )
            print(f"✅ Created: {username} (password = username)")

    print("\nDone. All seed users created.")


if __name__ == "__main__":
    seed()
