import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import id_token

from app.core.config import COOKIE_SECURE, GOOGLE_CLIENT_ID, SESSION_TTL_DAYS
from app.crud.auth import (
    add_session,
    add_user,
    delete_session,
    get_session,
    get_user_by_email,
    get_user_by_google_sub,
    get_user_by_username,
)
from app.models import User, UserSession
from app.schemas import LoginRequest, RegisterRequest


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 310_000)
    return f"{salt.hex()}:{digest.hex()}"


def password_matches(password: str, stored_hash: str) -> bool:
    salt_hex, separator, digest_hex = stored_hash.partition(":")
    if not separator:
        return False
    try:
        expected = bytes.fromhex(digest_hex)
        salt = bytes.fromhex(salt_hex)
        if len(expected) == 64:
            actual = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16_384, r=8, p=1, dklen=64, maxmem=64 * 1024 * 1024)
        else:
            actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 310_000)
    except ValueError:
        return False
    return hmac.compare_digest(expected, actual)


def create_account(db: Session, data: RegisterRequest) -> tuple[User, str]:
    email = str(data.email).strip().lower()
    username = data.username.strip().lower()
    if get_user_by_email(db, email):
        raise HTTPException(status.HTTP_409_CONFLICT, "Этот email уже зарегистрирован.")
    if get_user_by_username(db, username):
        raise HTTPException(status.HTTP_409_CONFLICT, "Это имя пользователя уже занято.")
    user = User(
        email=email,
        username=username,
        display_name=data.display_name.strip(),
        password_hash=hash_password(data.password),
    )
    token = secrets.token_urlsafe(32)
    try:
        add_user(db, user)
        add_session(
            db,
            UserSession(
                token_hash=hash_token(token),
                user_id=user.id,
                expires_at=datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS),
            ),
        )
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Этот email или логин уже зарегистрирован.") from error
    return user, token


def authenticate(db: Session, data: LoginRequest) -> tuple[User, str]:
    user = get_user_by_email(db, str(data.email).strip().lower())
    if user is None or not password_matches(data.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный email или пароль.")
    if len(bytes.fromhex(user.password_hash.split(":", 1)[1])) == 64:
        user.password_hash = hash_password(data.password)
    token = secrets.token_urlsafe(32)
    add_session(
        db,
        UserSession(
            token_hash=hash_token(token),
            user_id=user.id,
            expires_at=datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS),
        ),
    )
    db.commit()
    return user, token


def authenticate_google(db: Session, credential: str) -> tuple[User, str]:
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Вход через Google пока не настроен.")
    try:
        claims = id_token.verify_oauth2_token(credential, GoogleRequest(), GOOGLE_CLIENT_ID)
    except (ValueError, GoogleAuthError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Не удалось подтвердить аккаунт Google.") from None

    google_sub = claims.get("sub")
    email = str(claims.get("email", "")).strip().lower()
    if not google_sub or not email or claims.get("email_verified") not in (True, "true"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Google не подтвердил адрес электронной почты.")

    user = get_user_by_google_sub(db, str(google_sub))
    if user is None:
        user = get_user_by_email(db, email)
        if user is not None and user.google_sub not in (None, str(google_sub)):
            raise HTTPException(status.HTTP_409_CONFLICT, "Этот email уже связан с другим аккаунтом Google.")
        if user is not None:
            user.google_sub = str(google_sub)
        else:
            username_base = re.sub(r"[^a-z0-9_]", "_", email.split("@", 1)[0].lower()).strip("_")[:20] or "user"
            username = username_base
            suffix = 1
            while get_user_by_username(db, username) is not None:
                tail = str(suffix)
                username = f"{username_base[:24 - len(tail)]}{tail}"
                suffix += 1
            display_name = str(claims.get("name") or email.split("@", 1)[0]).strip()[:50] or username
            user = User(
                username=username,
                display_name=display_name,
                email=email,
                password_hash=hash_password(secrets.token_urlsafe(48)),
                google_sub=str(google_sub),
            )
            add_user(db, user)

    token = secrets.token_urlsafe(32)
    add_session(
        db,
        UserSession(
            token_hash=hash_token(token),
            user_id=user.id,
            expires_at=datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS),
        ),
    )
    db.commit()
    return user, token


def start_session(response: Response, token: str) -> None:
    response.set_cookie(
        key="picksy_session",
        value=token,
        max_age=SESSION_TTL_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        path="/",
    )


def resolve_session(db: Session, token: str | None) -> User | None:
    if not token or len(token) > 200:
        return None
    session = get_session(db, hash_token(token))
    if session is None:
        return None
    expires_at = session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        delete_session(db, session.token_hash)
        db.commit()
        return None
    return session.user


def end_session(db: Session, token: str | None) -> None:
    if token:
        delete_session(db, hash_token(token))
        db.commit()
