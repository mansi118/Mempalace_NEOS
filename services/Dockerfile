FROM python:3.12-slim

WORKDIR /app

# System deps for Redis/FalkorDB client.
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY config.py .
COPY graphiti_bridge.py .
COPY graph_writer.py .

# Log directory (mountable volume in production).
RUN mkdir -p /var/log/graphiti-bridge

EXPOSE 8100

CMD ["uvicorn", "graphiti_bridge:app", "--host", "0.0.0.0", "--port", "8100"]
