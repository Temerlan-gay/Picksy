import os
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env")
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite:///{(PROJECT_ROOT / 'data' / 'decido.sqlite').as_posix()}",
)
SESSION_TTL_DAYS = int(os.getenv("SESSION_TTL_DAYS", "14"))
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173").split(",")
    if origin.strip()
]
