# ReturnPilot backend: FastAPI + LangGraph agent (+ embedded MCP server), Celery worker/beat and Redis
# in one container, because Render's free tier allows a single web service (SPEC §3.4, §14.4).
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    MALLOC_ARENA_MAX=2 \
    PORT=10000 \
    MCP_EMBEDDED=true

RUN apt-get update \
 && apt-get install -y --no-install-recommends redis-server tini \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home app

COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /usr/local/bin/uv
WORKDIR /app

# Dependencies first (cached layer), then the project itself.
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project
COPY returnpilot ./returnpilot
COPY data ./data
COPY profiles ./profiles
COPY alembic.ini Procfile ./
RUN uv sync --frozen --no-dev && chown -R app:app /app

ENV PATH="/app/.venv/bin:$PATH"
USER app
EXPOSE 10000

ENTRYPOINT ["tini", "--"]
# bootstrap = migrations + seed (if empty) + policy ingest (if changed) + LangGraph tables
# honcho assigns its own PORT to every process, so the public port is pinned in WEB_PORT first.
CMD ["sh", "-c", "export WEB_PORT=${PORT:-10000} && python -m returnpilot.db.bootstrap && exec honcho start --no-prefix"]
