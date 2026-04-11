from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from config.settings import settings


def _make_engine(url: str):
    connect_args = {"connect_timeout": 10}
    if "supabase.co" in url and "sslmode" not in url:
        url += ("&" if "?" in url else "?") + "sslmode=require"
    return create_engine(
        url,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
        pool_timeout=30,
        pool_recycle=1800,
        connect_args=connect_args,
    )


_auth_engine = None
_lms_engines: dict = {}


def get_auth_engine():
    global _auth_engine
    if _auth_engine is None:
        _auth_engine = _make_engine(settings.AUTH_DB_URL)
    return _auth_engine


def get_lms_engine(database_id: str):
    """Return (and lazily create) a SQLAlchemy engine for the given database_id."""
    global _lms_engines
    if database_id not in _lms_engines:
        url = settings.get_db_url(database_id)
        _lms_engines[database_id] = _make_engine(url)
    return _lms_engines[database_id]


def test_connection() -> bool:
    """Test auth DB connectivity at startup."""
    try:
        with get_auth_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as e:
        print(f"❌ Auth DB connection test FAILED: {e}")
        return False


def execute_sql(sql: str, database_id: str = "degreefyd_online_lms") -> list[dict]:
    """Execute a read-only SQL query against the LMS database."""
    engine = get_lms_engine(database_id)
    try:
        with engine.connect() as conn:
            conn.execute(text("SET LOCAL statement_timeout = '30000'"))
            result = conn.execute(text(sql))
            columns = list(result.keys())
            rows = result.fetchall()
            return [dict(zip(columns, row)) for row in rows]
    except Exception as e:
        print(f"❌ SQL execution error: {e}")
        raise
