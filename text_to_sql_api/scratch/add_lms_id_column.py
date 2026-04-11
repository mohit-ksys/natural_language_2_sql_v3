from sqlalchemy import text
from config.database import get_auth_engine
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("migration")

def migrate():
    engine = get_auth_engine()
    tables = ['query_logs', 'chats', 'chat_messages']
    try:
        with engine.begin() as conn:
            for table in tables:
                logger.info(f"Checking for 'lms_id' in '{table}'...")
                res = conn.execute(text(f"""
                    SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_name='{table}' AND column_name='lms_id';
                """)).fetchone()
                
                if not res:
                    logger.info(f"Adding 'lms_id' column to '{table}'...")
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN lms_id VARCHAR(50);"))
                    logger.info(f"Column added to '{table}'.")
                else:
                    logger.info(f"'lms_id' already exists in '{table}'.")

        logger.info("Migration successful!")
    except Exception as e:
        logger.error(f"Migration failed: {e}")

if __name__ == "__main__":
    migrate()
