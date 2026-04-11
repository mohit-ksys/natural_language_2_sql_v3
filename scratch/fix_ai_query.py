import re

def fix_ai_query(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Pattern for save_feedback inside process_query security block
    # We look for the one that has error_message="..." and user_msg_id=req.user_msg_id
    pattern1 = r'(fid = memory_service\.save_feedback\(.*?"Security block: non-read-only SQL generated\.",.*?user_msg_id=req\.user_msg_id\s*)(\))'
    content = re.sub(pattern1, r'\1, delete_msg_id=req.delete_msg_id\2', content, flags=re.DOTALL)

    # Pattern for save_feedback inside process_query main path
    # We look for the one that has thoughts=thoughts, user_msg_id=req.user_msg_id, lms_id=req.lms_id
    pattern2 = r'(fid = memory_service\.save_feedback\(.*?thoughts=thoughts,.*?user_msg_id=req\.user_msg_id,.*?lms_id=req\.lms_id\s*)(\))'
    content = re.sub(pattern2, r'\1, delete_msg_id=req.delete_msg_id\2', content, flags=re.DOTALL)

    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)

if __name__ == "__main__":
    fix_ai_query('text_to_sql_api/routers/ai_query.py')
