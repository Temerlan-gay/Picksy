from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import DecisionBallot, DecisionProposal, DecisionRoom, DecisionRoomMember, DecisionRound, User


def add_room(db: Session, room: DecisionRoom, owner: User) -> DecisionRoom:
    db.add(room)
    db.flush()
    db.add(DecisionRoomMember(room_id=room.id, user_id=owner.id))
    db.commit()
    return room


def add_proposal(db: Session, proposal: DecisionProposal) -> DecisionProposal:
    db.add(proposal)
    db.commit()
    return proposal


def set_proposal_status(db: Session, proposal: DecisionProposal, decision: str) -> DecisionProposal:
    proposal.status = decision
    db.commit()
    return proposal


def add_round(db: Session, round_: DecisionRound) -> DecisionRound:
    db.add(round_)
    db.commit()
    return round_


def begin_round(db: Session, round_: DecisionRound) -> None:
    round_.status = "voting"
    db.commit()


def add_ballot(db: Session, ballot: DecisionBallot) -> None:
    db.add(ballot)
    db.flush()


def commit_ballot(db: Session) -> None:
    db.commit()


def finish_round(db: Session, round_: DecisionRound, result_json: str, completed_at) -> None:
    round_.result_json = result_json
    round_.status = "result"
    round_.completed_at = completed_at
    db.commit()


def rotate_room_invitation(db: Session, room: DecisionRoom, token_hash: str) -> None:
    room.invite_token_hash = token_hash
    db.commit()


def add_room_member(db: Session, room_id: str, user_id: str) -> None:
    db.add(DecisionRoomMember(room_id=room_id, user_id=user_id))
    db.commit()


def get_room(db: Session, room_id: str, lock: bool = False) -> DecisionRoom | None:
    statement = (
        select(DecisionRoom)
        .options(
            selectinload(DecisionRoom.members).joinedload(DecisionRoomMember.user),
            selectinload(DecisionRoom.proposals),
            selectinload(DecisionRoom.rounds).selectinload(DecisionRound.participants),
            selectinload(DecisionRoom.rounds).selectinload(DecisionRound.options),
            selectinload(DecisionRoom.rounds).selectinload(DecisionRound.ballots),
        )
        .where(DecisionRoom.id == room_id)
    )
    if lock:
        statement = statement.with_for_update()
    return db.scalar(statement.execution_options(populate_existing=True))


def list_rooms_for_user(db: Session, user_id: str) -> list[DecisionRoom]:
    return list(db.scalars(
        select(DecisionRoom)
        .join(DecisionRoom.members)
        .where(DecisionRoomMember.user_id == user_id)
        .options(selectinload(DecisionRoom.members), selectinload(DecisionRoom.proposals), selectinload(DecisionRoom.rounds))
        .order_by(DecisionRoom.created_at.desc())
    ).unique())


def get_round(db: Session, room_id: str, round_id: str, lock: bool = False) -> DecisionRound | None:
    statement = (
        select(DecisionRound)
        .options(selectinload(DecisionRound.participants), selectinload(DecisionRound.options), selectinload(DecisionRound.ballots))
        .where(DecisionRound.room_id == room_id, DecisionRound.id == round_id)
    )
    if lock:
        statement = statement.with_for_update()
    return db.scalar(statement.execution_options(populate_existing=True))
