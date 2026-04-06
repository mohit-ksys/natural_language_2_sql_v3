# Product Requirements Document — DataWhisper

**Version:** 2.0.0  
**Last Updated:** April 2026  
**Status:** Active Development

---

## 1. Product Overview

**DataWhisper** is a conversational Text-to-SQL platform that enables non-technical users (counsellors, analysts, admins) to query a Learning Management System (LMS) database using plain English. Queries are translated into SQL via Google Gemini LLM, executed against a PostgreSQL LMS database, and returned as human-readable answers with optional chart visualizations. The system supports multi-turn conversation memory, MCQ-based disambiguation, a feedback loop for quality improvement, and a superadmin dashboard for operational oversight.

---

## 2. Goals & Objectives

| Goal | Description |
|---|---|
| **Accessibility** | Allow non-SQL users to extract LMS data with natural language |
| **Safety** | All generated SQL is read-only (SELECT/WITH); write operations are blocked |
| **Multi-tenancy** | Users are isolated by role; each user sees only their own chats/sessions |
| **Quality feedback loop** | Users can correct logic, SQL, or provide English refinements; all feedback persists in DB |
| **Operational visibility** | Superadmins can monitor usage, errors, and feedback via a real-time dashboard |

---

## 3. Users & Roles

### 3.1 Role Definitions

| Role | Description |
|---|---|
| `super_admin` | Full platform access. Can manage users, view all logs, switch LMS targets per query |
| `admin` | Can run queries and give feedback. LMS target fixed to their user record |
| `analyser` | Same query/feedback permissions as admin. Read-only on user management |

### 3.2 Permission Matrix

| Feature | super_admin | admin | analyser |
|---|---|---|---|
| Run queries (`/query`, `/execute`) | ✅ | ✅ | ✅ |
| MCQ disambiguation | ✅ | ✅ | ✅ |
| English feedback refinement | ✅ | ✅ | ✅ |
| Submit logic / SQL feedback | ✅ | ✅ | ✅ |
| Switch Gemini model | ✅ | ✅ | ✅ |
| View own chats & sessions | ✅ | ✅ | ✅ |
| Create / deactivate / reactivate users | ✅ | ❌ | ❌ |
| Reset user passwords | ✅ | ❌ | ❌ |
| View dashboard stats & all logs | ✅ | ❌ | ❌ |
| Choose `lms_type` per query | ✅ | ❌ (fixed) | ❌ (fixed) |

### 3.3 LMS Routing

- `super_admin` — specifies `lms_type` (`online` | `regular`) in each request body.
- `admin` / `analyser` — `lms_type` is read from their user record and cannot be overridden.

---

## 4. System Architecture

### 4.1 Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite, port 5173 |
| Backend API | FastAPI (Python), port 8001 |
| LLM | Google Gemini (configurable model) |
| Auth DB | PostgreSQL — users, tokens, logs, sessions, chats |
| LMS DBs | PostgreSQL (online) + PostgreSQL (regular) — read-only |

### 4.2 Database Tables

| Table | Purpose |
|---|---|
| `users` | Accounts with role, lms_type, active flag |
| `refresh_tokens` | Hashed 7-day refresh tokens with revocation flag |
| `query_logs` | Every query attempt + all feedback types + token usage |
| `sessions` | Session metadata per user |
| `session_turns` | Last 5 turns per session for LLM context window |
| `user_chats` | Per-user JSONB blob of all chat UI state |

---

## 5. Feature Requirements

### 5.1 Authentication

**FR-AUTH-01** — Login via `POST /auth/login` with username + password. Returns a signed 8-hour JWT access token and a 7-day refresh token.

**FR-AUTH-02** — Silent token refresh: on receiving a `401`, the frontend automatically calls `POST /auth/refresh` with the refresh token to get a new access token and retries the original request without user interruption.

**FR-AUTH-03** — Logout (`POST /auth/logout`) revokes the refresh token in the database. Chats are saved to the backend before the logout completes.

**FR-AUTH-04** — Superadmin user management:
- Create user — generates a random initial password, returned in plaintext once.
- Reset password — generates a new random password, returned in plaintext once.
- Deactivate user — sets `is_active = false` and deletes all active refresh tokens (force-logout).
- Reactivate user — sets `is_active = true`.

