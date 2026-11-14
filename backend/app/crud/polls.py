from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import Poll, PollDiscussionQuota, PollMessage, User, Vote, VoteChoice, VoteScore


def list_visible_polls(db: Session, user: User) -> list[Poll]:
    return list(
        db.scalars(
            select(Poll)
            .options(
                joinedload(Poll.owner),
                selectinload(Poll.options),
                selectinload(Poll.votes).selectinload(Vote.ratings),
                selectinload(Poll.votes).selectinload(Vote.choices),
            )
            .where((Poll.visibility == "public") | (Poll.owner_id == user.id) | Poll.votes.any(Vote.user_id == user.id))
            .order_by(Poll.created_at.desc())
            .limit(100)
            .execution_options(populate_existing=True)
        ).unique()
    )


def get_poll_by_id(db: Session, poll_id: str) -> Poll | None:
    return db.scalar(
        select(Poll)
        .options(
            joinedload(Poll.owner),
            selectinload(Poll.options),
            selectinload(Poll.votes).selectinload(Vote.ratings),
            selectinload(Poll.votes).selectinload(Vote.choices),
        )
        .execution_options(populate_existing=True)
        .where(Poll.id == poll_id)
    )


def add_poll(db: Session, poll: Poll) -> Poll:
    db.add(poll)
    db.flush()
    return poll


def set_poll_closed(db: Session, poll: Poll, closed_at: datetime) -> Poll:
    poll.closed_at = closed_at
    db.flush()
    return poll


def set_poll_invite_hash(db: Session, poll: Poll, invite_hash: str) -> Poll:
    poll.invite_token_hash = invite_hash
    db.flush()
    return poll


def list_poll_messages(db: Session, poll_id: str, limit: int = 50) -> list[PollMessage]:
    messages = list(db.scalars(
        select(PollMessage)
        .options(joinedload(PollMessage.author))
        .where(PollMessage.poll_id == poll_id)
        .order_by(PollMessage.created_at.desc(), PollMessage.id.desc())
        .limit(limit)
    ))
    return list(reversed(messages))


def count_poll_user_messages(db: Session, poll_id: str, user_id: str) -> int:
    from sqlalchemy import func

    return db.scalar(
        select(func.count(PollMessage.id)).where(
            PollMessage.poll_id == poll_id,
            PollMessage.user_id == user_id,
        )
    ) or 0


def list_recent_poll_user_messages(
    db: Session,
    poll_id: str,
    user_id: str,
    since: datetime,
) -> list[PollMessage]:
    return list(db.scalars(
        select(PollMessage)
        .where(
            PollMessage.poll_id == poll_id,
            PollMessage.user_id == user_id,
            PollMessage.created_at >= since,
        )
        .order_by(PollMessage.created_at.desc())
    ))


def add_poll_message(db: Session, message: PollMessage) -> PollMessage:
    db.add(message)
    db.flush()
    return message


def lock_discussion_quota(db: Session, poll_id: str, user_id: str) -> PollDiscussionQuota:
    statement = select(PollDiscussionQuota).where(
        PollDiscussionQuota.poll_id == poll_id,
        PollDiscussionQuota.user_id == user_id,
    ).with_for_update()
    quota = db.scalar(statement)
    if quota is not None:
        return quota

    try:
        with db.begin_nested():
            quota = PollDiscussionQuota(poll_id=poll_id, user_id=user_id)
            db.add(quota)
            db.flush()
    except IntegrityError:
        quota = db.scalar(statement)
        if quota is None:
            raise
    return quota


def get_vote(db: Session, poll_id: str, user_id: str) -> Vote | None:
    return db.scalar(
        select(Vote)
        .options(selectinload(Vote.ratings), selectinload(Vote.choices))
        .where(Vote.poll_id == poll_id, Vote.user_id == user_id)
    )


def replace_vote(
    db: Session,
    poll_id: str,
    user_id: str,
    scores: list[tuple[str, int]],
    option_ids: list[str],
) -> Vote:
    vote = get_vote(db, poll_id, user_id)
    if vote is None:
        vote = Vote(poll_id=poll_id, user_id=user_id)
        db.add(vote)
        db.flush()
    else:
        vote.ratings.clear()
        vote.choices.clear()
        vote.created_at = datetime.now(timezone.utc)
        db.flush()
    vote.ratings.extend(VoteScore(option_id=option_id, score=score) for option_id, score in scores)
    vote.choices.extend(VoteChoice(option_id=option_id) for option_id in option_ids)
    db.flush()
    return vote
