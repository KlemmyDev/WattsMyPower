# ---- dashboard: build the single-page app with Node; only its static output is kept
FROM node:24-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- server: Python only
FROM python:3.12-slim

# tzdata so SQLite's 'localtime' (daily totals) and log timestamps follow $TZ
RUN apt-get update && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY --from=web /web/dist/client ./web/dist/client

ENV DB_PATH=/data/wattsmypower.db \
    PYTHONUNBUFFERED=1
VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=4)"

# One worker on purpose: the poller lives in-process and the WiNet-S2
# doesn't like more than one Modbus client at a time.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--no-access-log"]
