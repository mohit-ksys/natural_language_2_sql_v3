# Test Cases — DataWhisper

**Version:** 2.0.0  
**Last Updated:** April 2026  
**Backend Base URL:** `http://localhost:8001`  
**Frontend URL:** `http://localhost:5173`

---

## Legend

| Symbol | Meaning |
|---|---|
| ✅ | Expected: success / pass |
| ❌ | Expected: failure / blocked |
| `→` | Then / returns |

---

## TC-AUTH — Authentication

### TC-AUTH-01: Successful Login
- **Endpoint:** `POST /auth/login`
- **Input:** `{ "username": "mohit.kapoor@degreefyd.com", "password": "mohit.kapoor@degreefyd.com" }`
- **Expected:** `200` → `{ access_token, refresh_token, token_type: "bearer" }` ✅
- **Verify:** JWT decodes to correct `sub`, `role`, `username`, `exp` ~8 hours from now

### TC-AUTH-02: Wrong Password
- **Endpoint:** `POST /auth/login`
- **Input:** `{ "username": "mohit.kapoor@degreefyd.com", "password": "wrongpassword" }`
- **Expected:** `401 Unauthorized` ❌

### TC-AUTH-03: Non-existent User
- **Endpoint:** `POST /auth/login`
- **Input:** `{ "username": "nobody@example.com", "password": "anything" }`
- **Expected:** `401 Unauthorized` ❌

### TC-AUTH-04: Inactive User Login
- **Setup:** Deactivate a user via `/auth/users/{username}/deactivate`
- **Endpoint:** `POST /auth/login`
- **Input:** Credentials of deactivated user
- **Expected:** `401` with message indicating account is inactive ❌

### TC-AUTH-05: Token Refresh — Valid Refresh Token
- **Endpoint:** `POST /auth/refresh`
- **Input:** `{ "refresh_token": "<valid_refresh_token>" }`
- **Expected:** `200` → new `access_token` ✅
- **Verify:** Old access token still works until its `exp`; new token has fresh `exp`

### TC-AUTH-06: Token Refresh — Expired/Invalid Refresh Token
- **Endpoint:** `POST /auth/refresh`
- **Input:** `{ "refresh_token": "tampered_or_expired_token" }`
- **Expected:** `401 Unauthorized` ❌

### TC-AUTH-07: Token Refresh — Revoked Refresh Token
- **Setup:** Call `POST /auth/logout` to revoke the token
- **Endpoint:** `POST /auth/refresh`
- **Input:** The revoked refresh token
- **Expected:** `401 Unauthorized` ❌

### TC-AUTH-08: Logout
- **Endpoint:** `POST /auth/logout`
- **Headers:** `Authorization: Bearer <access_token>`
- **Input:** `{ "refresh_token": "<refresh_token>" }`
- **Expected:** `200` → `{ "success": true }` ✅
- **Verify:** Subsequent refresh with same token returns `401`

### TC-AUTH-09: Accessing Protected Endpoint Without Token
- **Endpoint:** `POST /query`
- **Headers:** none
- **Expected:** `401 Unauthorized` ❌

### TC-AUTH-10: Accessing Protected Endpoint With Expired Access Token
- **Setup:** Use a token with `exp` in the past (manually crafted or wait for expiry)
- **Expected:** `401` → frontend silently calls refresh → retries → succeeds ✅

---

## TC-USERMGMT — User Management (super_admin only)

### TC-USERMGMT-01: Create User — Success
- **Endpoint:** `POST /auth/users/create`
- **Auth:** super_admin token
- **Input:** `{ "username": "newuser@test.com", "full_name": "New User", "role": "admin", "lms_type": "online" }`
- **Expected:** `200` → `{ username, full_name, role, lms_type, password: "<plaintext once>" }` ✅
- **Verify:** User appears in `GET /auth/users`; password is never returned again

### TC-USERMGMT-02: Create User — Non-superadmin Attempt
- **Auth:** admin or analyser token
- **Input:** Same as TC-USERMGMT-01
- **Expected:** `403 Forbidden` ❌

### TC-USERMGMT-03: Create User — Duplicate Username
- **Setup:** Create the same username twice
- **Expected:** Second call → `409 Conflict` or `400` ❌

