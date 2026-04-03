"""
Feedback router — logs feedback to query_logs table.
"""

from fastapi import APIRouter, Depends, HTTPException
from models.schemas import FeedbackResponse, LogicFeedbackRequest, SqlFeedbackRequest
from services import llm_service, memory_service
from auth.dependencies import get_current_user

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
