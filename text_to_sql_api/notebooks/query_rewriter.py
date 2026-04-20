"""
query_rewriter.py
-----------------
Intelligent LLM-based query rewriter for follow-up queries and corrections.

Features:
- No heuristic trigger keywords - uses LLM intelligence to detect continuations
- Handles last 5 queries from session history for context
- Corrects previous wrong queries when detected
- Handles continuation patterns like "and forms", "and icc done", "and ni"
- Session-specific for each chat window

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


def get_last_n_queries(session_turns: list, n: int = 5) -> list:
    """
    Extract the last N meaningful user queries from session turns.
    Returns list in chronological order (oldest to newest).
    """
    queries = []
    for turn in reversed(session_turns):
        q = turn.get("user_query", "").strip()
        if q and len(q) > 10:
            queries.insert(0, q)  # Insert at beginning to maintain chronological order
            if len(queries) >= n:
                break
    return queries


def rewrite_to_standalone(previous_queries: list, current_query: str) -> str:
    """
    Calls LLM to intelligently determine if the current query needs rewriting
    based on conversation history. Handles continuations, corrections, and standalone queries.

    Args:
        previous_queries: List of last N queries in chronological order (oldest to newest)
        current_query: The current user query

    Returns:
        Rewritten query if it's a continuation/correction, otherwise original query
    """
    if not previous_queries:
        return current_query

    # Format previous queries for the prompt
    prev_queries_text = "\n".join([f"{i+1}. {q}" for i, q in enumerate(previous_queries)])
    last_query = previous_queries[-1]

    prompt = f"""You are an intelligent query rewriter. Analyze the current query in the context of previous queries.

Previous queries (in chronological order):
{prev_queries_text}

Current query:
{current_query}

Your task:
1. Determine if the current query is a CONTINUATION, CORRECTION, or ADDITION to any previous query
2. If YES: Rewrite it into a complete standalone query by merging with the most relevant previous query
3. If NO: Return the current query as-is (it's already standalone)

Continuation patterns to recognize:
- Short additions like "and forms", "and icc done", "and ni" → append to previous query
- Time modifiers like "today", "yesterday", "this week" → apply to previous context
- Grouping requests like "by source", "by campaign" → add to previous query
- References like "this data", "above data", "same" → use previous query's subject

Correction patterns to recognize:
- If the previous query was incomplete or wrong, the current query fixes it
- Example: previous "admission today" → current "admission and forms today" → merge both

Rules for rewriting:
- Preserve ALL constraints from previous query: time range, date filters, comparisons, metrics
- If current query introduces NEW time period (e.g., "last week", "this month"), it overrides previous
- "and forms", "and icc done", "and ni" means adding those metrics to the previous query
- Merge intelligently - don't just concatenate
- Do NOT generate SQL
- Output ONLY the final query (rewritten if continuation, original if standalone)

Final query:"""

    try:
        response = _client.models.generate_content(
            model=_REWRITE_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(temperature=0.0),
        )
        rewritten = response.text.strip()
        # If the LLM returned the same query or very similar, it's not a continuation
        if rewritten.lower() == current_query.lower() or len(rewritten) < len(current_query) * 0.8:
            return current_query
        return rewritten
    except Exception as e:
        print(f"[query_rewriter] rewrite failed: {e}")
        return current_query  # fall back to original if rewrite fails


def maybe_rewrite(user_query: str, session_turns: list) -> tuple[str, bool]:
    """
    Main entry point. Uses LLM intelligence to determine if rewriting is needed.

    Returns (final_query, was_rewritten).
    - Always attempts intelligent rewriting if there is conversation history
    - LLM decides if it's a continuation/correction or standalone
    - Returns original query if no history or if LLM determines it's standalone

    Usage:
        final_query, was_rewritten = maybe_rewrite(user_query, session_turns)
        sql, thoughts, usage = generate_sql(user_query=final_query, ...)
    """
    previous_queries = get_last_n_queries(session_turns, n=5)
    if not previous_queries:
        return user_query, False

    rewritten = rewrite_to_standalone(previous_queries, user_query)
    was_rewritten = rewritten.lower() != user_query.lower()
    return rewritten, was_rewritten
