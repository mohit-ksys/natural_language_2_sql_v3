import time
import logging

from google import genai
from google.genai import types

from config.settings import settings
from services.knowledge_base import get_knowledge_base_prompt

log = logging.getLogger("text2sql")

client = genai.Client(api_key=settings.GEMINI_API_KEY)

_active_model: str = settings.GEMINI_MODEL

ALLOWED_MODELS = settings.ALLOWED_MODELS



def _call_llm(
    prompt: str,
    model_name: str = None,
    temperature: float = 0.0,
    thinking_enabled: bool = False,
    thinking_level: str = "low",
    include_thoughts: bool = False,
) -> tuple[str, str, dict]:
    """Call Gemini LLM and return (text, thoughts, token_usage)."""
    return _call_gemini(
        prompt,
        model_name=model_name,
        temperature=temperature,
        thinking_enabled=thinking_enabled,
        thinking_level=thinking_level,
        include_thoughts=include_thoughts,
    )

# gemini-3.1-pro-preview
# gemini-3.1-flash-lite-preview
# gemini-3-flash-preview


TAG_VOCABULARY = [
    "admissions", "leads", "counsellor", "source", "date", "connected",
    "hot", "enrolled", "count", "group_by", "filter", "team", "l2", "l3",
    "remarks", "callback", "course", "university",
]


def get_active_model() -> str:
    return _active_model


def set_active_model(model: str) -> str:
    global _active_model
    if model not in ALLOWED_MODELS:
        raise ValueError(f"Model '{model}' not allowed. Choose from: {ALLOWED_MODELS}")
    _active_model = model
    return _active_model


def _call_gemini(
    prompt: str,
    model_name: str = None,
    temperature: float = 0.0,
    thinking_enabled: bool = False,
    thinking_level: str = "low",
    include_thoughts: bool = False,
) -> tuple[str, str, dict]:
    """Returns (text, thoughts, token_usage). thoughts is empty string unless include_thoughts=True."""
    model_name = model_name or _active_model

    cfg_kwargs: dict = {"temperature": temperature}
    if thinking_enabled:
        cfg_kwargs["thinking_config"] = types.ThinkingConfig(
            thinking_level=thinking_level,
            include_thoughts=include_thoughts,
        )

    _retries = 3
    _delay = 5
    for _attempt in range(_retries):
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(**cfg_kwargs),
            )
            break
        except Exception as _e:
            _msg = str(_e)
            _is_transient = ("503" in _msg or "UNAVAILABLE" in _msg) and "RESOURCE_EXHAUSTED" not in _msg
            if _attempt < _retries - 1 and _is_transient:
                log.warning("Gemini %s on attempt %d/%d — retrying in %ds", _msg[:60], _attempt + 1, _retries, _delay)
                time.sleep(_delay)
                _delay *= 2
            else:
                raise

    usage = {}
    if hasattr(response, 'usage_metadata') and response.usage_metadata:
        um = response.usage_metadata
        usage = {
            'input_tokens': getattr(um, 'prompt_token_count', 0) or 0,
            'output_tokens': getattr(um, 'candidates_token_count', 0) or 0,
        }

    if include_thoughts and response.candidates:
        text_parts, thought_parts = [], []
        for part in response.candidates[0].content.parts:
            if not part.text:
                continue
            if getattr(part, "thought", False):
                thought_parts.append(part.text)
            else:
                text_parts.append(part.text)
        return "".join(text_parts).strip(), "".join(thought_parts).strip(), usage

    return response.text.strip(), "", usage



def _validate_sql(sql: str) -> bool:
    sanitized = sql.lower().strip()
    forbidden = ["drop ", "delete ", "update ", "insert ", "truncate ", "alter ", "create ", "grant ", "revoke "]
    is_select = sanitized.startswith("select") or sanitized.startswith("with")
    has_forbidden = any(k in sanitized for k in forbidden)
    return is_select and not has_forbidden


def _clean_sql(raw: str) -> str:
    cleaned = raw.replace("```sql", "").replace("```", "").strip()
    import re
    match = re.search(r"(SELECT|WITH)[\s\S]*?;", cleaned, re.IGNORECASE)
    if match:
        return match.group(0).strip()
    match2 = re.search(r"(SELECT|WITH)[\s\S]*", cleaned, re.IGNORECASE)
    if match2:
        return match2.group(0).strip()
    return cleaned