### TC-USERMGMT-04: Create User — Invalid Role
- **Input:** `{ ..., "role": "god_mode" }`
- **Expected:** `422 Unprocessable Entity` ❌

### TC-USERMGMT-05: List Users
- **Endpoint:** `GET /auth/users`
- **Auth:** super_admin token
- **Expected:** `200` → array of user objects ✅
- **Verify:** Contains all seeded users; does not include hashed passwords

### TC-USERMGMT-06: Reset Password
- **Endpoint:** `PATCH /auth/users/{username}/reset-password`
- **Auth:** super_admin token
- **Expected:** `200` → `{ success: true, username, new_password }` ✅
- **Verify:** Old password no longer works; new_password works for login

### TC-USERMGMT-07: Deactivate User
- **Endpoint:** `PATCH /auth/users/{username}/deactivate`
- **Auth:** super_admin token
- **Expected:** `200` → `{ success: true }` ✅
- **Verify:** User's existing refresh tokens are deleted; next API call with their token → `401`

### TC-USERMGMT-08: Reactivate User
- **Setup:** Deactivated user
- **Endpoint:** `PATCH /auth/users/{username}/reactivate`
- **Auth:** super_admin token
- **Expected:** `200` → `{ success: true }` ✅
- **Verify:** User can log in again

### TC-USERMGMT-09: Deactivate Self
- **Endpoint:** `PATCH /auth/users/{own_username}/deactivate`
- **Auth:** super_admin token
- **Expected:** Should be blocked or return a warning (depends on implementation) ❌/✅ TBD

---

## TC-QUERY — Natural Language Query

### TC-QUERY-01: Basic Query (generate SQL only, no execute)
- **Endpoint:** `POST /query`
- **Auth:** Any authenticated user
- **Input:**
  ```json
  {
    "session_id": "session-test-01",
    "user_query": "How many students are enrolled?",
    "execute": false
  }
  ```
- **Expected:** `200` → `{ feedback_id, session_id, sql, execution_time, cached: false, executed: false }` ✅
- **Verify:** `sql` starts with `SELECT` or `WITH`

### TC-QUERY-02: Query With Execute
- **Input:** Same as TC-QUERY-01 with `"execute": true`
- **Expected:** `200` → `{ ..., executed: true, answer, chart_type, data: [...] }` ✅
- **Verify:** `answer` is a non-empty string; `data` is an array of row objects

### TC-QUERY-03: Empty Query String
- **Input:** `{ "session_id": "session-01", "user_query": "   ", "execute": false }`
- **Expected:** `400 Bad Request` ❌ with detail `"user_query is required."`

### TC-QUERY-04: Invalid Model Specified
- **Input:** `{ ..., "user_query": "list students", "model": "gpt-4-ultra-pro" }`
- **Expected:** `400 Bad Request` ❌ with detail listing allowed models

### TC-QUERY-05: SQL Safety Block — Write Operation Attempt
- **Setup:** Craft a query that tricks the LLM into generating `DELETE` or `UPDATE`
- **Mock:** Inject a non-read-only SQL directly if LLM testing is unavailable
- **Expected:** `403 Forbidden` ❌ with `"Generated SQL is not read-only. Operation blocked."`
- **Verify:** Violation is logged in `query_logs.error_message`

### TC-QUERY-06: Rate Limiting
- **Setup:** Send 21 queries to the same `session_id` within 120 seconds
- **Expected:** 21st request → `429 Too Many Requests` ❌
- **Verify:** Detail message references session_id and limit values

### TC-QUERY-07: Session Context Alert
- **Setup:** Send 5+ queries on the same session_id
- **Expected:** 6th query response includes `session_context_alert: "⚠️ Session context limited to last 5 queries"` ✅

### TC-QUERY-08: LMS Routing — super_admin Explicit lms_type
- **Auth:** super_admin token
- **Input:** `{ ..., "lms_type": "regular", "execute": true }`
- **Expected:** SQL executed against `REGULAR_LMS_URL` ✅
- **Verify:** Check `query_logs.lms_type = 'regular'`

### TC-QUERY-09: LMS Routing — admin/analyser Cannot Override lms_type
- **Auth:** admin token (lms_type = `online` in user record)
- **Input:** `{ ..., "lms_type": "regular", "execute": true }`
- **Expected:** Query runs against `online` DB (request body value ignored) ✅
- **Verify:** `query_logs.lms_type = 'online'`

