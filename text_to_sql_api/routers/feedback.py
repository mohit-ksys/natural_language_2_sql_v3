"""
Feedback router — logs feedback to query_logs and star ratings to chat_messages.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from models.schemas import FeedbackResponse, LogicFeedbackRequest, SqlFeedbackRequest, RatingRequest
from services import llm_service, memory_service
from auth.dependencies import get_current_user
from config.database import get_auth_engine

router = APIRouter()




@router.post("/feedback/logic", response_model=FeedbackResponse)
def logic_feedback(req: LogicFeedbackRequest, _: dict = Depends(get_current_user)):
    """Log user feedback text to query_logs."""
    memory_service.update_query_log_field(req.feedback_id, {
        "has_logic_feedback": True,
        "logic_feedback_text": req.text_feedback,
        "has_any_feedback": True,
    })
    return FeedbackResponse(
        success=True, feedback_id=req.feedback_id, new_sql="",
        answer=None, chart_type=None, data=None, executed=False,
    )


@router.post("/feedback/sql", response_model=FeedbackResponse)
def sql_feedback(req: SqlFeedbackRequest, _: dict = Depends(get_current_user)):
    """Log corrected SQL to query_logs."""
    if not llm_service.validate_sql(req.corrected_sql):
        raise HTTPException(
            status_code=403,
            detail="Corrected SQL is not read-only. Only SELECT/WITH queries are allowed.",
        )
    memory_service.update_query_log_field(req.feedback_id, {
        "has_sql_feedback": True,
        "corrected_sql": req.corrected_sql,
        "has_any_feedback": True,
    })
    return FeedbackResponse(
        success=True, feedback_id=req.feedback_id, new_sql=req.corrected_sql,
        answer=None, chart_type=None, data=None, executed=False,
    )


@router.post("/feedback/rating")
def rating_feedback(req: RatingRequest, _: dict = Depends(get_current_user)):
    """Save verdict and failure reason to chat_messages."""
    if req.query_verdict not in ("correct", "incorrect"):
        raise HTTPException(status_code=422, detail="query_verdict must be 'correct' or 'incorrect'")

    engine = get_auth_engine()
    with engine.begin() as conn:
        conn.execute(text("""
            UPDATE chat_messages
            SET query_verdict = :verdict,
                failure_reason = :reason
            WHERE feedback_id = :fid
        """), {
            "verdict": req.query_verdict,
            "reason": req.failure_reason,
            "fid": req.feedback_id,
        })
    return {"success": True}
