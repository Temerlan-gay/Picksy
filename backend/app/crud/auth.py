from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import User, UserSession


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email))


def get_user_by_google_sub(db: Session, google_sub: str) -> User | None:
    return db.scalar(select(User).where(User.google_sub == google_sub))


def get_user_by_username(db: Session, username: str) -> User | None:
    return db.scalar(select(User).where(User.username == username))


def add_user(db: Session, user: User) -> User:
    db.add(user)
    db.flush()
    return user


def add_session(db: Session, session: UserSession) -> None:
    db.add(session)
    db.flush()


def get_session(db: Session, token_hash: str) -> UserSession | None:
    return db.scalar(
        select(UserSession)
        .where(UserSession.token_hash == token_hash)
    )


def delete_session(db: Session, token_hash: str) -> None:
    db.execute(delete(UserSession).where(UserSession.token_hash == token_hash))
