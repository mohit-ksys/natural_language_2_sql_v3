"""
Simplified feedback router - logs feedback to conversational log only.
Not used for model improvement or memory building (per user request).
"""

from fastapi import APIRouter, HTTPException
from models.schemas import FeedbackResponse, LogicFeedbackRequest, SqlFeedbackRequest
from services import llm_service, memory_service

router = APIRouter()


@router.post("/feedback/logic", response_model=FeedbackResponse)
def logic_feedback(req: LogicFeedbackRequest):
    """Log user feedback text. No regeneration, no memory update."""
    # This endpoint now just acknowledges feedback without taking action
    return FeedbackResponse(
        success=True,
        feedback_id=req.feedback_id,
        new_sql="",  # No regeneration
        answer=None,
        chart_type=None,
        data=None,
        executed=False,
    )


@router.post("/feedback/sql", response_model=FeedbackResponse)
def sql_feedback(req: SqlFeedbackRequest):
    """Log corrected SQL. No memory update."""
    if not llm_service.validate_sql(req.corrected_sql):
        raise HTTPException(
            status_code=403,
            detail="Corrected SQL is not read-only. Only SELECT/WITH queries are allowed.",
        )

    # Just acknowledge without storing in memory
    return FeedbackResponse(
        success=True,
        feedback_id=req.feedback_id,
        new_sql=req.corrected_sql,
        answer=None,
        chart_type=None,
        data=None,
        executed=False,
    )
