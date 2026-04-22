import json
import logging

from google.genai import types
from services.llm_service import client

log = logging.getLogger("text2sql")

_REWRITE_MODEL = "gemini-3.1-flash-lite-preview"


def _get_context_turns(session_turns: list, n: int = 5) -> list[dict]:
    """
    Extract last N turns as context objects.
    Prefers rewritten_query over user_query so dependent chains resolve correctly:
      Q1 user_query="admissions today"            rewritten_query=null   → uses "admissions today"
      Q2 user_query="by source"                   rewritten_query="admissions today by source" → uses rewritten
      Q3 context for Q3 sees "admissions today by source", not "by source"
    """
    context = []
    for turn in reversed(session_turns):
        query = (turn.get("rewritten_query") or turn.get("user_query", "")).strip()
        if not query or len(query) < 3:
            continue
        verdict = turn.get("query_verdict")
        context.insert(0, {"query": query, "verdict": verdict})
        if len(context) >= n:
            break
    return context


def classify_and_rewrite(user_query: str, session_turns: list) -> tuple[str, str, bool]:
    """
    Single LLM call: classify query as independent/dependent and rewrite if dependent.

    Returns: (query_type, final_query, is_rewritten)
      - query_type   : "independent" or "dependent"
      - final_query  : rewritten standalone query (if dependent) or original query
      - is_rewritten : True only when query was rewritten
    """
    context = _get_context_turns(session_turns, n=5)
    if not context:
        return "independent", user_query, False

    context_lines = []
    for i, c in enumerate(context, 1):
        verdict_tag = ""
        if c["verdict"] == "correct":
            verdict_tag = " [correct]"
        elif c["verdict"] in ("wrong", "incorrect"):
            verdict_tag = " [wrong]"
        context_lines.append(f'{i}. "{c["query"]}"{verdict_tag}')
    context_text = "\n".join(context_lines)

    prompt = f"""You are an intelligent query classifier for a Business Intelligence chat assistant.

Previous queries in this session (chronological, oldest first):
{context_text}

Current query: "{user_query}"

TASK:
1. Classify as INDEPENDENT or DEPENDENT.
   - INDEPENDENT: completely new topic, self-contained, does not need previous context to make sense
   - DEPENDENT: follow-up, continuation, correction, drill-down, or short addition to a previous query

2. If DEPENDENT — rewrite into a complete standalone query:
   - Build on the most recent [correct] query when possible
   - If a previous query was [wrong], still use its INTENT but be aware the result was wrong
   - Preserve ALL constraints (date filters, metrics, comparisons) from the referenced query
   - If current query has a new time period (yesterday, this week), it OVERRIDES the previous one
   - Short phrases like "by source", "and forms", "yesterday", "show only L3" → merge into previous query
   - Do NOT generate SQL — output clean natural language only

3. If INDEPENDENT — rewritten_query must equal the original query exactly.

Respond ONLY with valid JSON (no markdown, no explanation):
{{"type": "independent" | "dependent", "rewritten_query": "<final query text>"}}"""

    try:
        response = client.models.generate_content(
            model=_REWRITE_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(temperature=0.0),
        )
        raw = response.text.strip()
        if raw.startswith("```"):
            parts = raw.split("```")
            raw = parts[1] if len(parts) > 1 else raw
            if raw.lower().startswith("json"):
                raw = raw[4:]
        result = json.loads(raw.strip())

        query_type = result.get("type", "independent")
        rewritten = (result.get("rewritten_query") or user_query).strip()

        if query_type not in ("independent", "dependent"):
            query_type = "independent"

        if query_type == "independent" or not rewritten or rewritten.lower() == user_query.lower():
            return "independent", user_query, False

        log.info("query_rewriter: DEPENDENT — %r → %r", user_query[:60], rewritten[:60])
        return "dependent", rewritten, True

    except Exception as e:
        log.warning("query_rewriter.classify_and_rewrite failed (%s) — falling back to independent", e)
        return "independent", user_query, False
