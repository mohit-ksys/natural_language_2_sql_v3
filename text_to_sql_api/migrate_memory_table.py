from config.database import get_auth_engine
from sqlalchemy import text
import logging

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("migration")

def migrate():
    engine = get_auth_engine()
    with engine.begin() as conn:
        log.info("Renaming table session_turns to conversation_memory...")
        try:
            conn.execute(text("ALTER TABLE session_turns RENAME TO conversation_memory;"))
            log.info("Successfully renamed table.")
        except Exception as e:
            log.warning("Could not rename table (maybe already renamed?): %s", e)

        log.info("Renaming column session_id to chat_id in conversation_memory...")
        try:
            conn.execute(text("ALTER TABLE conversation_memory RENAME COLUMN session_id TO chat_id;"))
            log.info("Successfully renamed column.")
        except Exception as e:
            log.warning("Could not rename column (maybe already renamed?): %s", e)

if __name__ == "__main__":
    migrate()
