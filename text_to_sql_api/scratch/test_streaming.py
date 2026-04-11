import io
from fastapi.responses import StreamingResponse

output = io.BytesIO(b"hello world")
try:
    res = StreamingResponse(output)
    print("StreamingResponse accepted BytesIO")
except TypeError as e:
    print(f"Error: {e}")

# Try with iterator
try:
    res = StreamingResponse(iter([output.getvalue()]))
    print("StreamingResponse accepted iterator")
except TypeError as e:
    print(f"Error: {e}")
