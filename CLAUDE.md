# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**DataWhisper** is a conversational Text-to-SQL API that translates natural language queries into SQL using Google Gemini LLM. It features session-based conversation memory and a feedback system for query logging.

## Quick Start (Full Stack)

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

## Backend Setup & Running

```bash
# Install dependencies
pip install -r text_to_sql_api/requirements.txt

# Run the API server (development mode with auto-reload)
cd text_to_sql_api
uvicorn main:app --host 0.0.0.0 --port 8001 --reload

# API docs available at:
# - Swagger UI: http://localhost:8001/docs
# - ReDoc: http://localhost:8001/redoc
# - Health check: http://localhost:8001/health
```

## Frontend Setup & Running

```bash
# Install dependencies
cd frontend
npm install

# Development server (auto-reload HMR)
npm run dev  # Runs on http://localhost:5173 by default

# Production build
npm run build  # Creates dist/ folder

# Preview production build
npm run preview
```

The frontend is a React 19 + Vite application. ESLint is configured but the React Compiler is disabled due to performance impact.

## Environment Configuration

Configure the following in `.env` at the project root:

- `GEMINI_API_KEY` (required): Google Gemini API key
- `DATABASE_URL`: Primary PostgreSQL connection (DataHub). Already has a hardcoded fallback in `config/settings.py`
- `SUPABASE_URL`: Fallback PostgreSQL connection (optional but recommended)

The system automatically falls back to Supabase if the primary database is unreachable.

⚠️ **Security note**: `.env` contains API keys and database credentials—never commit it.

## Architecture

### Directory Structure

```
text_to_sql_api/
├── main.py                      # FastAPI app, CORS, startup hooks
├── config/
│   ├── settings.py             # Pydantic settings, model list, env vars
│   └── database.py             # SQLAlchemy engine, fallback logic, SQL execution
├── routers/
│   ├── ai_query.py            # Main /query endpoint, rate limiting
│   └── feedback.py            # Simplified feedback endpoints (logging only)
├── services/
│   ├── llm_service.py         # Gemini API calls with retry logic
│   ├── memory_service.py      # Session memory, feedback logging
│   └── knowledge_base.py      # SQL schema context
├── models/
│   └── schemas.py             # Pydantic request/response models
└── data/
    ├── logs/app.log           # Rotating log (5 MB × 5 backups)
    ├── sessions.json          # Active conversation sessions
    └── conversational_log.jsonl # All queries and responses

knowledge_base/
├── new_kb.txt                 # Current SQL schema and examples
├── versions/                  # Versioned knowledge bases
└── archive/                   # Historical versions
```

### Query Processing Flow (routers/ai_query.py)

The `/query` endpoint follows a simplified pipeline:

1. **Session History**: Load conversation history (last 5 turns)
2. **SQL Generation**: LLM generates SQL using session context and knowledge base
3. **Validation**: Ensure SQL is read-only (SELECT/WITH only)
4. **Execution**: Execute against database if `execute=true` (optional)
5. **Logging**: Save feedback record with all metadata

**Rate Limiting**: 20 queries per 120 seconds per session (in-memory).

**Session Context Alert**: Shows warning if session has 5+ turns (context window limit).

### LLM Integration (services/llm_service.py)

Uses **Gemini exclusively** via Google GenAI client:

- **Active model**: Configurable via settings, defaults to `gemini-3.1-flash-lite-preview`
- **Allowed models**: `gemini-3.1-pro-preview`, `gemini-3.1-flash-lite-preview`, `gemini-3-flash-preview`
- **Retry logic**: Automatic exponential backoff (3 attempts) for transient errors (503, UNAVAILABLE)
- **Optional reasoning**: Built-in support for `thinking_enabled` with configurable levels

Model can be switched at runtime via `/model-switch` endpoint.

### Session Memory (services/memory_service.py)

- **Per-session storage**: JSON file (`sessions.json`) stores conversation turns
- **Thread-safe**: Uses file locking to prevent concurrent write conflicts
- **Context window**: Last 5 turns (configurable via `SESSION_MAX_TURNS`)
- **Format**: Structured for LLM context with query-answer pairs

