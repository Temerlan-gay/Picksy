from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import Poll, User, Vote, VoteChoice, VoteScore


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
            .where((Poll.visibility == "public") | (Poll.owner_id == user.id))
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