**FR-AUTH-05** — Inactive users receive `401` on all authenticated endpoints.

**FR-AUTH-06** — JWT contains: `sub` (UUID), `username`, `full_name`, `role`, `lms_type`, `exp`.

---

### 5.2 Natural Language Query (`/query`)

**FR-QUERY-01** — Accept a `user_query` (plain English), `session_id`, optional `lms_type` (super_admin only), and optional `execute` flag.

**FR-QUERY-02** — Load last 5 session turns from `session_turns` to provide conversation context to the LLM.

**FR-QUERY-03** — Call Gemini LLM (`generate_sql`) with: user query, session history, knowledge base (SQL schema + examples).

**FR-QUERY-04** — Validate generated SQL: must begin with `SELECT` or `WITH`. Any mutation (INSERT, UPDATE, DELETE, DROP, etc.) returns `403`.

**FR-QUERY-05** — If `execute: true`, run the SQL against the resolved LMS database with a 30-second timeout.

**FR-QUERY-06** — On SQL execution failure, attempt one LLM-based auto-fix (`auto_fix_sql`) and retry. If still failing, return `500`.

**FR-QUERY-07** — If `execute: true`, call `generate_answer` to produce a human-readable summary and a suggested `chart_type` (`Table`, `Bar`, `Line`, `Pie`, etc.).

**FR-QUERY-08** — Log every query attempt (including failures) to `query_logs` with user_id, session_id, model, lms_type, token usage.

**FR-QUERY-09** — After a successful execution, insert/update a `session_turns` row; trim session to last 5 turns.

**FR-QUERY-10** — Rate limit: 20 queries per 120 seconds per session. Excess requests return `429`.

**FR-QUERY-11** — When the session has ≥ 5 turns, include a `session_context_alert` warning in the response.

**FR-QUERY-12** — Empty `user_query` returns `400`.

---

### 5.3 SQL Execution (`/execute`)

**FR-EXEC-01** — Accept pre-generated SQL (from a prior `/query` call) and execute it directly.

**FR-EXEC-02** — Validate SQL read-only constraint before execution; block with `403` if violated.

**FR-EXEC-03** — Return answer, chart_type, data rows, execution time, and optional `feedback_id`.

---

### 5.4 MCQ Disambiguation (`/disambiguate` + `/answer-mcq`)

**FR-MCQ-01** — When `mcqEnabled` setting is on, `/query` calls `/disambiguate` first instead of generating SQL directly.

**FR-MCQ-02** — `POST /disambiguate` calls `generate_mcqs`, which returns 3 multiple-choice clarifying questions with labeled options.

**FR-MCQ-03** — MCQ context (original query, questions, session_id, lms_type) is stored in-memory with a 10-minute expiry keyed by `query_id`.

**FR-MCQ-04** — `POST /answer-mcq` looks up the in-memory context, builds enhanced context from answers, then calls the standard SQL generation pipeline.

**FR-MCQ-05** — If MCQ context is not found or expired, return `404` with a descriptive error.

**FR-MCQ-06** — MCQ state is lost on server restart; the frontend must handle this gracefully.

**FR-MCQ-07** — The user can skip MCQ and proceed to direct query via the frontend Skip button.

---

### 5.5 English Feedback Refinement (`/english-feedback`)

**FR-EFEEDBACK-01** — Accept a `query_id` (from a prior MCQ or disambiguate call) and a `feedback` text string.

**FR-EFEEDBACK-02** — Combine the original query, prior MCQ context, and the new feedback text into a single enriched prompt context.

**FR-EFEEDBACK-03** — Re-run the standard SQL generation and optional execution pipeline with the enriched context.

**FR-EFEEDBACK-04** — Store `has_english_feedback = true`, `english_feedback_text`, and `regenerated_sql` in the `query_logs` row.

---

### 5.6 Feedback (`/feedback/logic`, `/feedback/sql`)

**FR-FB-01** — `POST /feedback/logic` — store free-text logic feedback in `query_logs.logic_feedback_text`; set `has_logic_feedback = true` and `has_any_feedback = true`.

**FR-FB-02** — `POST /feedback/sql` — store a user-corrected SQL string in `query_logs.corrected_sql`; set `has_sql_feedback = true` and `has_any_feedback = true`.

**FR-FB-03** — Feedback endpoints do **not** regenerate SQL or update session memory; they only persist to the database.

