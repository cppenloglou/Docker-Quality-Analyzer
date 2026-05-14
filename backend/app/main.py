import logging
import re
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from sqlalchemy import text
from starlette.responses import Response

from app.api.router import api_router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.infrastructure.db.base import Base
from app.infrastructure.db.session import engine

_UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE)


def _normalize_path(path: str) -> str:
    return _UUID_RE.sub(":id", path)


request_counter = Counter("http_requests_total", "Total API requests", ["method", "path", "status"])
request_latency = Histogram("http_request_duration_seconds", "API request latency", ["method", "path"])


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))
        await conn.run_sync(Base.metadata.create_all)
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging()
    app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)

    allowed_origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
    if settings.app_env == "dev":
        allowed_origins = ["*"]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=settings.app_env != "dev",
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def request_context_middleware(request: Request, call_next):
        request_id = request.headers.get("x-request-id", str(uuid.uuid4()))
        start = time.perf_counter()
        response = await call_next(request)
        duration = time.perf_counter() - start
        response.headers["x-request-id"] = request_id
        normalized = _normalize_path(request.url.path)
        request_counter.labels(request.method, normalized, str(response.status_code)).inc()
        request_latency.labels(request.method, normalized).observe(duration)
        logging.getLogger("docker-platform-api").info(
            "request_complete",
            extra={"request_id": request_id},
        )
        return response

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/metrics")
    async def metrics() -> Response:
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

    app.include_router(api_router)
    return app


app = create_app()
