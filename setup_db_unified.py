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
    
    base_path = os.path.dirname(os.path.abspath(__file__))
    schema_sql = os.path.join(base_path, "schema.sql")
    migration_sql = os.path.join(base_path, "migrate_unified_auth.sql")

    with engine.begin() as conn:
        if os.path.exists(schema_sql):
            run_sql_file(conn, schema_sql)
        else:
            print(f"{schema_sql} not found.")
        
        if os.path.exists(migration_sql):
            run_sql_file(conn, migration_sql)
        else:
            print(f"{migration_sql} not found, skipping.")

    print("\nDatabase setup complete (Seeding skipped).")

if __name__ == "__main__":
    setup()
