from typing import Any, Optional
from pydantic import BaseModel


class QueryRequest(BaseModel):
    user_query: str
    session_id: str
    chat_id: Optional[str] = None  # Frontend chat ID for logging (internal use only)
    model: Optional[str] = None
    thinking_enabled: bool = False
    thinking_level: str = "high"
    include_thoughts: bool = False
    execute: bool = False  # if False, return SQL only without running against DB


class QueryResponse(BaseModel):
    feedback_id: str
    session_id: str
    sql: str
    execution_time: float
    cached: bool
    executed: bool = False
    answer: Optional[str] = None
    chart_type: Optional[str] = None
    data: Optional[list[dict[str, Any]]] = None
    session_context_alert: Optional[str] = None  # Alert about 5-turn context limit
    token_usage: Optional[dict] = None  # {model, input_tokens, output_tokens}


class ExecuteRequest(BaseModel):
    sql: str
    session_id: str
    original_query: Optional[str] = None
    feedback_id: Optional[str] = None
    model: Optional[str] = None


class ExecuteResponse(BaseModel):
    answer: str
    chart_type: str
    data: list[dict[str, Any]]
    execution_time: float
    feedback_id: Optional[str] = None
    token_usage: Optional[dict] = None  # {model, input_tokens, output_tokens}


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
    sessions: dict[str, Any]  # session_id -> {created_at, turns: [...]}


