"""
MCQ-based query disambiguation service.
Generates clarifying questions and builds enhanced context for SQL generation.
"""

import json
import logging
import re
from typing import Optional

from services.llm_service import _call_llm
from services.knowledge_base import get_knowledge_base_prompt

log = logging.getLogger("text2sql")

LABELS = ["A", "B", "C", "D"]


def generate_mcqs(
    user_query: str,
    session_history: str = "",
    model: str = None,
    lms_type: str = "online",
) -> tuple[list[dict], Optional[str]]:
    """
    Generate exactly 3 MCQ questions to disambiguate the user query.
    Returns (questions_list, error_string_or_None).
    Each question: {question_id, question_text, options: [{label, text}, ...]}
    """
    knowledge_base = get_knowledge_base_prompt(lms_type=lms_type)

    prompt = f"""{knowledge_base}
{session_history}

### TASK:
Analyze the user's natural-language database query and generate exactly 3 multiple-choice questions that will clarify any ambiguity so we can write the most accurate SQL.

### USER QUERY: "{user_query}"

### WHAT TO CLARIFY (pick the top 3 relevant ambiguities):
- Time period (if no date/range mentioned): Today / This week / This month / This year / All time
- Metric type (if "performance", "stats", "numbers"): Count / Sum / Average / Conversion rate
- Funnel stage (if "students" without stage qualifier): All stages / Fresh / Application+ / Enrolled
- Counsellor scope (if "counsellor" without qualifier): All / Active only / L2 only / L3 only
- Grouping (if aggregation query with no GROUP BY hint): Per counsellor / Per source / Per day / Total only
- Filter scope: Any specific status, source, university, or other filter the user might want
- Sort / Limit: Whether the user wants top N, ascending/descending, etc.

### RULES:
1. Generate EXACTLY 3 questions. No more, no less.
2. Each question MUST have exactly 4 options labeled A, B, C, D.
3. Questions must be directly relevant to the user's query — do NOT ask generic questions.
4. If the query is already specific on a dimension (e.g., "this month"), skip that and ask about something else.
5. Use the table schemas above to make options realistic and accurate.
6. Keep question text short (one line) and option text concise (2-5 words).

### OUTPUT FORMAT (strict JSON, nothing else):
{{
  "questions": [
    {{
      "question_id": "q1",
      "question_text": "What time period are you interested in?",
      "options": [
        {{"label": "A", "text": "Today"}},
        {{"label": "B", "text": "This week"}},
        {{"label": "C", "text": "This month"}},
        {{"label": "D", "text": "All time"}}
      ]
    }},
    {{
      "question_id": "q2",
      "question_text": "...",
      "options": [{{"label": "A", "text": "..."}}, {{"label": "B", "text": "..."}}, {{"label": "C", "text": "..."}}, {{"label": "D", "text": "..."}}]
    }},
    {{
      "question_id": "q3",
      "question_text": "...",
      "options": [{{"label": "A", "text": "..."}}, {{"label": "B", "text": "..."}}, {{"label": "C", "text": "..."}}, {{"label": "D", "text": "..."}}]
    }}
  ]
}}

### OUTPUT ONLY THE JSON:"""

    try:
        raw_response, _, _ = _call_llm(prompt, model_name=model, temperature=0.1)

        json_match = re.search(r"\{.*\}", raw_response, re.DOTALL)
        if not json_match:
            log.error("MCQ generation: no JSON found in LLM response")
            return [], "Failed to parse MCQ response from LLM"

        data = json.loads(json_match.group())
        raw_questions = data.get("questions", [])

        if not raw_questions:
            return [], "LLM returned empty questions list"

        # Normalize and validate
        questions = []
        for i, rq in enumerate(raw_questions[:3]):
            opts = rq.get("options", [])
            # Ensure exactly 4 options with proper labels
            normalized_opts = []
            for j, opt in enumerate(opts[:4]):
                if isinstance(opt, dict):
                    normalized_opts.append({
                        "label": LABELS[j],
                        "text": opt.get("text", opt.get("label", f"Option {LABELS[j]}")),
                    })
                elif isinstance(opt, str):
                    normalized_opts.append({"label": LABELS[j], "text": opt})

            # Pad if fewer than 4
            while len(normalized_opts) < 4:
                normalized_opts.append({"label": LABELS[len(normalized_opts)], "text": "N/A"})

            questions.append({
                "question_id": f"q{i + 1}",
                "question_text": rq.get("question_text", f"Question {i + 1}"),
                "options": normalized_opts,
            })

        log.info("MCQ generated %d questions for query=%r", len(questions), user_query[:80])
        return questions, None

    except json.JSONDecodeError as e:
        log.error("MCQ JSON parse error: %s", str(e))
        return [], f"Failed to parse MCQ JSON: {str(e)}"
    except Exception as e:
        log.error("MCQ generation failed: %s", str(e))
        return [], str(e)


def build_enhanced_context(
    original_query: str,
    questions: list[dict],
    answers: list,
) -> str:
    """
    Convert MCQ answers into a structured context block for SQL generation prompt.
    answers = list of 0-based option indices or free-text strings (for "Other").
    """
    lines = ["### QUERY CLARIFICATION (from user MCQ answers):"]

    for q, ans in zip(questions, answers):
        if isinstance(ans, str):
            # Free-text "Other" answer
            text = ans if ans.strip() else "(skipped)"
        else:
            opts = q.get("options", [])
            if isinstance(ans, int) and 0 <= ans < len(opts):
                selected = opts[ans]
                text = selected.get("text", selected) if isinstance(selected, dict) else str(selected)
            else:
                text = "(skipped)"
        lines.append(f"- {q['question_text']} → {text}")

    lines.append("")
    lines.append("### REFINED INTENT:")
    lines.append(f'Original query: "{original_query}"')
    lines.append("With the above clarifications, generate the most accurate SQL possible.")

    return "\n".join(lines)


def build_feedback_context(
    original_query: str,
    questions: list[dict] | None,
    answers: list | None,
    feedback: str,
) -> str:
    """
    Combine MCQ context (if any) + English feedback into a single context block.
    """
    parts = []

    # Include MCQ context if present
    if questions and answers:
        parts.append(build_enhanced_context(original_query, questions, answers))
        parts.append("")

    parts.append("### USER ENGLISH FEEDBACK:")
    parts.append(f'"{feedback}"')
    parts.append("")
    parts.append("Use the feedback above as the HIGHEST PRIORITY instruction to refine the SQL.")

    return "\n".join(parts)