### TC-QUERY-10: Token Usage Returned
- **Input:** Any valid query
- **Expected:** Response includes `token_usage: { model, input_tokens, output_tokens }` ✅

### TC-QUERY-11: Conversation Context Carries Across Turns
- **Setup:** Turn 1: "How many students are enrolled?" → Turn 2: "Show me the top 5 of them"
- **Expected:** Turn 2 SQL is contextually aware of the prior question (references student data) ✅
- **Verify:** LLM prompt contained prior turn data (check session_turns table)

### TC-QUERY-12: Auto-Fix on SQL Execution Error
- **Setup:** LMS DB has a column name mismatch causing initial SQL to fail
- **Expected:** System retries with `auto_fix_sql`, second attempt succeeds ✅
- **Verify:** `query_logs.is_fix = true` on the successful retry

---

## TC-EXECUTE — Direct SQL Execution

### TC-EXEC-01: Execute Valid SELECT SQL
- **Endpoint:** `POST /execute`
- **Auth:** Any authenticated user
- **Input:** `{ "sql": "SELECT COUNT(*) FROM students", "session_id": "session-exec-01" }`
- **Expected:** `200` → `{ answer, chart_type, data, execution_time }` ✅

### TC-EXEC-02: Execute Non-read-only SQL
- **Input:** `{ "sql": "DELETE FROM students WHERE id = 1", "session_id": "session-exec-01" }`
- **Expected:** `403 Forbidden` ❌ with `"Non-read-only SQL blocked."`

### TC-EXEC-03: Execute Malformed SQL
- **Input:** `{ "sql": "SELECT * FROM nonexistent_table_xyz", "session_id": "session-exec-01" }`
- **Expected:** `500 Internal Server Error` ❌ with SQL execution error detail

### TC-EXEC-04: Execute With lms_type (super_admin)
- **Auth:** super_admin
- **Input:** `{ "sql": "SELECT 1", "session_id": "s1", "lms_type": "regular" }`
- **Expected:** Executed against `REGULAR_LMS_URL` ✅

---

## TC-MCQ — MCQ Disambiguation

### TC-MCQ-01: Generate MCQ Questions
- **Endpoint:** `POST /disambiguate`
- **Auth:** Any authenticated user
- **Input:** `{ "user_query": "Show me student progress", "session_id": "session-mcq-01" }`
- **Expected:** `200` → `{ query_id, session_id, questions: [...3 questions...], original_query }` ✅
- **Verify:** Each question has `question_id`, `question_text`, `options` (array with `label` and `text`)

### TC-MCQ-02: Empty Query to Disambiguate
- **Input:** `{ "user_query": "", "session_id": "session-mcq-01" }`
- **Expected:** `400 Bad Request` ❌

### TC-MCQ-03: Answer MCQ — Success
- **Setup:** First call `/disambiguate` to get `query_id` and question count (3)
- **Endpoint:** `POST /answer-mcq`
- **Input:** `{ "query_id": "<id>", "session_id": "session-mcq-01", "answers": [0, 1, 2], "execute": true }`
- **Expected:** `200` → standard `QueryResponse` ✅

### TC-MCQ-04: Answer MCQ — Wrong Answer Count
- **Input:** `{ "query_id": "<id>", "session_id": "...", "answers": [0] }` (only 1 answer for 3 questions)
- **Expected:** `400 Bad Request` ❌ with message about expected vs got answer count

### TC-MCQ-05: Answer MCQ — Expired/Missing Context
- **Input:** `{ "query_id": "nonexistent-uuid", "session_id": "...", "answers": [0, 1, 2] }`
- **Expected:** `404 Not Found` ❌ with `"Query context not found or expired."`

### TC-MCQ-06: MCQ Context Expiry (10 minutes)
- **Setup:** Get a `query_id`, wait 10+ minutes (or mock expiry)
- **Endpoint:** `POST /answer-mcq`
- **Expected:** `404 Not Found` ❌

### TC-MCQ-07: Rate Limit Applied to MCQ Flow
- **Setup:** Send 21 disambiguate requests to same session in 120 seconds
- **Expected:** 21st request → `429` ❌

---

## TC-EFEEDBACK — English Feedback Refinement

