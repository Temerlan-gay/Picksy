from contextlib import asynccontextmanager
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from app.api.routes import auth, polls
from app.core.config import CORS_ORIGINS, PROJECT_ROOT
from app.core.database import create_database_schema


@asynccontextmanager
async def lifespan(_: FastAPI):
    create_database_schema()
    yield


app = FastAPI(title="Decido API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Poll-Invite"],
)
app.include_router(auth.router)
app.include_router(polls.router)

frontend_dist = Path(os.getenv("FRONTEND_DIST", PROJECT_ROOT / "frontend" / "dist")).resolve()
frontend_index = frontend_dist / "index.html"


@app.get("/api/health")
def health() -> dict[str, bool]:
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
