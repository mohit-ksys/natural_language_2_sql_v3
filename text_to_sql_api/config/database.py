from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from config.settings import settings


def _make_engine(url: str):
    if "supabase.co" in url and "sslmode" not in url:
        url += ("&" if "?" in url else "?") + "sslmode=require"
    return create_engine(
        url,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
        pool_timeout=30,
        pool_recycle=1800,
        connect_args={"connect_timeout": 10},
    )


def _resolve_engine():
    """Try primary DB; fall back to Supabase if primary is unreachable."""
    candidates = []
    if settings.DATABASE_URL:
        candidates.append(("Primary (DataHub)", settings.DATABASE_URL))
    if settings.SUPABASE_URL:
        candidates.append(("Fallback (Supabase)", settings.SUPABASE_URL))

    for label, url in candidates:
        try:
            eng = _make_engine(url)
            with eng.connect() as conn:
                conn.execute(text("SELECT 1"))
            print(f"✅ Database connected via {label}")
            return eng
        except Exception as e:
            print(f"⚠️  {label} unreachable: {e}")

    # All candidates failed — return last engine anyway so the app starts
    print("❌ All database connections failed — app will start but queries will error.")
    return _make_engine(candidates[-1][1]) if candidates else None


engine = _resolve_engine()

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def test_connection() -> bool:
    """Test database connectivity at startup. Returns True on success."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as e:
        print(f"❌ Database connection test FAILED: {e}")
        return False


def execute_sql(sql: str) -> list[dict]:
    """Execute a read-only SQL query and return results as list of dicts."""
    try:
        with SessionLocal() as session:
            session.execute(text("SET LOCAL statement_timeout = '30000'"))
            result = session.execute(text(sql))
            columns = list(result.keys())
            rows = result.fetchall()
            return [dict(zip(columns, row)) for row in rows]
    except Exception as e:
        print(f"❌ SQL execution error: {e}")
        raise
