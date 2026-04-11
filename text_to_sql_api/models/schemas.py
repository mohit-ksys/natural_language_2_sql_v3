from typing import Any, Optional, Dict, List
from pydantic import BaseModel, ConfigDict


class QueryRequest(BaseModel):
    user_query: str
    session_id: str
    chat_id: Optional[str] = None
    user_msg_id: Optional[str] = None
    model: Optional[str] = None
    lms_type: Optional[str] = None   # super_admin only; ignored for other roles
    thinking_enabled: bool = False
    thinking_level: str = "high"
    include_thoughts: bool = False
    execute: bool = False
    lms_id: Optional[str] = None



class QueryResponse(BaseModel):
    feedback_id: str
    session_id: str
    chat_id: str
    sql: str
    execution_time: float
    cached: bool
    executed: bool = False
    answer: Optional[str] = None
    chart_type: Optional[str] = None
    data: Optional[list[dict[str, Any]]] = None
    session_context_alert: Optional[str] = None
    token_usage: Optional[dict] = None
    sql_auto_fixed: bool = False   # True when execution failed and LLM auto-fixed the SQL
    sql_error: Optional[str] = None  # Original DB error that triggered auto-fix (or final error)
    thoughts: Optional[str] = None
    total_rows: Optional[int] = None


class ExecuteRequest(BaseModel):
    sql: str
    session_id: str
    original_query: Optional[str] = None
    feedback_id: Optional[str] = None
    model: Optional[str] = None
    chat_id: Optional[str] = None
    lms_type: Optional[str] = None   # super_admin only
    thoughts: Optional[str] = None
    lms_id: Optional[str] = None



class ExecuteResponse(BaseModel):
    answer: str
    chart_type: str
    data: list[dict[str, Any]]
    execution_time: float
    feedback_id: Optional[str] = None
    sql: Optional[str] = None
    session_id: Optional[str] = None
    chat_id: Optional[str] = None
    token_usage: Optional[dict] = None
    thoughts: Optional[str] = None
    total_rows: Optional[int] = None


class LogicFeedbackRequest(BaseModel):
    feedback_id: str
    text_feedback: str
    session_id: str
    save_to_universal_memory: bool = False


class SqlFeedbackRequest(BaseModel):
    feedback_id: str
    corrected_sql: str
    session_id: str


class FeedbackResponse(BaseModel):
    success: bool
    feedback_id: str
    new_sql: str
    answer: Optional[str] = None
    chart_type: Optional[str] = None
    data: Optional[list[dict[str, Any]]] = None
    executed: bool = False


class ModelSwitchRequest(BaseModel):
    model: str


class ModelSwitchResponse(BaseModel):
    active_model: str


class HistoryResponse(BaseModel):
    success: bool
    data: list[dict[str, Any]]


class SessionsResponse(BaseModel):
    success: bool
    sessions: dict[str, Any]


# ─── MCQ Disambiguation Models ───────────────────────────────────────────────

class MCQOption(BaseModel):
    label: str
    text: str


class MCQQuestion(BaseModel):
    question_id: str
    question_text: str
    options: list[MCQOption]


class DisambiguateRequest(BaseModel):
    user_query: str
    session_id: str
    chat_id: Optional[str] = None
    user_msg_id: Optional[str] = None
    model: Optional[str] = None
    lms_type: Optional[str] = None
    lms_id: Optional[str] = None



class DisambiguateResponse(BaseModel):
    query_id: str
    session_id: str
    chat_id: str
    questions: list[MCQQuestion]
    original_query: str
    mcq_msg_id: Optional[str] = None


class MCQAnswerRequest(BaseModel):
    query_id: str
    session_id: str
    chat_id: Optional[str] = None
    answers: list[int | str]
    model: Optional[str] = None
    execute: bool = False
    lms_id: Optional[str] = None



class EnhancedFeedbackRequest(BaseModel):
    query_id: str
    session_id: str
    chat_id: Optional[str] = None
    feedback: str
    model: Optional[str] = None
    execute: bool = False
    lms_id: Optional[str] = None