### TC-EFEEDBACK-01: Refine via English Feedback
- **Setup:** Call `/disambiguate` to get a `query_id`
- **Endpoint:** `POST /english-feedback`
- **Input:** `{ "query_id": "<id>", "session_id": "...", "feedback": "Only show students from Mumbai", "execute": true }`
- **Expected:** `200` → `QueryResponse` with refined SQL ✅
- **Verify:** `query_logs.has_english_feedback = true`, `english_feedback_text` stored

### TC-EFEEDBACK-02: Empty Feedback Text
- **Input:** `{ "query_id": "<id>", "session_id": "...", "feedback": "   " }`
- **Expected:** `400 Bad Request` ❌

### TC-EFEEDBACK-03: Invalid query_id
- **Input:** `{ "query_id": "fake-id", "session_id": "...", "feedback": "some feedback" }`
- **Expected:** `404 Not Found` ❌

---

## TC-FEEDBACK — Logic & SQL Feedback

### TC-FEEDBACK-01: Submit Logic Feedback
- **Endpoint:** `POST /feedback/logic`
- **Auth:** Any authenticated user
- **Input:** `{ "feedback_id": "<uuid>", "text_feedback": "The query missed part-time students", "session_id": "session-01" }`
- **Expected:** `200` → `{ success: true, feedback_id, new_sql }` ✅
- **Verify:** `query_logs.has_logic_feedback = true`, `logic_feedback_text` populated, `has_any_feedback = true`

### TC-FEEDBACK-02: Submit SQL Feedback
- **Endpoint:** `POST /feedback/sql`
- **Input:** `{ "feedback_id": "<uuid>", "corrected_sql": "SELECT * FROM students WHERE status='active'", "session_id": "session-01" }`
- **Expected:** `200` → `{ success: true, feedback_id, new_sql }` ✅
- **Verify:** `query_logs.has_sql_feedback = true`, `corrected_sql` populated, `has_any_feedback = true`

