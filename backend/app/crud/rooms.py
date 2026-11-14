from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import DecisionBallot, DecisionProposal, DecisionRoom, DecisionRoomMember, DecisionRound, RoomGuestSession, User


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


def add_guest_member(db: Session, user: User, room_id: str, guest_session: RoomGuestSession) -> None:
    db.add(user)
    db.flush()
    guest_session.user_id = user.id
    db.add(DecisionRoomMember(room_id=room_id, user_id=user.id))
    db.add(guest_session)
    db.commit()


def get_guest_user(db: Session, token_hash: str) -> User | None:
    session = db.scalar(select(RoomGuestSession).where(RoomGuestSession.token_hash == token_hash))
    if session is None:
        return None
    expires_at = session.expires_at if session.expires_at.tzinfo else session.expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        return None
    return session.user


def find_room_by_code(db: Session, code: str) -> DecisionRoom | None:
    return db.scalar(select(DecisionRoom.id).where(DecisionRoom.join_code == code))


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
