import os
import sys
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

AUTH_DB_URL = os.environ.get("AUTH_DB_URL")
if not AUTH_DB_URL:
    print("Error: AUTH_DB_URL not set in .env")
    sys.exit(1)

def run_sql_file(conn, file_path):
    print(f"Executing {file_path}...")
    with open(file_path, "r", encoding="utf-8") as f:
        sql = f.read()
    

    try:
        conn.execute(text(sql))
        print(f"Successfully applied {file_path}")
    except Exception as e:
        print(f"Error applying {file_path}: {e}")

def setup():
    engine = create_engine(AUTH_DB_URL)
    
    with engine.begin() as conn:
        if os.path.exists("schema.sql"):
            run_sql_file(conn, "schema.sql")
        else:
            print("schema.sql not found in current directory.")
        
        if os.path.exists("migrate_unified_auth.sql"):
            run_sql_file(conn, "migrate_unified_auth.sql")
        else:
            print("migrate_unified_auth.sql not found, skipping.")

    print("\nDatabase setup complete (Seeding skipped).")

if __name__ == "__main__":
    setup()
