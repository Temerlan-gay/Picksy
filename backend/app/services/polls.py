from datetime import datetime, timezone
import hashlib
import secrets

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.crud.polls import add_poll, get_poll_by_id, list_visible_polls, replace_vote, set_poll_closed, set_poll_invite_hash
from app.models import Poll, PollOption, User
from app.schemas import (
    PollCreate,
    PollOptionResponse,
    PollResponse,
    RatingResponse,
    VoteRequest,
    VoteResponse,
)


def _is_closed(poll: Poll) -> bool:
    now = datetime.now(timezone.utc)
    deadline = poll.deadline
    deadline_passed = deadline is not None and deadline.replace(tzinfo=timezone.utc) <= now
    return poll.closed_at is not None or deadline_passed


def _serialize_poll(poll: Poll, user_id: str, invite_token: str | None = None) -> PollResponse:
    my_vote = next((vote for vote in poll.votes if vote.user_id == user_id), None)
    option_responses = []
    for option in poll.options:
        option_ratings = [rating.score for vote in poll.votes for rating in vote.ratings if rating.option_id == option.id]
        option_votes = sum(1 for vote in poll.votes for choice in vote.choices if choice.option_id == option.id)
        average = sum(option_ratings) / len(option_ratings) if option_ratings else None
        option_responses.append(
            PollOptionResponse(
                id=option.id,
                text=option.text,
                subtitle=option.subtitle,
                position=option.position,
                count=len(option_ratings) if poll.type == "rating" else option_votes,
                score=average,
            )
        )
    vote_count = len(poll.votes)
    return PollResponse(
        id=poll.id,
        owner_id=poll.owner_id,
        organizer=poll.owner.display_name,
        title=poll.title,
        description=poll.description,
        type=poll.type,
        visibility=poll.visibility,
        deadline=poll.deadline,
        closed=_is_closed(poll),
        created_at=poll.created_at,
        participant_count=vote_count,
        vote_count=vote_count,
        vote_change_allowed=bool(poll.allow_vote_change),
        options=option_responses,
        my_vote=(
            VoteResponse(
                ratings=[
                    RatingResponse(option_id=rating.option_id, score=rating.score)
                    for rating in my_vote.ratings
                ],
                option_ids=[choice.option_id for choice in my_vote.choices],
                updated_at=my_vote.created_at,
            )
            if my_vote
            else None
        ),
        invite_token=invite_token,
    )


def list_polls(db: Session, user: User) -> list[PollResponse]:
    return [_serialize_poll(poll, user.id) for poll in list_visible_polls(db, user)]


def can_access_poll(poll: Poll, user: User, invite_token: str | None) -> bool:
    if poll.visibility != "private" or poll.owner_id == user.id:
        return True
    if not invite_token:
        return False
    supplied_hash = hashlib.sha256(invite_token.encode("utf-8")).hexdigest()
    return secrets.compare_digest(poll.invite_token_hash, supplied_hash)


def get_poll(
    db: Session,
    user: User,
    poll_id: str,
    invite_token: str | None = None,
) -> PollResponse:
    poll = get_poll_by_id(db, poll_id)
    if poll is None or not can_access_poll(poll, user, invite_token):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Голосование не найдено.")
    return _serialize_poll(poll, user.id)


def create_poll(db: Session, user: User, data: PollCreate) -> PollResponse:
    invite_token = secrets.token_urlsafe(32)
    poll = Poll(
        owner_id=user.id,
        title=data.title,
        description=data.description,
        type=data.type,
        visibility=data.visibility,
        deadline=data.deadline,
        invite_token_hash=hashlib.sha256(invite_token.encode("utf-8")).hexdigest(),
        allow_vote_change=1,
        options=[
            PollOption(text=option.text, subtitle=option.subtitle, position=position)
            for position, option in enumerate(data.options)
        ],
    )
    add_poll(db, poll)
    db.commit()
    refreshed = get_poll_by_id(db, poll.id)
    return _serialize_poll(refreshed, user.id, invite_token if data.visibility == "private" else None)


def close_poll(db: Session, user: User, poll_id: str) -> PollResponse:
    poll = get_poll_by_id(db, poll_id)
    if poll is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Голосование не найдено.")
    if poll.owner_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Закрыть голосование может только его автор.")
    if not _is_closed(poll):
        set_poll_closed(db, poll, datetime.now(timezone.utc))
        db.commit()
    return _serialize_poll(get_poll_by_id(db, poll.id), user.id)


def create_poll_invitation(db: Session, user: User, poll_id: str) -> dict[str, str]:
    poll = get_poll_by_id(db, poll_id)
    if poll is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Голосование не найдено.")
    if poll.owner_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Создать приглашение может только организатор.")
    if poll.visibility != "private":
        raise HTTPException(status.HTTP_409_CONFLICT, "Для публичного голосования приглашение не требуется.")
    token = secrets.token_urlsafe(32)
    set_poll_invite_hash(db, poll, hashlib.sha256(token.encode("utf-8")).hexdigest())
    db.commit()
    return {"invite_token": token}


def cast_vote(
    db: Session,
    user: User,
    poll_id: str,
    data: VoteRequest,
    invite_token: str | None = None,
) -> PollResponse:
    poll = get_poll_by_id(db, poll_id)
    if poll is None or not can_access_poll(poll, user, invite_token):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Голосование не найдено.")
    if _is_closed(poll):
        raise HTTPException(status.HTTP_409_CONFLICT, "Голосование завершено.")
    existing_vote = next((vote for vote in poll.votes if vote.user_id == user.id), None)
    if existing_vote and not poll.allow_vote_change:
        raise HTTPException(status.HTTP_409_CONFLICT, "Изменение голоса для этого опроса отключено.")
    option_ids = {option.id for option in poll.options}
    if data.ratings and poll.type != "rating":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Это голосование не поддерживает оценки.")
    if data.option_ids and poll.type == "rating":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Для этого голосования нужны оценки от 1 до 10.")
    if data.ratings and any(rating.option_id not in option_ids for rating in data.ratings):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Вариант не принадлежит этому голосованию.")
    if data.option_ids and any(option_id not in option_ids for option_id in data.option_ids):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Вариант не принадлежит этому голосованию.")
    if poll.type == "single" and data.option_ids and len(data.option_ids) != 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "В этом голосовании можно выбрать только один вариант.")
    try:
        replace_vote(
            db,
            poll.id,
            user.id,
            [(rating.option_id, rating.score) for rating in data.ratings or []],
            data.option_ids or [],
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    updated = get_poll_by_id(db, poll.id)
    return _serialize_poll(updated, user.id)
