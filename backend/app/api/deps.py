from collections.abc import Generator

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models import User
from app.services.auth import resolve_session


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    db: Session = Depends(get_db),
    picksy_session: str | None = Cookie(default=None),
) -> User:
    user = resolve_session(db, picksy_session)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Войдите, чтобы продолжить.",
        )
    return user