---

### 5.7 Chat Persistence

**FR-CHAT-01** — `GET /chats/load` — returns the calling user's `chats_blob` (JSONB) and `last_chat_id` from `user_chats`.

**FR-CHAT-02** — `POST /chats/save` — upserts the calling user's chat state JSONB blob.

**FR-CHAT-03** — Chat data is strictly per-user; users cannot access other users' chats.

**FR-CHAT-04** — Chats are saved to the backend automatically on: new message, new chat creation, rename, pin/unpin, delete, and pre-logout.

**FR-CHAT-05** — Chat titles are auto-generated from the first query text (truncated to 38 characters).

---

### 5.8 Model Configuration

**FR-MODEL-01** — `POST /config/model` — switch the active Gemini model (available to all authenticated users).

**FR-MODEL-02** — `GET /config/model` — return the current active model name.

**FR-MODEL-03** — Allowed models are defined in `ALLOWED_MODELS` in `settings.py`. Requests for unlisted models return `400`.

**FR-MODEL-04** — Thinking mode (`thinking_enabled`, `thinking_level`, `include_thoughts`) can be toggled per query.

---

### 5.9 Superadmin Dashboard

**FR-DASH-01** — `GET /dashboard/stats` — return summary stats for the last 24 hours: total queries, errors, queries with feedback, most active user.

**FR-DASH-02** — `GET /dashboard/logs` — return paginated (default 50, max 200 per page) query log rows with full details.

**FR-DASH-03** — Dashboard logs support filters: username, feedback_type (`logic` | `sql` | `english` | `any`), has_error (`yes` | `no`), model, lms_type, date_from, date_to.

**FR-DASH-04** — Dashboard is restricted to `super_admin` role; any other role returns `403`.

---

### 5.10 Frontend UI

**FR-UI-01** — Login page with username/password form; redirects to chat on success.

**FR-UI-02** — Chat sidebar listing all user chats with pin, rename, delete actions.

**FR-UI-03** — `AiMessage` component renders: SQL block (collapsible), human-readable answer, chart visualization (if applicable), token usage, execution time, feedback buttons (logic/SQL).

**FR-UI-04** — `MCQMessage` component renders MCQ questions with radio/select inputs and a submit button; includes a Skip option.

**FR-UI-05** — `InputDock` supports model selection dropdown and thinking-mode toggle.

**FR-UI-06** — `SettingsModal` provides toggles for: Auto-run query, Hide SQL, MCQ mode; shows backend connection status.

**FR-UI-07** — `AdminPanel` (superadmin only) — create user, list users, reset password, deactivate/reactivate.

**FR-UI-08** — Toast notification system for errors, warnings, and context alerts (queued, non-overlapping).

**FR-UI-09** — Backend connection status indicator (connected/disconnected) shown in settings.

**FR-UI-10** — On `401` responses, the frontend silently refreshes the access token before retrying. On refresh failure, redirects to login.

---

## 6. Non-Functional Requirements

### 6.1 Security

- **NFR-SEC-01** — All LMS queries are validated as `SELECT`/`WITH` only before execution; any write SQL is blocked with `403`.
- **NFR-SEC-02** — Passwords stored as bcrypt hashes; refresh tokens stored as bcrypt hashes.
- **NFR-SEC-03** — JWT signed with `HS256`; secret key rotation force-logs out all users with access tokens.
- **NFR-SEC-04** — Refresh tokens support individual revocation (logout) and bulk revocation (deactivate user).
- **NFR-SEC-05** — `.env` must never be committed to version control.
- **NFR-SEC-06** — CORS is currently set to `allow_origins=["*"]`; should be locked to the frontend origin in production.

### 6.2 Performance

- **NFR-PERF-01** — LMS SQL execution timeout: 30 seconds.
- **NFR-PERF-02** — Rate limit: 20 LLM-backed query generations per 120 seconds per session (in-memory, resets on restart).
- **NFR-PERF-03** — Session turns window: last 5 turns only — controls LLM prompt size.
- **NFR-PERF-04** — Log file: rotating, 5 MB per file, 5 backups.

### 6.3 Reliability

- **NFR-REL-01** — LLM calls include retry logic (handled in `llm_service.py`).
- **NFR-REL-02** — SQL execution failures trigger one LLM-based auto-fix attempt before returning an error.
- **NFR-REL-03** — Health endpoint (`GET /health`) returns active model name for uptime monitoring.

