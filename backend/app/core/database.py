from pathlib import Path

from sqlalchemy import create_engine, inspect, make_url, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import DATABASE_URL, PROJECT_ROOT


class Base(DeclarativeBase):
    pass


database_name = make_url(DATABASE_URL).database
if DATABASE_URL.startswith("sqlite") and database_name and database_name != ":memory:":
    database_file = Path(database_name)
    if not database_file.is_absolute():
        database_file = PROJECT_ROOT / database_file
    database_file.parent.mkdir(parents=True, exist_ok=True)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
pool_options = {"pool_size": 1, "max_overflow": 0, "pool_recycle": 300} if DATABASE_URL.startswith("postgresql") else {}
engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,
    **pool_options,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def create_database_schema() -> None:
    from app import models

    del models
    Base.metadata.create_all(bind=engine)
    if "google_sub" not in {column["name"] for column in inspect(engine).get_columns("users")}:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE users ADD COLUMN google_sub VARCHAR(255)"))
    if "subtitle" not in {column["name"] for column in inspect(engine).get_columns("poll_options")}:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE poll_options ADD COLUMN subtitle VARCHAR(160) NOT NULL DEFAULT ''"))
    with engine.begin() as connection:
        connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_google_sub ON users (google_sub)"))
