from fastapi import APIRouter, Cookie, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.config import COOKIE_SECURE
from app.models import User
from app.schemas import AuthResponse, GoogleCredentialRequest, LoginRequest, RegisterRequest, UserResponse
from app.services.auth import authenticate, authenticate_google, create_account, end_session, resolve_session, start_session

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/me", response_model=AuthResponse)
def get_me(
    db: Session = Depends(get_db),
    picksy_session: str | None = Cookie(default=None),
) -> AuthResponse:
    user = resolve_session(db, picksy_session)
    return AuthResponse(user=UserResponse.model_validate(user) if user else None)


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register(
    data: RegisterRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> AuthResponse:
    user, token = create_account(db, data)
    start_session(response, token)
    return AuthResponse(user=UserResponse.model_validate(user))


@router.post("/login", response_model=AuthResponse)
def login(
    data: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> AuthResponse:
    user, token = authenticate(db, data)
    start_session(response, token)
    return AuthResponse(user=UserResponse.model_validate(user))


@router.post("/google", response_model=AuthResponse)
def login_with_google(
    data: GoogleCredentialRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> AuthResponse:
    user, token = authenticate_google(db, data.credential)
    start_session(response, token)
    return AuthResponse(user=UserResponse.model_validate(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    picksy_session: str | None = Cookie(default=None),
) -> Response:
    end_session(db, picksy_session)
    response.delete_cookie(
        "picksy_session",
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
        path="/",
    )
    response.status_code = status.HTTP_204_NO_CONTENT
    return response
