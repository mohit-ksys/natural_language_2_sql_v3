from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from config.settings import settings
from utils.data_utils import enforce_sql_limit, scrub_results


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
_online_engine = None
_regular_engine = None


def get_auth_engine():
    global _auth_engine
    if _auth_engine is None:
        _auth_engine = _make_engine(settings.AUTH_DB_URL)
    return _auth_engine


def get_lms_engine(lms_type: str):
    global _online_engine, _regular_engine
    if lms_type == "online":
        if _online_engine is None:
            _online_engine = _make_engine(settings.ONLINE_LMS_URL)
        return _online_engine
    else:
        if _regular_engine is None:
            _regular_engine = _make_engine(settings.REGULAR_LMS_URL)
        return _regular_engine


def test_connection() -> bool:
    """Test auth DB connectivity at startup."""
    try:
        with get_auth_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as e:
        print(f"❌ Auth DB connection test FAILED: {e}")
        return False


def execute_sql(sql: str, lms_type: str = "online", apply_limit: bool = True) -> list[dict]:
    """Execute a read-only SQL query against the LMS database."""
    engine = get_lms_engine(lms_type)
    
    if apply_limit:
        sql = enforce_sql_limit(sql, settings.DATA_LIMIT)
        
    try:
        with engine.connect() as conn:
            conn.execute(text("SET LOCAL statement_timeout = '30000'"))
            result = conn.execute(text(sql))
            columns = list(result.keys())
            rows = result.fetchall()
            data = [dict(zip(columns, row)) for row in rows]
            
            return scrub_results(data)
    except Exception as e:
        raise
