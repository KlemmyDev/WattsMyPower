# Two images from one file:
#   collector  reads the inverters and stores raw registers (rarely changes; see collector/PROTOCOL.md)
#   api        the dashboard and its API (the default target, built last)
# docker-compose.yml builds both. The collector's image only changes when collector/ or the
# dependencies do, so updating the dashboard leaves the collector running untouched.
#
# Both run as an ordinary user, not root: docker-entrypoint.sh hands them the data folder and drops root.
#
# The base images are pinned by digest, so a rebuild gets exactly the same ones. They work on amd64 and arm64
# (a Raspberry Pi with a 64-bit OS). To move to newer ones, look up each tag's current digest, e.g.
#   docker buildx imagetools inspect node:24-slim        (the "Digest:" at the top)
# and replace the sha256 after the @ (uv's tag names a version: move both together).

# ---- dashboard: build the single-page app with Node; only its static output is kept
FROM node:24-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- shared Python base
FROM python:3.13-slim@sha256:70729b46c69b4f1e97c4822c1af3df53a1476cf5ddc6c087c0c10bc3a5678c2f AS python
# tzdata so SQLite's 'localtime' (daily totals) and log timestamps follow $TZ
RUN apt-get update && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/*
# Dependencies come from the lockfile, into /app/.venv (uv is only used to install them).
COPY --from=ghcr.io/astral-sh/uv:0.12.24@sha256:3af4716e991d6956a41e573eab705d0ee08500cd829ed30293eb8472f372c65a /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never \
    PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
COPY pyproject.toml uv.lock ./
COPY docker-entrypoint.sh /usr/local/bin/
VOLUME /data
ENTRYPOINT ["docker-entrypoint.sh"]

# ---- collector: the only thing that talks to the inverters
FROM python AS collector
RUN uv sync --frozen --no-dev --no-install-project --extra collector
COPY collector ./collector
# Compiled here, as it can't write in /app once it's running.
RUN python -m compileall -q collector
ENV COLLECTOR_DB_PATH=/data/collector.db
EXPOSE 8081
# Every 30 s, as the dashboard waits for the first to pass before it starts (docker-compose.yml).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8081/healthz', timeout=4)"
# One process on purpose: the WiNet-S2 doesn't like more than one Modbus client at a time.
CMD ["python", "-m", "collector"]

# ---- api: the dashboard, following the collector's feed
FROM python AS api
RUN uv sync --frozen --no-dev --no-install-project
COPY app ./app
RUN python -m compileall -q app
COPY --from=web /web/dist/client ./web/dist/client
# The commit it's built from (install.sh passes it), so it can tell when GitHub has a newer one. Last, as it changes
# with every build.
ARG GIT_COMMIT=""
ENV DB_PATH=/data/wattsmypower.db GIT_COMMIT=${GIT_COMMIT}
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=4)"
# One worker: the ingest loop and the live stream live in-process.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--no-access-log"]
