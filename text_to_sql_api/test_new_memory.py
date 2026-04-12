from services import memory_service
import uuid
import logging

logging.basicConfig(level=logging.INFO)

def test_memory():
    chat_id = "test-chat-" + str(uuid.uuid4())[:8]
    user_id = "test-user"
    
    print(f"--- Testing memory for chat: {chat_id} ---")
    
    # 1. Append a turn
    memory_service.append_session_turn(
        session_id=chat_id,
        user_query="Who is the president?",
        generated_sql="SELECT name FROM presidents LIMIT 1",
        answer="John Doe",
        feedback_id="test-fid-1",
        user_id=user_id
    )
    print("Turn appended.")
    
    # 2. Get session
    session = memory_service.get_session(chat_id)
    turns = session.get("turns", [])
    print(f"Retrieved {len(turns)} turns.")
    
    if len(turns) > 0:
        print(f"Last turn query: {turns[0].get('user_query')}")
        if turns[0].get('user_query') == "Who is the president?":
            print("SUCCESS: Memory working with new table/column names!")
        else:
            print("FAILURE: Data mismatch.")
    else:
        print("FAILURE: No turns retrieved.")

if __name__ == "__main__":
    test_memory()
