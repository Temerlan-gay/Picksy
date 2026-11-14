from contextlib import asynccontextmanager
import json
import logging
import os
from pathlib import Path
import re
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from prometheus_fastapi_instrumentator import Instrumentator
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.api.routes import auth, discussion, polls, rooms
from app.core.config import CORS_ORIGINS, PROJECT_ROOT
from app.core.database import create_database_schema, engine

logger = logging.getLogger("decido.requests")


@asynccontextmanager
async def lifespan(_: FastAPI):
    create_database_schema()
    yield


app = FastAPI(
    title="Decido API",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type", "X-Poll-Invite"],
)
app.include_router(auth.router)
app.include_router(polls.router)
app.include_router(discussion.router)
app.include_router(rooms.router)


@app.middleware("http")
async def log_request(request: Request, call_next):
    request_id = request.headers.get("x-request-id", "")
    if not re.fullmatch(r"[A-Za-z0-9._:-]{1,80}", request_id):
        request_id = str(uuid4())
    request.state.request_id = request_id
    started_at = perf_counter()
    status_code = 500
    try:
        response = await call_next(request)
        status_code = response.status_code
        response.headers["X-Request-ID"] = request_id
        return response
    except Exception:
        logger.exception(json.dumps({
            "event": "request.failed",
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
        }))
        raise
    finally:
        logger.info(json.dumps({
            "event": "request.completed",
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "status_code": status_code,
            "duration_ms": round((perf_counter() - started_at) * 1000, 2),
        }))


Instrumentator().instrument(app).expose(app, endpoint="/api/metrics", include_in_schema=False)

frontend_dist = Path(os.getenv("FRONTEND_DIST", PROJECT_ROOT / "frontend" / "dist")).resolve()
frontend_index = frontend_dist / "index.html"


@app.get("/api/health", response_model=None)
def health() -> dict[str, bool]:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError:
        logger.exception(json.dumps({"event": "health.database_unavailable"}))
        return JSONResponse(status_code=503, content={"ok": False, "database": "unavailable"})
    return {"ok": True, "database": "ready"}


@app.get("/api/health/live")
def health_live() -> dict[str, bool]:
    return {"ok": True}


@app.exception_handler(404)
async def not_found_handler(_: Request, __: Exception) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": "Страница не найдена."})


if frontend_index.is_file():
    @app.get("/{path:path}", include_in_schema=False)
    def serve_frontend(path: str) -> FileResponse:
        if path == "api" or path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API endpoint not found.")
        requested_file = (frontend_dist / path).resolve()
        if requested_file.is_relative_to(frontend_dist) and requested_file.is_file():
            return FileResponse(requested_file)
        return FileResponse(frontend_index)
