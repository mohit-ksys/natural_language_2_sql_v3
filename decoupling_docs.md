CREATE TABLE chats (
  id              TEXT PRIMARY KEY,           -- frontend chat id
  user_id         TEXT,
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

CREATE INDEX idx_chats_user_id ON chats(user_id);
CREATE INDEX idx_chat_messages_chat_id ON chat_messages(chat_id);


chat_persistence.py — router rewrite
GET /chats/load — instead of fetching one JSONB row, join chats + chat_messages:

python
SELECT c.*, cm.* FROM chats c
LEFT JOIN chat_messages cm ON cm.chat_id = c.id
WHERE c.user_id = :uid
ORDER BY c.updated_at_utc DESC, cm.created_at_utc ASC
Then reconstruct the same {chats: [...], lastChatId: ...} shape in Python so the frontend API contract stays identical.

POST /chats/save — instead of one upsert, do:

Upsert each Chat → chats table
For each chat, delete-and-reinsert its messages into chat_messages (or upsert by message id)
