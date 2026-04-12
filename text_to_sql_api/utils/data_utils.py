import re

def enforce_sql_limit(sql: str, default_limit: int = 100) -> str:

    sql = sql.strip()
    
    has_semicolon = sql.endswith(';')
    if has_semicolon:
        sql = sql[:-1].strip()

    limit_match = re.search(r'(?i)\bLIMIT\s+(\d+)', sql)
    
    if limit_match:
        current_limit = int(limit_match.group(1))
        if current_limit > default_limit:
            sql = re.sub(r'(?i)\bLIMIT\s+\d+', f'LIMIT {default_limit}', sql)
    else:
        sql = f"{sql} LIMIT {default_limit}"
    
    if has_semicolon:
        sql += ";"
        
    return sql

def scrub_results(rows: list[dict]) -> list[dict]:
  
    if not rows:
        return rows
        
    scrubbed_rows = []
    for row in rows:
        new_row = {}
        for k, v in row.items():
            k_lower = k.lower()
            
            if 'phone' in k_lower or 'mobile' in k_lower or 'parents_number' in k_lower:
                continue
                
            if 'email' in k_lower and v:
                email = str(v)
                if '@' in email:
                    try:
                        name, domain = email.split('@', 1)
                        if len(name) > 1:
                            new_row[k] = f"{name[0]}***@{domain}"
                        else:
                            new_row[k] = f"***@{domain}"
                    except Exception:
                        new_row[k] = "***"
                else:
                    new_row[k] = "***"
            else:
                new_row[k] = v
        scrubbed_rows.append(new_row)
        
    return scrubbed_rows
