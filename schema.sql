public
chat_messages

01
PK
id
text
NOT NULL
02
chat_id
text
NULL
03
type
text
NOT NULL
04
text
text
NULL
05
is_fix
bool
NULL
false
06
is_regenerate
bool
NULL
false
07
sql
text
NULL
08
answer
text
NULL
09
chart_type
text
NULL
10
execution_time
float8
NULL
11
model
text
NULL
12
session_id
text
NULL
13
user_query
text
NULL
14
feedback_id
text
NULL
15
token_usage
jsonb
NULL
16
error
text
NULL



chats
01
PK
id
text
NOT NULL
02
user_id
text
NULL
03
title
text
NULL
04
last_message
text
NULL
05
is_pinned
bool
NULL
false
06
created_at_utc
timestamptz
NULL
now()
07
created_at_ist
timestamptz
NULL
(now() AT TIME ZONE 'Asia/Kolkata'::text)
08
updated_at_utc
timestamptz
NULL
now()
09
updated_at_ist
timestamptz
NULL
(now() AT TIME ZONE 'Asia/Kolkata'::text)
10
is_deleted
bool
NULL
false
11
lms_id
varchar
(50)
NULL



public
conversation_memory

01
PK
id
uuid
NOT NULL
gen_random_uuid()
02
chat_id
text
NULL
03
role
text
NOT NULL
04
content
text
NOT NULL
05
created_at_utc
timestamptz
NULL
now()
06
created_at_ist
timestamptz
NULL
(now() AT TIME ZONE 'Asia/Kolkata'::text)
07
feedback_id
text
NULL



public
query_logs

1
PK
id
uuid
NOT NULL
gen_random_uuid()
02
user_id
text
NULL
03
session_id
text
NOT NULL
04
chat_id
text
NULL
05
user_query
text
NULL
06
generated_sql
text
NULL
07
answer
text
NULL
08
execution_time
float8
NULL
09
error_message
text
NULL
10
model
text
NULL
11
lms_type
text
NULL
12
user_name
text
NULL
13
user_email
text
NULL
14
user_role
text
NULL
15
token_usage
jsonb
NULL
16
chart_type
text
NULL
17
mcq_data
jsonb
NULL
18
is_fix
bool
NULL
false
19
is_regenerate
bool
NULL
false
20
has_logic_feedback
bool
NULL
false
21
logic_feedback_text
text
NULL
22
has_sql_feedback
bool
NULL
false
23
corrected_sql
text
NULL
24
has_english_feedback
bool
NULL
false
25
english_feedback_text
text
NULL
26
regenerated_sql
text
NULL
27
has_any_feedback
bool
NULL
false
28
created_at_utc
timestamptz
NULL
now()
29
created_at_ist
timestamptz
NULL
(now() AT TIME ZONE 'Asia/Kolkata'::text)
30
sql_auto_fixed
bool
NULL
false
31
error
text
NULL
32
extra
jsonb
NULL
33
lms_id
varchar
(50)
NULL
34
query_verdict
text
NULL
35
failure_reason
text
NULL


public
refresh_tokens

1
PK
id
uuid
NOT NULL
gen_random_uuid()
02
user_id
text
NULL
03
token_hash
text
NOT NULL
04
expires_at_utc
timestamptz
NOT NULL
05
expires_at_ist
timestamptz
NOT NULL
06
created_at_utc
timestamptz
NULL
now()
07
created_at_ist
timestamptz
NULL
(now() AT TIME ZONE 'Asia/Kolkata'::text)
08
revoked
bool
NULL
false



public
sessions

01
PK
id
text
NOT NULL
02
user_id
text
NULL
03
title
text
NULL
04
created_at_utc
timestamptz
NULL
now()
05
created_at_ist
timestamptz
NULL
(now() AT TIME ZONE 'Asia/Kolkata'::text)
06
updated_at_utc
timestamptz
NULL
now()
07
updated_at_ist
timestamptz
NULL
(now() AT TIME ZONE 'Asia/Kolkata'::text)



public
token_usage_logs

1
PK
id
uuid
NOT NULL
gen_random_uuid()
02
query_id
uuid
NULL
03
user_id
text
NULL
04
model
text
NULL
05
input_tokens
int4
NULL
0
06
output_tokens
int4
NULL
0
07
input_token_cost
numeric
NULL
0
08
output_token_cost
numeric
NULL
0
09
created_at_utc
timestamptz
NULL
now()
10
updated_at_utc
timestamptz
NULL
now()

public
user_chats
5 Columns
Primary Key
Columns
Indexes
Foreign Keys
01
PK
user_id
text
NOT NULL
02
chats_blob
jsonb
NULL
03
last_chat_id
text
NULL
04
updated_at_utc
timestamptz
NULL
now()
05
updated_at_ist
timestamptz
NULL
(now() AT TIME ZONE 'Asia/Kolkata'::text)


public
users
12 Columns
Primary Key
Columns
Indexes
Foreign Keys
01
PK
id
text
NOT NULL
(gen_random_uuid())::text
02
username
text
NOT NULL
03
hashed_password
text
NOT NULL
04
full_name
text
NOT NULL
05
role
user_role
NOT NULL
'admin'::user_role
06
lms_type
lms_type
NULL
07
is_active
bool
NULL
true
08
created_by
text
NULL
09
created_at_utc
timestamptz
NULL
now()
10
created_at_ist
timestamptz
NULL
(now() AT TIME ZONE 'Asia/Kolkata'::text)
11
last_login_at_utc
timestamptz
NULL
12
last_login_at_ist
timestamptz
NULL


-- ─────────────────────────── MIGRATIONS ──────────────────────────────────────
-- query rewriter: classify independent/dependent queries and store rewrite info

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS query_type TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS rewritten_query TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_rewritten BOOLEAN DEFAULT false;

ALTER TABLE query_logs ADD COLUMN IF NOT EXISTS query_type TEXT;
ALTER TABLE query_logs ADD COLUMN IF NOT EXISTS rewritten_query TEXT;
ALTER TABLE query_logs ADD COLUMN IF NOT EXISTS is_rewritten BOOLEAN DEFAULT false;