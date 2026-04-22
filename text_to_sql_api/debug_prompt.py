import sys
import os
from pathlib import Path

# Add the current directory to the python path to ensure imports work correctly
current_dir = Path(__file__).resolve().parent
if str(current_dir) not in sys.path:
    sys.path.append(str(current_dir))

import dotenv
dotenv.load_dotenv()

from services.llm_service import generate_sql

def test_prompt_generation(user_query: str, session_id: str = "test-session"):
    print("="*50)
    print("🧪 TEXT-TO-SQL PROMPT GENERATION TEST")
    print("="*50)
    print(f"\n🔹 User Query: {user_query}")
    
    # Real Memory Elements from Services
    import services.memory_service as memory_service
    
    session_history = memory_service.format_session_for_prompt(session_id)
    matched_memories = memory_service.search_universal_memory(user_query)
    learned_rules = memory_service.format_memory_for_prompt(matched_memories)
    
    print(f"\n🧠 Session History (Session: {session_id}):")
    print(session_history if session_history.strip() else "(Empty)")
    
    print(f"\n📜 Learned Rules for this Query:")
    print(learned_rules if learned_rules.strip() else "(No matching rules found)")

    # We will mock the _call_gemini function within llm_service to catch the final prompt
    import services.llm_service as llm_service
    
    original_call = llm_service._call_gemini
    captured_prompt = None

    def mocked_call(prompt, *args, **kwargs):
        nonlocal captured_prompt
        captured_prompt = prompt
        return "SELECT 1;", "" # Return dummy SQL

    # Monkeypatch the service
    llm_service._call_gemini = mocked_call

    try:
        # This will trigger the internal prompt construction with real history/rules
        generate_sql(
            user_query,
            database_id="degreefyd_online_lms",
            session_history=session_history,
            learned_rules=learned_rules
        )
        
        if captured_prompt:
            print("\n" + "🔥" + " FULL PROMPT SENT TO LLM ".center(50, "=") + "🔥")
            print(captured_prompt)
            print("\n" + "="*50)
        else:
            print("\n❌ Failed to capture prompt.")

    finally:
        # Restore the original function
        llm_service._call_gemini = original_call

if __name__ == "__main__":
    if not os.path.exists(".env") and not os.path.exists("text_to_sql_api/.env"):
        print("⚠️  Warning: No .env file found. Prompt may contain missing variables.")
    
    # You can change these to test different scenarios
    query = "Show me total admissions for Rahul across all universities in the last 30 days"
    sid = "test-session"
    
    test_prompt_generation(query, sid)
