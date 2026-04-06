"""
Dashboard router — superadmin only. Stats cards + paginated query log.
"""

from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from typing import Optional

from auth.dependencies import require_super_admin
from config.database import get_auth_engine


def _parse_date(value: Optional[str], param_name: str) -> Optional[str]:
    """Validate ISO date/datetime string; raise 400 on bad format."""
    if not value:
        return None
    try:
        datetime.fromisoformat(value)
        return value
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid date format for '{param_name}'. Use ISO 8601 (e.g. 2024-04-01 or 2024-04-01T00:00:00).")

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/stats")
def get_stats(_: dict = Depends(require_super_admin)):
    """Summary cards — counts for last 24 hours and all time."""
    engine = get_auth_engine()
    with engine.connect() as conn:
        total_24h = conn.execute(text("""
            SELECT COUNT(*) FROM query_logs
            WHERE created_at_utc >= now() - interval '24 hours'
        """)).scalar()

        total_all = conn.execute(text("SELECT COUNT(*) FROM query_logs")).scalar()

        most_active_row = conn.execute(text("""
            SELECT u.username, COUNT(*) as cnt
            FROM query_logs ql
            JOIN users u ON u.id = ql.user_id
            WHERE ql.created_at_utc >= now() - interval '24 hours'
            GROUP BY u.username
            ORDER BY cnt DESC
            LIMIT 1
        """)).fetchone()

        errors_24h = conn.execute(text("""
            SELECT COUNT(*) FROM query_logs
            WHERE created_at_utc >= now() - interval '24 hours'
              AND error_message IS NOT NULL AND error_message != ''
        """)).scalar()

        feedback_24h = conn.execute(text("""
            SELECT COUNT(*) FROM query_logs
            WHERE created_at_utc >= now() - interval '24 hours'
              AND has_any_feedback = true
        """)).scalar()

    return {
        "total_queries_24h": total_24h,
        "total_queries_all_time": total_all,
        "most_active_user_24h": most_active_row.username if most_active_row else None,
        "errors_24h": errors_24h,
        "feedback_queries_24h": feedback_24h,
    }


@router.get("/logs")
def get_logs(
    _: dict = Depends(require_super_admin),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    username: Optional[str] = Query(None),
    feedback_type: Optional[str] = Query(None),   # 'logic'|'sql'|'english'|'any'|None
    has_error: Optional[str] = Query(None),        # 'yes'|'no'|None
    model: Optional[str] = Query(None),
    lms_type: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),        # ISO date string
    date_to: Optional[str] = Query(None),
):
    """Paginated + filtered query log for dashboard table."""
    date_from = _parse_date(date_from, "date_from")
    date_to = _parse_date(date_to, "date_to")

    engine = get_auth_engine()

    conditions = []
    params: dict = {"limit": page_size, "offset": (page - 1) * page_size}

    if username:
        conditions.append("u.username = :username")
        params["username"] = username

    if feedback_type == "logic":
        conditions.append("ql.has_logic_feedback = true")
    elif feedback_type == "sql":
        conditions.append("ql.has_sql_feedback = true")
    elif feedback_type == "english":
        conditions.append("ql.has_english_feedback = true")
    elif feedback_type == "any":
        conditions.append("ql.has_any_feedback = true")

    if has_error == "yes":
        conditions.append("ql.error_message IS NOT NULL AND ql.error_message != ''")
    elif has_error == "no":
        conditions.append("(ql.error_message IS NULL OR ql.error_message = '')")

    if model:
        conditions.append("ql.model = :model")
        params["model"] = model

    if lms_type:
        conditions.append("ql.lms_type = :lms_type")
        params["lms_type"] = lms_type

    if date_from:
        conditions.append("ql.created_at_utc >= CAST(:date_from AS timestamptz)")
        params["date_from"] = date_from

    if date_to:
        conditions.append("ql.created_at_utc <= CAST(:date_to AS timestamptz)")
        params["date_to"] = date_to

    where_clause = "WHERE " + " AND ".join(conditions) if conditions else ""

    query = f"""
        SELECT
            ql.id, ql.session_id, ql.chat_id,
            u.username,
            ql.user_query, ql.generated_sql, ql.answer,
            ql.execution_time, ql.error_message, ql.model, ql.lms_type,
            ql.chart_type, ql.token_usage, ql.mcq_data,
            ql.has_logic_feedback, ql.logic_feedback_text,
            ql.has_sql_feedback, ql.corrected_sql,
            ql.has_english_feedback, ql.english_feedback_text, ql.regenerated_sql,
            ql.has_any_feedback,
            ql.created_at_utc, ql.created_at_ist
        FROM query_logs ql
        LEFT JOIN users u ON u.id = ql.user_id
        {where_clause}
        ORDER BY ql.created_at_utc DESC
        LIMIT :limit OFFSET :offset
    """

    count_query = f"""
        SELECT COUNT(*) FROM query_logs ql
        LEFT JOIN users u ON u.id = ql.user_id
        {where_clause}
    """

    with engine.connect() as conn:
        rows = conn.execute(text(query), params).fetchall()
        count_params = {k: v for k, v in params.items() if k not in ("limit", "offset")}
        total = conn.execute(text(count_query), count_params).scalar()

    logs = []
    for row in rows:
        d = dict(row._mapping)
        # Serialize non-serializable types
        for k in ("created_at_utc", "created_at_ist"):
            if d.get(k):
                d[k] = d[k].isoformat()
        logs.append(d)

    return {
        "logs": logs,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, (total + page_size - 1) // page_size),
    }
