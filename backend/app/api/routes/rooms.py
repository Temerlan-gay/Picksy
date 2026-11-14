from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models import User
from app.schemas import DecisionBallotRequest, DecisionJoinRequest, DecisionRoomCreate, ProposalCreate, ProposalDecision
from app.services.rooms import (
    begin_voting, create_room, create_room_invitation, decide_proposal, get_room_view, join_room, list_rooms,
    propose_option, start_round, submit_ballot,
)

router = APIRouter(prefix="/api/rooms", tags=["decision rooms"])


@router.get("")
def get_rooms(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    return {"rooms": list_rooms(db, user)}


@router.post("", status_code=status.HTTP_201_CREATED)
def post_room(data: DecisionRoomCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    return {"room": create_room(db, user, data)}


@router.get("/{room_id}")
def get_room_detail(room_id: UUID, invite_token: str | None = Query(default=None), db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    return {"room": get_room_view(db, user, str(room_id), invite_token)}


@router.post("/{room_id}/join")
def post_join(room_id: UUID, data: DecisionJoinRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    return {"room": join_room(db, user, str(room_id), data.invite_token)}


@router.post("/{room_id}/invitation")
def post_invitation(room_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    return create_room_invitation(db, user, str(room_id))


@router.post("/{room_id}/proposals")
def post_proposal(room_id: UUID, data: ProposalCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    return {"room": propose_option(db, user, str(room_id), data)}


@router.patch("/{room_id}/proposals/{proposal_id}")
def patch_proposal(room_id: UUID, proposal_id: UUID, data: ProposalDecision, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    return {"room": decide_proposal(db, user, str(room_id), str(proposal_id), data.decision)}


@router.post("/{room_id}/rounds/start")
def post_start_round(room_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    return {"room": start_round(db, user, str(room_id))}


@router.post("/{room_id}/rounds/{round_id}/begin")
def post_begin_round(room_id: UUID, round_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    return {"room": begin_voting(db, user, str(room_id), str(round_id))}


@router.post("/{room_id}/rounds/{round_id}/votes")
def post_vote(room_id: UUID, round_id: UUID, data: DecisionBallotRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    return {"room": submit_ballot(db, user, str(room_id), str(round_id), data)}


@router.post("/{room_id}/rounds/new")
def post_new_round(room_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    return {"room": start_round(db, user, str(room_id))}