### TC-FEEDBACK-03: Feedback Does Not Regenerate SQL
- **Verify:** After submitting feedback, `session_turns` is NOT updated with new entries
- **Verify:** Re-running the same session query does not reference feedback content (it's not injected into session context)

### TC-FEEDBACK-04: Invalid feedback_id
- **Input:** `{ "feedback_id": "00000000-0000-0000-0000-000000000000", ... }`
- **Expected:** `404 Not Found` or `400` ❌

---

## TC-CHAT — Chat Persistence

### TC-CHAT-01: Save and Load Chats
- **Setup:** Save a chat blob via `POST /chats/save`
- **Endpoint:** `GET /chats/load`
- **Expected:** Returns same blob with correct `chats` and `last_chat_id` ✅

### TC-CHAT-02: Chat Isolation Between Users
- **Setup:** User A saves chats; User B calls `GET /chats/load`
- **Expected:** User B gets their own chats only, not User A's ✅

### TC-CHAT-03: Load — No Chats Yet
- **Setup:** New user, no prior chats
- **Expected:** `200` → `{ ok: true, chats: [], last_chat_id: null }` or equivalent empty state ✅

### TC-CHAT-04: Save Empty Chat Blob
- **Input:** `{ "chats": [], "last_chat_id": null }`
- **Expected:** `200` → success ✅

### TC-CHAT-05: Unauthenticated Chat Load
- **Expected:** `401 Unauthorized` ❌

---

## TC-MODEL — Model Configuration

### TC-MODEL-01: Get Current Model
- **Endpoint:** `GET /config/model`
- **Auth:** Any authenticated user
- **Expected:** `200` → `{ active_model: "gemini-3.1-flash-lite-preview" }` ✅

### TC-MODEL-02: Switch to Valid Model
- **Endpoint:** `POST /config/model`
- **Input:** `{ "model": "gemini-2.0-flash" }` (or any model in ALLOWED_MODELS)
- **Expected:** `200` → `{ active_model: "gemini-2.0-flash" }` ✅
- **Verify:** Subsequent `GET /config/model` returns new model

### TC-MODEL-03: Switch to Invalid Model
- **Input:** `{ "model": "gpt-5-turbo" }`
- **Expected:** `400 Bad Request` ❌ with list of allowed models

### TC-MODEL-04: Model Change is Global
- **Setup:** User A switches model to X; User B calls `GET /config/model`
- **Expected:** User B also sees model X ✅ (global state)

---

## TC-DASHBOARD — Superadmin Dashboard

### TC-DASH-01: Get Stats — super_admin
- **Endpoint:** `GET /dashboard/stats`
- **Auth:** super_admin token
- **Expected:** `200` → `{ total_queries_24h, total_queries_all_time, most_active_user_24h, errors_24h, feedback_queries_24h }` ✅
- **Verify:** `total_queries_all_time` ≥ `total_queries_24h`

### TC-DASH-02: Get Stats — Non-superadmin
- **Auth:** admin or analyser token
- **Expected:** `403 Forbidden` ❌

### TC-DASH-03: Get Logs — Default Pagination
- **Endpoint:** `GET /dashboard/logs`
- **Auth:** super_admin token
- **Expected:** `200` → `{ logs: [...], total, page: 1, page_size: 50, total_pages }` ✅
- **Verify:** `logs` has at most 50 entries; `total_pages` = `ceil(total / 50)`

### TC-DASH-04: Get Logs — Filter by Username
- **Endpoint:** `GET /dashboard/logs?username=mohit.kapoor@degreefyd.com`
- **Expected:** All returned logs belong to that username ✅

### TC-DASH-05: Get Logs — Filter by feedback_type=any
- **Endpoint:** `GET /dashboard/logs?feedback_type=any`
- **Expected:** All returned logs have `has_any_feedback = true` ✅

### TC-DASH-06: Get Logs — Filter by has_error=yes
- **Endpoint:** `GET /dashboard/logs?has_error=yes`
- **Expected:** All returned logs have non-empty `error_message` ✅

### TC-DASH-07: Get Logs — Filter by Date Range
- **Endpoint:** `GET /dashboard/logs?date_from=2026-04-01&date_to=2026-04-30`
- **Expected:** All returned logs have `created_at_utc` within April 2026 ✅

### TC-DASH-08: Get Logs — Combined Filters
- **Endpoint:** `GET /dashboard/logs?username=user@test.com&feedback_type=sql&has_error=no&lms_type=online`
- **Expected:** Results match ALL filter conditions simultaneously ✅

### TC-DASH-09: Get Logs — page_size Exceeds Max
- **Endpoint:** `GET /dashboard/logs?page_size=300`
- **Expected:** `422 Unprocessable Entity` ❌ (max is 200)

### TC-DASH-10: Get Logs — Non-superadmin
- **Auth:** admin token
- **Expected:** `403 Forbidden` ❌

---

## TC-HEALTH — Health Endpoints

### TC-HEALTH-01: Root
- **Endpoint:** `GET /`
- **Auth:** None required
- **Expected:** `200` → `{ status: "ok", service: "DataWhisper API", version: "2.0.0" }` ✅

### TC-HEALTH-02: Health Check
- **Endpoint:** `GET /health`
- **Auth:** None required
- **Expected:** `200` → `{ status: "ok", active_model: "<current model>" }` ✅

---

## TC-FRONTEND — Frontend UI

### TC-FE-01: Login Flow
- **Action:** Open app → Login page displayed → Enter valid credentials → Submit
- **Expected:** Redirected to chat interface; user name visible in sidebar ✅

### TC-FE-02: Login Failure
- **Action:** Enter wrong password → Submit
- **Expected:** Error message displayed; stays on login page ❌ shown as friendly error

### TC-FE-03: Logout Flow
- **Action:** Click logout in sidebar
- **Expected:** Chats saved to backend first; tokens cleared from localStorage; redirect to login ✅

### TC-FE-04: New Chat Creation
- **Action:** Click "New Chat" in sidebar
- **Expected:** New chat appears in list with title "New Chat"; input dock is active ✅

### TC-FE-05: Chat Title Auto-generation
- **Action:** Send first message in a new chat
- **Expected:** Chat title updates to the first ~38 characters of the query ✅

### TC-FE-06: Send Query — Auto-run Off
- **Settings:** `autoRunQuery = false`
- **Action:** Type query → Submit
- **Expected:** AI message shows SQL block; no results/answer displayed ✅

### TC-FE-07: Send Query — Auto-run On
- **Settings:** `autoRunQuery = true`
- **Action:** Type query → Submit
- **Expected:** AI message shows SQL + answer + data table/chart ✅

### TC-FE-08: MCQ Mode — Enable and Query
- **Settings:** `mcqEnabled = true`
- **Action:** Type an ambiguous query
- **Expected:** MCQ widget rendered with 3 questions and option selects ✅

### TC-FE-09: MCQ Mode — Submit Answers
- **Action:** Select answers to all 3 MCQ questions → Submit
- **Expected:** SQL + answer generated based on refined context ✅

### TC-FE-10: MCQ Mode — Skip
- **Action:** Click "Skip" on MCQ widget
- **Expected:** Direct query sent without MCQ context; SQL generated immediately ✅

### TC-FE-11: Rename Chat
- **Action:** Right-click / use rename option on a chat in sidebar → Enter new title
- **Expected:** Chat title updated in sidebar and persisted to backend ✅

### TC-FE-12: Pin Chat
- **Action:** Pin a chat in sidebar
- **Expected:** Pinned chat moves to top; pin state persisted to backend ✅

### TC-FE-13: Delete Chat
- **Action:** Delete current chat
- **Expected:** Chat removed from sidebar; next available chat loaded (or empty state if none) ✅

### TC-FE-14: Chat Persistence on Reload
- **Action:** Add messages to a chat → Reload page
- **Expected:** Chats and messages restored from backend; same chat re-opened ✅

### TC-FE-15: Model Selector
- **Action:** Change model in InputDock dropdown
- **Expected:** Subsequent queries use selected model; `token_usage.model` in response matches ✅

### TC-FE-16: Thinking Mode Toggle
- **Action:** Toggle "Think" on in InputDock
- **Expected:** Next query sent with `thinking_enabled: true` ✅

### TC-FE-17: Settings — Hide SQL Toggle
- **Settings:** `hideQuery = true`
- **Expected:** SQL block not visible in AI messages ✅

### TC-FE-18: Toast Notifications
- **Trigger:** Rate limit hit (429 response)
- **Expected:** Toast notification appears with error message; auto-dismisses ✅

### TC-FE-19: Session Context Alert Toast
- **Setup:** Run 5+ queries in same chat
- **Expected:** Toast displays `"⚠️ Session context limited to last 5 queries"` for 3 seconds ✅

### TC-FE-20: Silent Token Refresh
- **Setup:** Let access token expire; have valid refresh token
- **Action:** Send a query
- **Expected:** Request fails with 401 → frontend silently refreshes → retries → succeeds without user noticing ✅

### TC-FE-21: Refresh Token Expired — Redirect to Login
- **Setup:** Both access and refresh tokens expired
- **Action:** Send any API request
- **Expected:** User redirected to login page ✅

### TC-FE-22: Backend Disconnected Indicator
- **Setup:** Stop the backend server
- **Action:** Open settings modal
- **Expected:** Backend status shows "disconnected" ✅

### TC-FE-23: Admin Panel — Create User (super_admin)
- **Auth:** Logged in as super_admin
- **Action:** Open Admin Panel → Fill in user details → Create
- **Expected:** New user appears in user list; initial password shown once ✅

### TC-FE-24: Admin Panel — Not Visible for non-superadmin
- **Auth:** Logged in as admin or analyser
- **Expected:** Admin link in sidebar not rendered; AdminPanel not accessible ✅

### TC-FE-25: Dashboard Access (super_admin)
- **Auth:** Logged in as super_admin
- **Action:** Click Dashboard in sidebar
- **Expected:** Dashboard page renders with stats cards and log table ✅

### TC-FE-26: Dashboard Not Accessible for non-superadmin
- **Auth:** admin or analyser
- **Expected:** Dashboard link not shown in sidebar ✅

---

## TC-SECURITY — Security & Boundary Tests

### TC-SEC-01: SQL Injection in user_query
- **Input:** `{ "user_query": "'; DROP TABLE students; --", "session_id": "...", "execute": true }`
- **Expected:** LLM generates a safe SELECT query or returns an error; `DROP TABLE` never executes ✅

### TC-SEC-02: Accessing Another User's Chat
- **Setup:** User A has chats; User B is authenticated
- **Action:** User B calls `GET /chats/load`
- **Expected:** Returns only User B's chats ✅ (isolation enforced by JWT user_id)

### TC-SEC-03: Accessing Dashboard with Forged Role Claim
- **Setup:** Forge a JWT with `role: "super_admin"` but signed with wrong secret
- **Expected:** `401 Unauthorized` (signature verification fails) ❌

### TC-SEC-04: Non-read-only SQL in /execute
- **Input:** Various mutations: `UPDATE`, `INSERT`, `DELETE`, `DROP`, `TRUNCATE`, `ALTER`
- **Expected:** All blocked with `403` ❌ before DB connection is made

### TC-SEC-05: WITH Clause (CTE) is Allowed
- **Input:** `{ "sql": "WITH cte AS (SELECT * FROM students) SELECT * FROM cte", "session_id": "..." }`
- **Expected:** `200` → executes successfully ✅ (CTEs with SELECT are read-only)

### TC-SEC-06: Refresh Token Replay After Logout
- **Setup:** Log out (token revoked); try to use same refresh token again
- **Expected:** `401` ❌ (revoked token rejected)

---

## TC-RATELIMIT — Rate Limiting

### TC-RATE-01: 20 Queries Under Limit
- **Action:** Send exactly 20 queries to same `session_id` within 120 seconds
- **Expected:** All 20 succeed ✅

### TC-RATE-02: 21st Query Hits Limit
- **Action:** Send 21st query within same window
- **Expected:** `429 Too Many Requests` ❌

### TC-RATE-03: Rate Limit Resets After Window
- **Action:** Wait 120 seconds after hitting limit; send another query
- **Expected:** Succeeds ✅

### TC-RATE-04: Rate Limit is Per Session (not per user)
- **Setup:** User sends 20 queries on session-A; then sends query on session-B
- **Expected:** Query on session-B succeeds ✅ (different session_id, different bucket)

### TC-RATE-05: Rate Limit Resets on Server Restart
- **Setup:** Hit rate limit; restart the backend server
- **Expected:** New queries on same session_id succeed ✅ (in-memory state cleared)

---

## TC-KNOWLEDGE — Knowledge Base

### TC-KB-01: Knowledge Base Loaded at Query Time
- **Setup:** Edit `knowledge_base/new_kb.txt`; restart API
- **Action:** Run a query that references the new schema content
- **Expected:** LLM uses updated schema context ✅

### TC-KB-02: Missing Knowledge Base File
- **Setup:** Rename or delete `new_kb.txt`; restart API
- **Expected:** Startup warning logged; queries may fail gracefully or use empty context ✅

---

## TC-SESSION — Session Memory

### TC-SESSION-01: Last 5 Turns Kept
- **Setup:** Run 7 turns in a session
- **Expected:** `session_turns` table contains exactly 5 rows for that session_id ✅
- **Verify:** Oldest 2 turns were deleted

### TC-SESSION-02: Session Isolation Between Users
- **Setup:** User A and User B use the same `session_id` string
- **Expected:** Each user's session turns are stored under their own `user_id`; they don't share context ✅

### TC-SESSION-03: New Session Starts Fresh
- **Setup:** Start a brand new `session_id` with no prior history
- **Expected:** `format_session_for_prompt` returns empty string or no context; LLM has no prior turns ✅

---

## Appendix — Test Tooling Commands

### Login and Store Token (curl)
```bash
TOKEN=$(curl -s -X POST http://localhost:8001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"mohit.kapoor@degreefyd.com","password":"mohit.kapoor@degreefyd.com"}' \
  | python -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
```

### Run a Query
```bash
curl -X POST http://localhost:8001/query \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"session_id":"tc-01","user_query":"How many students are enrolled?","execute":true}'
```

### Hit Rate Limit (bash loop)
```bash
for i in $(seq 1 21); do
  curl -s -X POST http://localhost:8001/query \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"rate-test\",\"user_query\":\"count students $i\",\"execute\":false}" | python -c "import sys,json; d=json.load(sys.stdin); print(i, d.get('detail','ok'))"
done
```

### Dashboard Stats
```bash
curl -X GET http://localhost:8001/dashboard/stats \
  -H "Authorization: Bearer $TOKEN"
```

### Dashboard Logs with Filters
```bash
curl -X GET "http://localhost:8001/dashboard/logs?feedback_type=any&has_error=no&page=1" \
  -H "Authorization: Bearer $TOKEN"
```
