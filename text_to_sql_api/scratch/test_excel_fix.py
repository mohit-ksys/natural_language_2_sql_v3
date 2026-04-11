import pandas as pd
import io
from datetime import datetime, timezone

# Sample data with timezone-aware datetime
data = [
    {"name": "Alice", "created_at": datetime.now(timezone.utc)},
    {"name": "Bob", "created_at": datetime.now(timezone.utc)}
]

df = pd.DataFrame(data)

# This is expected to fail with openpyxl if not handled
output = io.BytesIO()
try:
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False)
    print("Success without fix (unexpected based on error message)")
except Exception as e:
    print(f"Failed as expected: {e}")

# Apply fix
for col in df.select_dtypes(include=['datetimetz']).columns:
    df[col] = df[col].dt.tz_localize(None)

# Try again
output = io.BytesIO()
try:
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False)
    print("Success after fix!")
except Exception as e:
    print(f"Failed even after fix: {e}")
