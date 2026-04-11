"""
Dashboard router — superadmin only. Stats cards + paginated query log.
"""

from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from typing import Optional

from auth.dependencies import require_admin_or_supervisor
from config.database import get_auth_engine


def _parse_date(value: Optional[str], param_name: str) -> Optional[str]:
    if not value:
        return None
    try:
        datetime.fromisoformat(value)
        return value
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid date format for '{param_name}'. Use ISO 8601."
        )


router = APIRouter(prefix="/dashboard", tags=["Dashboard"])



@router.get("/stats")
def get_stats(
    _: dict = Depends(require_admin_or_supervisor),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    lms_id: Optional[str] = Query(None),
):
    date_from = _parse_date(date_from, "date_from")
    date_to = _parse_date(date_to, "date_to")

    engine = get_auth_engine()

    conditions = []
    params = {}

    if date_from:
        conditions.append("ql.created_at_utc >= CAST(:date_from AS timestamptz)")
        params["date_from"] = date_from

    if date_to:
        conditions.append("ql.created_at_utc <= CAST(:date_to AS timestamptz)")
        params["date_to"] = date_to

    if lms_id:
        conditions.append("ql.lms_id = :lms_id")
        params["lms_id"] = lms_id

    if conditions:
        where_clause = "WHERE " + " AND ".join(conditions)
    else:
        where_clause = "WHERE ql.created_at_utc >= now() - interval '24 hours'"

    with engine.connect() as conn:

        total_24h = conn.execute(text(f"""
            SELECT COUNT(*) FROM query_logs ql
            {where_clause}
        """), params).scalar()

        total_all = conn.execute(text(f"""
            SELECT COUNT(*) FROM query_logs ql
            {f"WHERE ql.lms_id = :lms_id" if lms_id else ""}
        """), params if lms_id else {}).scalar()

        token_stats_24h = conn.execute(text(f"""
            SELECT 
                SUM(tu.input_tokens) as in_t,
                SUM(tu.output_tokens) as out_t,
                SUM(tu.input_token_cost) as in_c,
                SUM(tu.output_token_cost) as out_c
            FROM token_usage_logs tu
            JOIN query_logs ql ON ql.id = tu.query_id
            {where_clause}
        """), params).fetchone()

        token_stats_all = conn.execute(text(f"""
            SELECT 
                SUM(input_tokens) as in_t,
                SUM(output_tokens) as out_t,
                SUM(input_token_cost) as in_c,
                SUM(output_token_cost) as out_c
            FROM token_usage_logs tu
            JOIN query_logs ql ON ql.id = tu.query_id
            {f"WHERE ql.lms_id = :lms_id" if lms_id else ""}
        """), params if lms_id else {}).fetchone()

        most_active_row = conn.execute(text(f"""
            SELECT ql.user_name as username, COUNT(*) as cnt
            FROM query_logs ql
            {where_clause}
            GROUP BY ql.user_name
            ORDER BY cnt DESC
            LIMIT 1
        """), params).fetchone()

        errors_24h = conn.execute(text(f"""
            SELECT COUNT(*) FROM query_logs ql
            {where_clause}
            AND ql.error_message IS NOT NULL AND ql.error_message != ''
        """), params).scalar()

        feedback_24h = conn.execute(text(f"""
            SELECT COUNT(*) FROM query_logs ql
            {where_clause}
            AND ql.has_any_feedback = true
        """), params).scalar()

    return {
        "total_queries_24h": total_24h,
        "total_queries_all_time": total_all,
        "most_active_user_24h": most_active_row.username if most_active_row else None,
        "errors_24h": errors_24h,
        "feedback_queries_24h": feedback_24h,
        "tokens_24h": {
            "input": int(token_stats_24h.in_t or 0),
            "output": int(token_stats_24h.out_t or 0),
            "total": int((token_stats_24h.in_t or 0) + (token_stats_24h.out_t or 0)),
            "cost_input": float(token_stats_24h.in_c or 0),
            "cost_output": float(token_stats_24h.out_c or 0),
            "cost_total": float((token_stats_24h.in_c or 0) + (token_stats_24h.out_c or 0)),
        },
        "tokens_all_time": {
            "input": int(token_stats_all.in_t or 0),
            "output": int(token_stats_all.out_t or 0),
            "total": int((token_stats_all.in_t or 0) + (token_stats_all.out_t or 0)),
            "cost_input": float(token_stats_all.in_c or 0),
            "cost_output": float(token_stats_all.out_c or 0),
            "cost_total": float((token_stats_all.in_c or 0) + (token_stats_all.out_c or 0)),
        }
    }


@router.get("/logs")
def get_logs(
    _: dict = Depends(require_admin_or_supervisor),

    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=200), 
    username: Optional[str] = Query(None),
    feedback_type: Optional[str] = Query(None),
    has_error: Optional[str] = Query(None),
    model: Optional[str] = Query(None),
    lms_type: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    lms_id: Optional[str] = Query(None),
):
    date_from = _parse_date(date_from, "date_from")
    date_to = _parse_date(date_to, "date_to")

    engine = get_auth_engine()

    conditions = []
    params: dict = {"limit": page_size, "offset": (page - 1) * page_size}

    if username:
        conditions.append("ql.user_name = :username")
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

    if lms_id:
        conditions.append("ql.lms_id = :lms_id")
        params["lms_id"] = lms_id

    where_clause = "WHERE " + " AND ".join(conditions) if conditions else ""

    query = f"""
        SELECT *
        FROM query_logs ql
        LEFT JOIN token_usage_logs tu ON tu.query_id = ql.id
        {where_clause}
        ORDER BY ql.created_at_utc DESC
        LIMIT :limit OFFSET :offset
    """

    count_query = f"""
        SELECT COUNT(*) FROM query_logs ql
        {where_clause}
    """

    with engine.connect() as conn:
        rows = conn.execute(text(query), params).fetchall()
        count_params = {k: v for k, v in params.items() if k not in ("limit", "offset")}
        total = conn.execute(text(count_query), count_params).scalar()

    logs = []
    for row in rows:
        d = dict(row._mapping)
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