import os

def normalize_schemas(file_path):
    if not os.path.exists(file_path):
        return
    
    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    cleaned_lines = []
    current_class = None
    seen_fields = set()
    
    for line in lines:
        raw_line = line.strip()
        if raw_line.startswith('class '):
            current_class = raw_line.split('(')[0].replace('class ', '')
            seen_fields = set()
            cleaned_lines.append(line)
        elif ':' in raw_line and current_class:
            # It's likely a field definition
            field = raw_line.split(':')[0].strip()
            if field in seen_fields:
                continue
            seen_fields.add(field)
            cleaned_lines.append(line)
        else:
            cleaned_lines.append(line)
            
    with open(file_path, 'w', encoding='utf-8') as f:
        f.writelines(cleaned_lines)

if __name__ == "__main__":
    normalize_schemas('text_to_sql_api/models/schemas.py')
