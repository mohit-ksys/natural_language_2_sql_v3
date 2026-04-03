# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**DataWhisper** is a conversational Text-to-SQL API that translates natural language queries into SQL using Google Gemini LLM. It features JWT-based authentication with role-based access control, session-based conversation memory stored in PostgreSQL, a feedback system, and a superadmin dashboard.

## Branch: `database-migration` — COMPLETED

All auth, database migration, and dashboard work from the locked plan has been fully implemented on this branch. Do not re-implement anything listed below.

---

## Quick Start (Full Stack)

### One-time setup (first deploy only)

```bash
# 1. Apply schema to your auth DB
psql $AUTH_DB_URL -f schema.sql

# 2. Generate JWT secret and set in .env
python -c "import secrets; print(secrets.token_hex(32))"
# → paste output as JWT_SECRET_KEY in .env

# 3. Seed the 6 super_admin users (run once)
python seed_users.py
```

### Running

```bash
# Terminal 1: Backend API
cd text_to_sql_api
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8001 --reload

# Terminal 2: Frontend
cd frontend
npm install
npm run dev  # Runs on http://localhost:5173
```

---

## Environment Configuration

All variables go in `.env` at the project root:

```bash
GEMINI_API_KEY=...              # Required — Google Gemini API key

# Auth + logs + sessions DB (plain PostgreSQL)
AUTH_DB_URL=postgresql://...

# LMS query DBs
ONLINE_LMS_URL=postgresql://...
REGULAR_LMS_URL=postgresql://...

# JWT — generate with: python -c "import secrets; print(secrets.token_hex(32))"
JWT_SECRET_KEY=...
JWT_ALGORITHM=HS256
JWT_EXPIRY_HOURS=8
REFRESH_TOKEN_EXPIRY_DAYS=7
```

⚠️ **Never commit `.env`** — it contains API keys and DB credentials.

**Changing `JWT_SECRET_KEY`** invalidates all active access tokens (force-logout everyone). Refresh tokens survive key rotation.

---

## Architecture

### Directory Structure

```
DataWhisper/
├── schema.sql                   # Full PostgreSQL schema — run once on auth DB
├── seed_users.py                # Seeds 6 super_admin users — run once
├── .env                         # Secrets (never commit)
│
├── text_to_sql_api/             # FastAPI backend (port 8001)
│   ├── main.py                  # App init, CORS, router registration
│   ├── auth/
│   │   ├── __init__.py
│   │   └── dependencies.py      # get_current_user(), require_super_admin()
│   ├── config/
│   │   ├── settings.py          # Pydantic settings, env vars
│   │   └── database.py          # get_auth_engine(), get_lms_engine(), execute_sql()
│   ├── routers/
│   │   ├── auth.py              # /auth/* — login, refresh, logout, user management
│   │   ├── ai_query.py          # /query, /execute, /disambiguate, /answer-mcq, /english-feedback
│   │   ├── feedback.py          # /feedback/logic, /feedback/sql — updates query_logs
│   │   ├── dashboard.py         # /dashboard/stats, /dashboard/logs — superadmin only
│   │   └── chat_persistence.py  # /chats/load, /chats/save — uses user_chats table
│   ├── services/
│   │   ├── llm_service.py       # Gemini API calls with retry logic
│   │   ├── memory_service.py    # DB-backed session memory + query logging
│   │   ├── mcq_service.py       # MCQ question generation
│   │   └── knowledge_base.py    # SQL schema context loader
│   ├── models/
│   │   └── schemas.py           # Pydantic request/response models
│   ├── data/
│   │   └── logs/app.log         # Rotating log (5 MB × 5 backups)
│   └── requirements.txt
│
├── frontend/                    # React 19 + Vite (port 5173)
│   └── src/
│       ├── App.jsx              # Auth gate → Login | Dashboard | ChatApp
│       ├── pages/
│       │   ├── Login.jsx        # Login form
│       │   └── Dashboard.jsx    # Superadmin dashboard — stats + log table
│       ├── components/
│       │   ├── AdminPanel.jsx   # User management modal (superadmin)
│       │   ├── Sidebar.jsx      # Chat list + logout/dashboard/admin links
│       │   ├── Thread.jsx       # Message display
│       │   ├── AiMessage.jsx    # SQL + answer + chart rendering
│       │   ├── MCQMessage.jsx   # MCQ disambiguation UI
│       │   ├── InputDock.jsx    # Query input bar
│       │   └── SettingsModal.jsx
│       └── services/
│           └── api.js           # All API calls + JWT auth + silent refresh interceptor
│
└── knowledge_base/
    └── new_kb.txt               # Current SQL schema and examples
```

