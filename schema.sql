-- DataWhisper PostgreSQL Schema
-- Run once on auth DB host. Plain PostgreSQL — no Supabase-specific features.

CREATE TYPE user_role AS ENUM ('super_admin', 'admin', 'analyser');
CREATE TYPE lms_type AS ENUM ('online', 'regular');

CREATE TABLE users (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  username          TEXT UNIQUE NOT NULL,
  hashed_password   TEXT NOT NULL,
  full_name         TEXT NOT NULL,
  role              user_role NOT NULL DEFAULT 'admin',
  lms_type          lms_type,               -- NULL for super_admin
  is_active         BOOLEAN DEFAULT true,
  created_by        TEXT,
  created_at_utc    TIMESTAMPTZ DEFAULT now(),
  created_at_ist    TIMESTAMPTZ DEFAULT (now() AT TIME ZONE 'Asia/Kolkata'),
  last_login_at_utc TIMESTAMPTZ,
  last_login_at_ist TIMESTAMPTZ
);

CREATE TABLE refresh_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT,
  token_hash      TEXT UNIQUE NOT NULL,     -- bcrypt hash of the refresh token
  expires_at_utc  TIMESTAMPTZ NOT NULL,
  expires_at_ist  TIMESTAMPTZ NOT NULL,
  created_at_utc  TIMESTAMPTZ DEFAULT now(),
  created_at_ist  TIMESTAMPTZ DEFAULT (now() AT TIME ZONE 'Asia/Kolkata'),
  revoked         BOOLEAN DEFAULT false
);

CREATE TABLE query_logs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               TEXT,
  session_id            TEXT NOT NULL,
  chat_id               TEXT,
  user_query            TEXT,
  generated_sql         TEXT,
  answer                TEXT,
  execution_time        FLOAT,
  error_message         TEXT,
  model                 TEXT,
  lms_type              TEXT,
  user_name             TEXT,
  user_email            TEXT,
  user_role             TEXT,
  token_usage           JSONB,
  chart_type            TEXT,
  mcq_data              JSONB,
  is_fix                BOOLEAN DEFAULT false,
  is_regenerate              BOOLEAN DEFAULT false,

  -- feedback/logic
  has_logic_feedback    BOOLEAN DEFAULT false,
  logic_feedback_text   TEXT,

  -- feedback/sql
  has_sql_feedback      BOOLEAN DEFAULT false,
  corrected_sql         TEXT,

  -- english-feedback
  has_english_feedback  BOOLEAN DEFAULT false,
  english_feedback_text TEXT,
  regenerated_sql       TEXT,

  -- any feedback flag for easy filtering
  has_any_feedback      BOOLEAN DEFAULT false,

  created_at_utc        TIMESTAMPTZ DEFAULT now(),
  created_at_ist        TIMESTAMPTZ DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')
);

CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT,
  title           TEXT,
  created_at_utc  TIMESTAMPTZ DEFAULT now(),
  created_at_ist  TIMESTAMPTZ DEFAULT (now() AT TIME ZONE 'Asia/Kolkata'),
  updated_at_utc  TIMESTAMPTZ DEFAULT now(),
  updated_at_ist  TIMESTAMPTZ DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')
);

CREATE TABLE session_turns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,    -- 'turn'
  content         TEXT NOT NULL,    -- JSON blob: {user_query, generated_sql, answer, feedback_id}
  created_at_utc  TIMESTAMPTZ DEFAULT now(),
  created_at_ist  TIMESTAMPTZ DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')
);

CREATE TABLE chats (
  id              TEXT PRIMARY KEY,           -- frontend chat id
  user_id         TEXT,                       -- Reference to users(id)
  title           TEXT,
  last_message    TEXT,
  is_pinned       BOOLEAN DEFAULT false,
  created_at_utc  TIMESTAMPTZ DEFAULT now(),
  created_at_ist  TIMESTAMPTZ DEFAULT (now() AT TIME ZONE 'Asia/Kolkata'),
  updated_at_utc  TIMESTAMPTZ DEFAULT now(),
  updated_at_ist  TIMESTAMPTZ DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')
);

CREATE TABLE chat_messages (
  id              TEXT PRIMARY KEY,           -- frontend message id
  chat_id         TEXT REFERENCES chats(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  text            TEXT,
  is_fix          BOOLEAN DEFAULT false,
  is_regenerate        BOOLEAN DEFAULT false,
  sql             TEXT,
  answer          TEXT,
  chart_type      TEXT,
  execution_time  FLOAT,
  model           TEXT,
  session_id      TEXT,
  user_query      TEXT,
  feedback_id     TEXT,
  token_usage     JSONB,
  error           TEXT,
  extra           JSONB,                      -- for any extra frontend fields (MCQ etc.)
  created_at_utc   TIMESTAMPTZ DEFAULT now(),
  created_at_ist   TIMESTAMPTZ DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')
);

CREATE TABLE token_usage_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id            UUID REFERENCES query_logs(id) ON DELETE SET NULL,
  user_id             TEXT,
  model               TEXT,
  input_tokens        INTEGER DEFAULT 0,
  output_tokens       INTEGER DEFAULT 0,
  input_token_cost    NUMERIC(15, 10) DEFAULT 0,
  output_token_cost   NUMERIC(15, 10) DEFAULT 0,
  created_at_utc      TIMESTAMPTZ DEFAULT now(),
  updated_at_utc      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE user_chats (
  user_id         TEXT PRIMARY KEY,
  chats_blob      JSONB,
  last_chat_id    TEXT,
  updated_at_utc  TIMESTAMPTZ DEFAULT now(),
  updated_at_ist  TIMESTAMPTZ DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')
);

-- Indexes for common queries
CREATE INDEX idx_query_logs_user_id ON query_logs(user_id);
CREATE INDEX idx_query_logs_created_at_utc ON query_logs(created_at_utc DESC);
CREATE INDEX idx_session_turns_session_id ON session_turns(session_id);
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_chats_user_id ON chats(user_id);
CREATE INDEX idx_chat_messages_chat_id ON chat_messages(chat_id);
CREATE INDEX idx_chat_messages_created_at_utc ON chat_messages(created_at_utc DESC);
CREATE INDEX idx_token_usage_logs_query_id ON token_usage_logs(query_id);
CREATE INDEX idx_token_usage_logs_user_id ON token_usage_logs(user_id);
