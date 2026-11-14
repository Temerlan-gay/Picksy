from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import auth, polls
from app.core.config import CORS_ORIGINS
from app.core.database import create_database_schema


@asynccontextmanager
async def lifespan(_: FastAPI):
    create_database_schema()
    yield


app = FastAPI(title="Picksy API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Poll-Invite"],
)
app.include_router(auth.router)
app.include_router(polls.router)


@app.get("/api/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.exception_handler(404)
async def not_found_handler(_: Request, __: Exception) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": "Страница не найдена."})
