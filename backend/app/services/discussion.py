from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.crud.polls import (
    add_poll_message,
    count_poll_user_messages,
    get_poll_by_id,
    lock_discussion_quota,
    list_poll_messages,
    list_recent_poll_user_messages,
)
from app.models import Poll, PollMessage, User
from app.schemas import PollDiscussionResponse, PollMessageCreate, PollMessageResponse
from app.services.polls import can_access_poll

PARTICIPANT_QUESTION_LIMIT = 2
LEADER_COOLDOWN_SECONDS = 3
LEADER_MESSAGES_PER_MINUTE = 10


def _get_accessible_poll(
    db: Session,
    user: User,
    poll_id: str,
    invite_token: str | None,
) -> Poll:
    poll = get_poll_by_id(db, poll_id)
    if poll is None or not can_access_poll(poll, user, invite_token):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Голосование не найдено.")
    return poll


def _serialize_message(message: PollMessage, owner_id: str) -> PollMessageResponse:
    return PollMessageResponse(
        id=message.id,
        user_id=message.user_id,
        display_name=message.author.display_name,
        body=message.body,
        created_at=message.created_at,
        is_leader=message.user_id == owner_id,
    )


def get_discussion(
    db: Session,
    user: User,
    poll_id: str,
    invite_token: str | None = None,
) -> PollDiscussionResponse:
    poll = _get_accessible_poll(db, user, poll_id, invite_token)
    is_leader = poll.owner_id == user.id
    sent_questions = 0 if is_leader else count_poll_user_messages(db, poll.id, user.id)
    return PollDiscussionResponse(
        messages=[_serialize_message(message, poll.owner_id) for message in list_poll_messages(db, poll.id)],
        is_leader=is_leader,
        questions_remaining=None if is_leader else max(0, PARTICIPANT_QUESTION_LIMIT - sent_questions),
        question_limit=PARTICIPANT_QUESTION_LIMIT,
    )


def _is_closed(poll: Poll) -> bool:
    if poll.closed_at is not None:
        return True
    if poll.deadline is None:
        return False
    deadline = poll.deadline
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)
    return deadline <= datetime.now(timezone.utc)


def post_discussion_message(
    db: Session,
    user: User,
    poll_id: str,
    data: PollMessageCreate,
    invite_token: str | None = None,
) -> PollMessageResponse:
    poll = _get_accessible_poll(db, user, poll_id, invite_token)
    if _is_closed(poll):
        raise HTTPException(status.HTTP_409_CONFLICT, "Обсуждение закрыто вместе с голосованием.")

    is_leader = poll.owner_id == user.id
    quota = lock_discussion_quota(db, poll.id, user.id)
    if not is_leader and quota.question_count >= PARTICIPANT_QUESTION_LIMIT:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Вы использовали оба вопроса в этом голосовании.")

    now = datetime.now(timezone.utc)
    if is_leader:
        recent = list_recent_poll_user_messages(db, poll.id, user.id, now - timedelta(minutes=1))
        if recent:
            latest_created_at = recent[0].created_at
            if latest_created_at.tzinfo is None:
                latest_created_at = latest_created_at.replace(tzinfo=timezone.utc)
            elapsed = (now - latest_created_at).total_seconds()
            if elapsed < LEADER_COOLDOWN_SECONDS:
                retry_after = max(1, int(LEADER_COOLDOWN_SECONDS - elapsed + 0.99))
                raise HTTPException(
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    "Подождите пару секунд перед следующим сообщением.",
                    headers={"Retry-After": str(retry_after)},
                )
        if len(recent) >= LEADER_MESSAGES_PER_MINUTE:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "Лимит сообщений лидера — 10 в минуту.",
                headers={"Retry-After": "60"},
            )
        normalized_body = " ".join(data.body.casefold().split())
        if any(" ".join(message.body.casefold().split()) == normalized_body for message in recent):
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "Не отправляйте одинаковое сообщение повторно в течение минуты.",
                headers={"Retry-After": "60"},
            )
    else:
        quota.question_count += 1

    quota.last_message_at = now
    message = PollMessage(
        poll_id=poll.id,
        author=user,
        body=data.body,
        created_at=now,
    )
    add_poll_message(db, message)
    db.commit()
    return _serialize_message(message, poll.owner_id)
