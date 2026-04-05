import pathlib

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config.settings import settings
from routers.ai_query import router as query_router
from routers.auth import router as auth_router
from routers.dashboard import router as dashboard_router
from routers.feedback import router as feedback_router
from routers.chat_persistence import router as chat_router


def create_data_dir():
    data_dir = pathlib.Path(settings.DATA_DIR)
    data_dir.mkdir(parents=True, exist_ok=True)


app = FastAPI(
    title="DataWhisper API",
    description="Conversational Text-to-SQL API with auth, session memory, and feedback.",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    create_data_dir()
    print(f"✅ Data directory ready: {settings.DATA_DIR}")
    print(f"✅ Knowledge base: {settings.KNOWLEDGE_BASE_DIR}")
    print(f"✅ Default model: {settings.GEMINI_MODEL}")
    from config.database import test_connection
    if test_connection():
        print("✅ Auth DB connection: OK")
    else:
        print("❌ Auth DB connection: FAILED — check AUTH_DB_URL in .env")


app.include_router(auth_router)
app.include_router(query_router, tags=["Query"])
app.include_router(feedback_router, tags=["Feedback"])
app.include_router(chat_router, tags=["Chat Persistence"])
app.include_router(dashboard_router)


@app.get("/", tags=["Health"])
def root():
    return {"status": "ok", "service": "DataWhisper API", "version": "2.0.0"}


@app.get("/health", tags=["Health"])
def health():
    from services.llm_service import get_active_model
    return {"status": "ok", "active_model": get_active_model()}
