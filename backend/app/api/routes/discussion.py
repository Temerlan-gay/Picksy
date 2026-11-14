from uuid import UUID

from fastapi import APIRouter, Depends, Header, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models import User
from app.schemas import PollDiscussionResponse, PollMessageCreate, PollMessageResponse
from app.services.discussion import get_discussion, post_discussion_message

router = APIRouter(prefix="/api/polls", tags=["poll discussion"])


@router.get("/{poll_id}/messages", response_model=PollDiscussionResponse)
def read_discussion(
    poll_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    invite_token: str | None = Header(default=None, alias="x-poll-invite"),
) -> PollDiscussionResponse:
    return get_discussion(db, user, str(poll_id), invite_token)


@router.post(
    "/{poll_id}/messages",
    response_model=PollMessageResponse,
    status_code=status.HTTP_201_CREATED,
)
def send_discussion_message(
    poll_id: UUID,
    data: PollMessageCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    invite_token: str | None = Header(default=None, alias="x-poll-invite"),
) -> PollMessageResponse:
    return post_discussion_message(db, user, str(poll_id), data, invite_token)
