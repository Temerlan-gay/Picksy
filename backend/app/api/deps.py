from collections.abc import Generator
import hashlib

from fastapi import Cookie, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models import User
from app.crud.rooms import get_guest_user
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


def get_room_actor(
    db: Session = Depends(get_db),
    picksy_session: str | None = Cookie(default=None),
    room_guest: str | None = Header(default=None, alias="X-Room-Guest"),
) -> User:
    user = resolve_session(db, picksy_session)
    if user is not None:
        return user
    if room_guest:
        user = get_guest_user(db, hashlib.sha256(room_guest.encode("utf-8")).hexdigest())
        if user is not None:
            return user
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Войдите или присоединитесь к комнате по коду.",
    )