### 6.4 Observability

- **NFR-OBS-01** — All query attempts (success and failure) are persisted to `query_logs`.
- **NFR-OBS-02** — Structured application logging to rotating file at `text_to_sql_api/data/logs/app.log`.
- **NFR-OBS-03** — Token usage (input + output tokens, model name) recorded per query.

---

## 7. API Reference Summary

### Auth Endpoints

| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/auth/login` | Public | Returns access + refresh tokens |
| POST | `/auth/refresh` | Public | Exchange refresh token for new access token |
| POST | `/auth/logout` | Authenticated | Revoke refresh token |
| POST | `/auth/users/create` | super_admin | Create user; returns plaintext password once |
| GET | `/auth/users` | super_admin | List all users |
| PATCH | `/auth/users/{username}/reset-password` | super_admin | Returns new plaintext password once |
| PATCH | `/auth/users/{username}/deactivate` | super_admin | Deactivate + revoke all refresh tokens |
| PATCH | `/auth/users/{username}/reactivate` | super_admin | Reactivate user |

### Query Endpoints (all require auth)

| Method | Path | Description |
|---|---|---|
| POST | `/query` | Generate SQL from natural language (+ optional execute) |
| POST | `/execute` | Execute pre-generated SQL |
| POST | `/disambiguate` | Generate 3 MCQ clarifying questions |
| POST | `/answer-mcq` | Process MCQ answers → generate SQL |
| POST | `/english-feedback` | Refine SQL via free-text feedback |
| POST | `/config/model` | Switch active Gemini model |
| GET | `/config/model` | Get current active model |

### Feedback Endpoints (all require auth)

| Method | Path | Description |
|---|---|---|
| POST | `/feedback/logic` | Log free-text logic feedback |
| POST | `/feedback/sql` | Log corrected SQL |

### Chat Endpoints (all require auth)

| Method | Path | Description |
|---|---|---|
| GET | `/chats/load` | Load user's chat blob |
| POST | `/chats/save` | Save user's chat blob |

### Dashboard (super_admin only)

| Method | Path | Description |
|---|---|---|
| GET | `/dashboard/stats` | Summary stats (last 24h + all time) |
| GET | `/dashboard/logs` | Paginated + filtered query log |

### Health

| Method | Path | Description |
|---|---|---|
| GET | `/` | Service info |
| GET | `/health` | Health check + active model |

---

## 8. Data Flow — Query Processing

```
Frontend → POST /query (Authorization: Bearer <token>)
  ↓
get_current_user()  →  verify JWT  →  check user is_active in DB
  ↓
Resolve lms_type: super_admin uses request body; others use user record
  ↓
Enforce rate limit (20 / 120s per session_id)
  ↓
Load last 5 session_turns from DB → format for LLM prompt
  ↓
LLM: generate_sql(user_query, session_history, knowledge_base)
  ↓
Validate SQL read-only → block if not SELECT/WITH
  ↓
[if execute=true] execute_sql(sql, lms_type) → route to correct LMS DB
  ↓
[on failure] LLM: auto_fix_sql → retry once
  ↓
LLM: generate_answer(user_query, results) → answer text + chart_type
  ↓
INSERT query_logs  →  INSERT/UPDATE session_turns (trim to 5)
  ↓
Return QueryResponse to frontend
  ↓
Frontend: render AiMessage → auto-save chat blob via POST /chats/save
```

---

## 9. Known Constraints & Limitations

| Constraint | Impact |
|---|---|
| MCQ context is in-memory | Lost on server restart; users must re-query |
| Rate limit is in-memory | Resets on restart; does not persist across instances |
| Session context window = 5 turns | Older conversation turns are not sent to LLM |
| CORS `allow_origins=["*"]` | Needs to be restricted for production |
| Seed user passwords = their username | Must be changed after initial setup |
| LMS DBs are read-only | No write operations are supported |
| Single active Gemini model (global) | Model switch affects all users simultaneously |

---

## 10. Out of Scope (v2.0.0)

- Multi-database query federation (cross-LMS joins)
- Per-user model preferences
- Email notifications
- Export to CSV/Excel from UI
- Webhook integrations
- Fine-tuned LLM on LMS-specific schema