---

## Database Schema (auth DB)

Six tables, all on `AUTH_DB_URL`:

| Table | Purpose |
|---|---|
| `users` | User accounts with role + lms_type |
| `refresh_tokens` | Hashed refresh tokens with expiry |
| `query_logs` | Every query + feedback — replaces `conversational_log.jsonl` |
| `sessions` | Session metadata — replaces `sessions.json` |
| `session_turns` | Per-turn conversation history (last 5 kept) |
| `user_chats` | Frontend chat UI state per user (JSONB blob) |

LMS queries (SELECT-only) run against `ONLINE_LMS_URL` or `REGULAR_LMS_URL` depending on the user's `lms_type`.

---

## Roles & Permissions

| Action | super_admin | admin | analyser |
|---|---|---|---|
| Create / manage users | ✅ | ❌ | ❌ |
| View dashboard + all logs | ✅ | ❌ | ❌ |
| Run queries | ✅ | ✅ | ✅ |
| Switch model | ✅ | ✅ | ✅ |
| Give feedback | ✅ | ✅ | ✅ |
| View own chats + sessions | ✅ | ✅ | ✅ |

**LMS routing:**
- `super_admin` — passes `lms_type` in request body per query
- `admin` / `analyser` — `lms_type` fixed to their user record; request body value is ignored

---

## Auth Token Flow

1. `POST /auth/login` → issues 8-hr access token (JWT) + 7-day refresh token
2. Frontend stores both in `localStorage`; every API call sends `Authorization: Bearer <access_token>`
3. On 401 → `api.js` silently calls `POST /auth/refresh` with refresh token → gets new access token → retries original request
4. If refresh token also expired → `logout()` → reload to login page
5. Superadmin can force-logout a user via `/auth/users/{username}/deactivate` — deletes all their refresh tokens from DB

---

## API Endpoints

### Auth (`/auth/*`)

| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/auth/login` | Public | Returns access + refresh tokens |
| POST | `/auth/refresh` | Public | Exchange refresh token for new access token |
| POST | `/auth/logout` | Authenticated | Revoke refresh token |
| POST | `/auth/users/create` | super_admin | Create user, returns plaintext password once |
| GET | `/auth/users` | super_admin | List all users |
| PATCH | `/auth/users/{username}/reset-password` | super_admin | Returns new plaintext password once |
| PATCH | `/auth/users/{username}/deactivate` | super_admin | Deactivate + revoke all refresh tokens |
| PATCH | `/auth/users/{username}/reactivate` | super_admin | Reactivate user |

### Query & Execution (all require auth)

| Method | Path | Description |
|---|---|---|
| POST | `/query` | Generate SQL from natural language |
| POST | `/execute` | Execute pre-generated SQL |
| POST | `/disambiguate` | Generate 3 MCQ clarifying questions |
| POST | `/answer-mcq` | Process MCQ answers → SQL |
| POST | `/english-feedback` | Refine SQL via text feedback |
| POST | `/config/model` | Switch active Gemini model |
| GET | `/config/model` | Get current active model |

### Feedback (all require auth)

| Method | Path | Description |
|---|---|---|
| POST | `/feedback/logic` | Log text feedback → updates `query_logs` |
| POST | `/feedback/sql` | Log corrected SQL → updates `query_logs` |

### Chat Persistence (all require auth — per-user isolation)

| Method | Path | Description |
|---|---|---|
| GET | `/chats/load` | Load current user's chat blob |
| POST | `/chats/save` | Save current user's chat blob |

### Dashboard (super_admin only)

| Method | Path | Description |
|---|---|---|
| GET | `/dashboard/stats` | Summary cards (last 24h counts) |
| GET | `/dashboard/logs` | Paginated log table with filters |

### Health

| Method | Path | Description |
|---|---|---|
| GET | `/` | Service info |
| GET | `/health` | Health check + active model |

---

## Key Configuration (config/settings.py)

| Setting | Default | Purpose |
|---|---|---|
| `GEMINI_MODEL` | `gemini-3.1-flash-lite-preview` | Active LLM model |
| `ALLOWED_MODELS` | [Pro, Flash-lite, Flash preview] | Available models |
| `SESSION_MAX_TURNS` | 5 | Conversation history window for LLM context |
| `AUTH_DB_URL` | — | PostgreSQL for auth + logs + sessions |
| `ONLINE_LMS_URL` | — | PostgreSQL for online LMS queries |
| `REGULAR_LMS_URL` | — | PostgreSQL for regular LMS queries |
| `JWT_SECRET_KEY` | — | Signs all access tokens |
| `JWT_EXPIRY_HOURS` | 8 | Access token lifetime |
| `REFRESH_TOKEN_EXPIRY_DAYS` | 7 | Refresh token lifetime |
| `KNOWLEDGE_BASE_DIR` | `./knowledge_base` | SQL schema + examples location |
| `DATA_DIR` | `./text_to_sql_api/data` | Log file storage |

---

## Query Processing Flow

```
Frontend → POST /query (with Authorization header)
  ↓
get_current_user() — decode JWT, verify user active in DB
  ↓
Resolve lms_type (from request if super_admin, from user record otherwise)
  ↓
Load session history (last 5 turns from session_turns table)
  ↓
LLM: generate_sql() with knowledge base + session context
  ↓
Validate SQL (read-only: SELECT/WITH only)
  ↓
Execute: execute_sql(sql, lms_type) → routes to correct LMS DB
  ↓
LLM: generate_answer() from results
  ↓
INSERT into query_logs (with user_id, lms_type, model, token_usage)
INSERT into session_turns (trim to last 5)
  ↓
Return QueryResponse
  ↓
Frontend: renders in AiMessage, saves chat blob via /chats/save
```

---

## Common Development Tasks

### Testing a Query (with auth)

```bash
# 1. Login
TOKEN=$(curl -s -X POST http://localhost:8001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"mohit.kapoor@degreefyd.com","password":"mohit.kapoor@degreefyd.com"}' \
  | python -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# 2. Query
curl -X POST http://localhost:8001/query \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"session_id":"test","user_query":"How many students are enrolled?","execute":true}'
```

### Resetting a User Password (superadmin)

```bash
curl -X PATCH http://localhost:8001/auth/users/user@domain.com/reset-password \
  -H "Authorization: Bearer $TOKEN"
# Returns: {"success":true,"username":"...","new_password":"..."}
```

### Updating Knowledge Base

- Edit `knowledge_base/new_kb.txt`
- Restart API (loaded at query time, cached in memory)

### Adding a New Gemini Model

1. Add to `ALLOWED_MODELS` in `config/settings.py`
2. Available immediately via `/config/model`

---

## Important Notes

- **SQL Safety**: All LMS queries validated as read-only (SELECT/WITH only), 30-second timeout
- **Session IDs**: Derived from chat ID (`chat-xxx` → `session-xxx`); each user's sessions are isolated by `user_id`
- **Rate Limiting**: 20 queries per 120 seconds per session, in-memory, resets on server restart
- **Feedback**: Endpoints log to `query_logs` table but do not regenerate SQL or update session memory
- **Context Window**: Last 5 session turns kept in `session_turns` table; older turns deleted automatically
- **Chat Isolation**: Each user sees only their own chats via `user_chats` table
- **Seed Passwords**: All seed users' initial password = their username (email address)
- **MCQ Context**: Stored in-memory with 10-minute expiry; lost on server restart
