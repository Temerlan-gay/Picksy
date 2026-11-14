from uuid import UUID

from fastapi import APIRouter, Depends, Header, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models import User
from app.schemas import PollCreate, PollListResponse, PollResponse, VoteRequest
from app.services.polls import cast_vote, close_poll, create_poll, create_poll_invitation, get_poll, list_polls

router = APIRouter(prefix="/api/polls", tags=["polls"])


@router.get("", response_model=PollListResponse)
def get_polls(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PollListResponse:
    return PollListResponse(polls=list_polls(db, user))


@router.post("", response_model=PollResponse, status_code=status.HTTP_201_CREATED)
def post_poll(
    data: PollCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PollResponse:
    return create_poll(db, user, data)


@router.get("/{poll_id}", response_model=PollResponse)
def get_poll_detail(
    poll_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    invite_token: str | None = Header(default=None, alias="x-poll-invite"),
) -> PollResponse:
    return get_poll(db, user, str(poll_id), invite_token)


@router.post("/{poll_id}/invitation")
def post_poll_invitation(
    poll_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    return create_poll_invitation(db, user, str(poll_id))


@router.post("/{poll_id}/vote", response_model=PollResponse)
def post_vote(
    poll_id: UUID,
    data: VoteRequest,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    invite_token: str | None = Header(default=None, alias="x-poll-invite"),
) -> PollResponse:
    updated = cast_vote(db, user, str(poll_id), data, invite_token)
    response.status_code = status.HTTP_200_OK
    return updated


@router.post("/{poll_id}/close", response_model=PollResponse)
def post_close_poll(
    poll_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PollResponse:
    return close_poll(db, user, str(poll_id))
