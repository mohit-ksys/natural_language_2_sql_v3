FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1
ENV PYTHONPATH=/app

WORKDIR /app

RUN apt-get update && apt-get install -y \
    libpq-dev \
    gcc \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

COPY text_to_sql_api/requirements.txt /app/text_to_sql_api/requirements.txt

RUN pip install --no-cache-dir -r /app/text_to_sql_api/requirements.txt
COPY knowledge_base /app/knowledge_base

COPY text_to_sql_api /app/text_to_sql_api

WORKDIR /app/text_to_sql_api

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
#CMD ["gunicorn", "-k", "uvicorn.workers.UvicornWorker", "main:app", "-w", "4", "-b", "0.0.0.0:8000"]