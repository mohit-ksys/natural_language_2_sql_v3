"""
query_rewriter.py
-----------------
Standalone follow-up query rewriter.
No changes to llm_service.py or any router required.

Usage in notebook:
    from query_rewriter import maybe_rewrite
    final_query, was_rewritten = maybe_rewrite(user_query, session_turns)
    # pass final_query to generate_sql instead of original user_query
"""

import sys
import os

sys.path.insert(0, os.path.abspath(".."))

from google import genai
from google.genai import types
from config.settings import settings

_client = genai.Client(api_key=settings.GEMINI_API_KEY)
_REWRITE_MODEL = "gemini-3.1-flash-lite-preview"

# ── Heuristic trigger keywords ────────────────────────────────────────────────
# If any of these appear in the user query, it's likely a follow-up.
FOLLOWUP_TRIGGERS = [
    "this data", "above data", "same data", "that data",
    "this", "above", "same", "those", "that",
    "break this", "break it", "break down",
    "by source", "by campaign", "by counsellor", "by channel",
    "source level", "campaign level", "counsellor level",
    "source and campaign", "source wise", "campaign wise",
    "instead", "now show", "now break", "also show",
    "what about", "how about",
]


def is_followup_query(user_query: str) -> bool:
    """
    Cheap heuristic check — returns True if user_query likely refers
    to a previous query. Avoids calling LLM for standalone queries.
    """
    q = user_query.lower().strip()
    return any(trigger in q for trigger in FOLLOWUP_TRIGGERS)


def get_last_user_query(session_turns: list) -> str:
    """
    Extract the most recent meaningful user query from session turns.
    Skips empty/greeting queries.
    """
    skip_patterns = ["hello", "hi", "hey", "thanks", "thank you", "ok", "okay"]
    for turn in reversed(session_turns):
        q = turn.get("user_query", "").strip()
        if q and q.lower() not in skip_patterns and len(q) > 5:
            return q
    return ""


def rewrite_to_standalone(prev_query: str, current_query: str) -> str:
    """
    Calls LLM to convert a follow-up query into a complete standalone query.
    Returns the rewritten query string.
    """
    prompt = f"""Convert the follow-up query into a complete standalone query.

Previous query:
{prev_query}

Follow-up query:
{current_query}

Rules:
- Replace vague references like "above data", "this data", "same", "those" with the actual subject from the previous query
- Preserve ALL constraints from the previous query: time range, date filters, comparisons, metrics
- If the follow-up query introduces a NEW time period (e.g. "last week", "this month", "for april"), use the NEW time period — it overrides the previous one
- "by", "level", "breakdown", "wise" means grouped by that dimension — add it explicitly
- "instead" means replace the previous grouping/filter with the new one
- Do NOT lose any important details (time period, comparison, metric)
- Do NOT generate SQL
- Output ONLY the final standalone query, nothing else

Standalone query:"""

    try:
        response = _client.models.generate_content(
            model=_REWRITE_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(temperature=0.0),
        )
        return response.text.strip()
    except Exception as e:
        print(f"[query_rewriter] rewrite failed: {e}")
        return current_query  # fall back to original if rewrite fails


def maybe_rewrite(user_query: str, session_turns: list) -> tuple[str, bool]:
    """
    Main entry point.

    Returns (final_query, was_rewritten).
    - If query looks like a follow-up and there is a previous query,
      rewrites to standalone.
    - Otherwise returns original query unchanged.

    Usage:
        final_query, was_rewritten = maybe_rewrite(user_query, session_turns)
        sql, thoughts, usage = generate_sql(user_query=final_query, ...)
    """
    if not is_followup_query(user_query):
        return user_query, False

    prev_query = get_last_user_query(session_turns)
    if not prev_query:
        return user_query, False

    rewritten = rewrite_to_standalone(prev_query, user_query)
    return rewritten, True