### Feedback System (routers/feedback.py)

Feedback endpoints exist for logging user corrections but **do not regenerate SQL or update memory**:

- `/feedback/logic`: Log user text feedback (deprecated feature)
- `/feedback/sql`: Accept user-corrected SQL (deprecated feature)

All queries are logged to `conversational_log.jsonl` for audit/analysis.

### Database & SQL Execution (config/database.py)

- **Engine management**: SQLAlchemy with connection pooling
- **Failover**: Tries primary (`DATABASE_URL`) first, falls back to Supabase if unavailable
- **Safety**: All queries have 30-second timeout; connection pooling prevents long-running locks
- **Results format**: List of dicts (column name → value)

## Key Configuration (config/settings.py)

| Setting | Default | Purpose |
|---------|---------|---------|
| `GEMINI_MODEL` | `gemini-3.1-flash-lite-preview` | Active LLM model |
| `ALLOWED_MODELS` | [Pro, Flash-lite, Flash preview] | Available models for switching |
| `SESSION_MAX_TURNS` | 5 | Conversation history window for LLM context |
| `DATABASE_URL` | DataHub PostgreSQL | Primary database connection |
| `SUPABASE_URL` | (empty) | Fallback database connection |
| `KNOWLEDGE_BASE_DIR` | `./knowledge_base` | SQL schema and examples location |
| `DATA_DIR` | `./text_to_sql_api/data` | Logs, sessions, feedback storage |

## API Endpoints

### Query & Execution

- `POST /query` — Generate SQL from natural language
  - Request: `user_query`, `session_id`, optional `execute` flag
  - Response: `sql`, `feedback_id`, `execution_time`, optional `data`

- `POST /execute` — Execute pre-generated SQL
  - Request: `sql`, `session_id`, optional `feedback_id`
  - Response: `data`, `answer`, `chart_type`, `execution_time`

### Model Management

- `POST /model-switch` — Switch active Gemini model
  - Request: `{"model": "gemini-3.1-pro-preview"}`
  - Response: `{"active_model": "..."}`

### Feedback (Logging Only)

- `POST /feedback/logic` — Log user text feedback
- `POST /feedback/sql` — Log corrected SQL

### Health & Info

- `GET /` — Service info and version
- `GET /health` — Health check with active model

## Common Development Tasks

### Testing a Query

```bash
curl -X POST http://localhost:8001/query \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "test-session",
    "user_query": "How many students are enrolled?",
    "model": "gemini-3.1-flash-lite-preview",
    "execute": true
  }'
```

### Switching LLM Models

```bash
curl -X POST http://localhost:8001/model-switch \
  -H "Content-Type: application/json" \
  -d '{"model": "gemini-3.1-pro-preview"}'
```

### Debugging SQL Generation

1. Enable DEBUG logging by checking `text_to_sql_api/data/logs/app.log`
2. Use `debug_prompt.py` utility to inspect exact prompts sent to LLM
3. Check `conversational_log.jsonl` for full query history

### Updating Knowledge Base

- Knowledge base files are loaded at query time from `knowledge_base/` directory
- Update `knowledge_base/new_kb.txt` with schema and examples
- System automatically includes schema context via `get_knowledge_base_prompt()`
- Restart API for changes to take effect

### Adding a New Gemini Model

1. Add model name to `ALLOWED_MODELS` in `config/settings.py`
2. Model becomes available via `/model-switch` endpoint
3. No additional API keys needed—all Gemini models use the same `GEMINI_API_KEY`

## Important Notes

- **Database Failover**: System tries primary database, falls back to Supabase automatically. Both should be valid PostgreSQL URLs.
- **Session IDs**: Client-provided or generated; used to group conversation turns
- **Rate Limiting**: Per-session, in-memory, resets on server restart
- **SQL Safety**: All queries execute with 30-second timeout; validation ensures read-only operations
- **Feedback**: Current implementation logs feedback to `conversational_log.jsonl` but does not use it for model improvement or memory updates
- **Context Window**: Session history limited to last 5 turns; longer conversations will drop earlier turns