def generate_sql(
    user_query: str,
    session_history: str = "",
    learned_rules: str = "",
    model: str = None,
    thinking_enabled: bool = False,
    thinking_level: str = "high",
    include_thoughts: bool = False,
) -> tuple[str, str]:
    """Returns (sql, thoughts). thoughts is empty unless include_thoughts=True."""
    knowledge_base = get_knowledge_base_prompt()

    from datetime import datetime
    now = datetime.now()
    date_str = now.strftime("%A, %d %B %Y")
    time_str = now.strftime("%I:%M %p")

    prompt = f"""{knowledge_base}
{learned_rules}
{session_history}

### CURRENT SYSTEM CONTEXT:
- Today's Date (IST): {date_str}
- System Time (IST): {time_str}

### STRICT INSTRUCTIONS:
1. MANDATORY: Use CONVERSATION HISTORY above for context. If the user asks a follow-up question (e.g., "yesterday" after discussing "remarks within 15 mins"), combine both constraints in the SQL.
2. MANDATORY: JOIN with 'counsellors' table using 'counsellor_name' whenever a staff/counsellor name is mentioned. Never guess IDs.
3. MANDATORY: For Admissions count, always use COUNT(DISTINCT student_id) to avoid duplicates.
4. MANDATORY: Apply date, time, month, day and year filters ONLY if specified in the user query explicitly. Otherwise do not filter by date.
5. MANDATORY: Do NOT add LIMIT unless the user explicitly says "top N", "limit to", or gives a specific number. Summary and aggregation queries must have NO LIMIT.
6. TIMEZONE for 'created_at' (stored UTC, CURRENT_DATE is IST) — two cases only:
    - Rolling windows (last N days/hours/months): use plain `NOW() - INTERVAL 'X days'` — NO timezone offset needed.
    - IST day-boundary (Today/Yesterday): subtract offset — `created_at >= CURRENT_DATE - interval '5 hours 30 minutes' AND created_at < CURRENT_DATE + interval '1 day' - interval '5 hours 30 minutes'`
    - callback_date is type DATE — never apply timezone offset to it.
7. For year-based queries, always use EXTRACT(YEAR FROM CURRENT_DATE) or DATE_TRUNC('year', CURRENT_DATE). NEVER hardcode a numeric year literal.
8. NEVER use ILIKE on IDs. Always join by name.
9. Output ONLY raw SQL. No markdown, no comments, no explanation.


User Question: "{user_query}"
SQL:"""

    raw, thoughts, usage = _call_llm(
        prompt,
        model_name=model,
        temperature=0.0,
        thinking_enabled=thinking_enabled,
        thinking_level=thinking_level,
        include_thoughts=include_thoughts,
    )
    return _clean_sql(raw), thoughts, usage


def generate_answer(user_query: str, data: list[dict], model: str = None) -> tuple[str, str]:
    import json
    data_str = json.dumps(data[:100], indent=2, default=str)

    prompt = f"""You are a professional Business Intelligence Analyst for a Lead Management System.

User Question: "{user_query}"
Database Result:
{data_str}

Instructions:
1. Provide a concise, professional answer based ONLY on the data above.
2. If it is a list, format it clearly with numbers or bullets.
3. MANDATORY: Suggest the best chart type for this data.
4. Format your response EXACTLY as:
   Answer: [Your Answer]
   Chart: [Suggested Chart Type — one of: Bar Chart, Pie Chart, Line Chart, Stat Card, Table]"""

    raw, _, usage = _call_llm(prompt, model_name=model, temperature=0.7)

    import re
    answer_match = re.search(r"Answer:\s*([\s\S]*?)(?=Chart:|$)", raw, re.IGNORECASE)
    chart_match = re.search(r"Chart:\s*(.*)", raw, re.IGNORECASE)

    answer = answer_match.group(1).strip() if answer_match else raw.strip()
    chart_type = chart_match.group(1).strip() if chart_match else "Stat Card"
    return answer, chart_type, usage


def auto_fix_sql(user_query: str, failed_sql: str, error_message: str, model: str = None) -> str | None:
    knowledge_base = get_knowledge_base_prompt()
    prompt = f"""{knowledge_base}

### SQL ERROR TO FIX:
- User Question: "{user_query}"
- Failed SQL: {failed_sql}
- PostgreSQL Error: {error_message}

### INSTRUCTIONS:
Fix the SQL above so it runs correctly on PostgreSQL.
- JOIN with 'counsellors' table for staff names.
- Use CURRENT_DATE for today's date.
- Output ONLY the corrected raw SQL. No explanation.
SQL:"""

    try:
        raw, _, _usage = _call_llm(prompt, model_name=model, temperature=0.0)
        fixed = _clean_sql(raw)
        return fixed if _validate_sql(fixed) else None
    except Exception:
        return None


def extract_tags(user_query: str, model: str = None) -> list[str]:
    vocab_str = ", ".join(TAG_VOCABULARY)
    prompt = f"""You are a tagging assistant. Given a database query question, extract the relevant intent tags.

Available tags (choose ONLY from this list):
{vocab_str}

User Question: "{user_query}"

Return ONLY a comma-separated list of matching tags from the list above. No explanation.
Tags:"""

    try:
        raw, _, _usage = _call_llm(prompt, model_name=model, temperature=0.0)
        tags = [t.strip().lower() for t in raw.replace("Tags:", "").split(",")]
        valid_tags = [t for t in tags if t in TAG_VOCABULARY]
        return valid_tags
    except Exception:
        return []


def regenerate_sql_with_feedback(
    user_query: str,
    failed_sql: str,
    text_feedback: str,
    session_history: str = "",
    learned_rules: str = "",
    model: str = None,
) -> str:
    knowledge_base = get_knowledge_base_prompt()

    from datetime import datetime
    now = datetime.now()

    prompt = f"""{knowledge_base}
{learned_rules}
{session_history}

### CORRECTION CONTEXT:
- Original User Question: "{user_query}"
- Previously Generated SQL (INCORRECT): 
  {failed_sql}
- User's Correction / Instruction:
  {text_feedback}

### CURRENT SYSTEM CONTEXT:
- Today's Date (IST): {now.strftime("%A, %d %B %Y")}

### INSTRUCTIONS:
1. Read the user's correction carefully and fix the SQL accordingly.
2. The correction is the highest priority — follow it exactly.
3. JOIN with 'counsellors' table for names.
4. Use COUNT(DISTINCT student_id) for admissions.
5. Output ONLY corrected raw SQL. No markdown, no explanation.

SQL:"""

    raw, _, _usage = _call_llm(prompt, model_name=model, temperature=0.0)
    return _clean_sql(raw)


def validate_sql(sql: str) -> bool:
    return _validate_sql(sql)


def judge_sql(
    user_query: str,
    ground_truth_sql: str,
    predicted_sql: str,
    model: str = None,
) -> dict:
    """
    LLM-as-judge: compare predicted SQL vs ground truth on 4 criteria.
    Returns a dict with keys: tables, columns, filter, group_by, overall, notes.
    Each criterion is scored PASS / PARTIAL / FAIL with a brief reason.
    """
    judge_model = model or "gemini-3.1-flash-lite-preview"

    prompt = f"""You are an expert SQL evaluator. Compare the PREDICTED SQL against the GROUND TRUTH SQL for the given natural language question.

### Natural Language Question:
{user_query}

### Ground Truth SQL:
```sql
{ground_truth_sql}
```

### Predicted SQL:
```sql
{predicted_sql}
```
Dont take ground truth on face value check that What Natural Language Question is asked and what is the predicted SQL doing then mark it correct or incorrect.
Be lenient and dont be strict if what user wants is in the predicted sql then mark it correct.
If something is realted to time if the predict have rest query same but difference how that time is handled make that PASS.
Evaluate the predicted SQL on these 4 criteria. For each, give a verdict (PASS / PARTIAL / FAIL) and a short one-line reason.
If the ground truth query have %some_text%, then the predicted query should also have %some% in the same place means that they cant be same but searchs for the same thing.
| Check | What to verify |
|---|---|
| **Tables** | Are the correct tables being joined/queried? |
| **Columns** | Are the right columns used in SELECT, JOIN, WHERE? |
| **Filter** | Are WHERE / HAVING conditions matching the ground truth intent? |
| **Group By** | Is aggregation at the correct level? |

If the ground truth is created_at or predict sql is updated_at or vice versa, then consider them as same.

Respond ONLY as valid JSON in this exact format:
{{
  "tables":   {{"verdict": "PASS|PARTIAL|FAIL", "reason": "..."}},
  "columns":  {{"verdict": "PASS|PARTIAL|FAIL", "reason": "..."}},
  "filter":   {{"verdict": "PASS|PARTIAL|FAIL", "reason": "..."}},
  "group_by": {{"verdict": "PASS|PARTIAL|FAIL", "reason": "..."}},
  "overall":  "PASS|PARTIAL|FAIL",
  "summary":  "One sentence overall assessment."
}}"""

    try:
        raw, _, _usage = _call_llm(prompt, judge_model, temperature=0.0)
        import json, re
        json_match = re.search(r'\{.*\}', raw, re.DOTALL)
        if json_match:
            return json.loads(json_match.group())
    except Exception as e:
        log.warning(f"LLM judge failed: {e}")

    return {
        "tables":   {"verdict": "ERROR", "reason": "Judge call failed"},
        "columns":  {"verdict": "ERROR", "reason": ""},
        "filter":   {"verdict": "ERROR", "reason": ""},
        "group_by": {"verdict": "ERROR", "reason": ""},
        "overall":  "ERROR",
        "summary":  str(e) if 'e' in dir() else "Unknown error",
    }
