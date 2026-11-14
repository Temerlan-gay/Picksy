import hashlib
import json
import secrets
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.crud.rooms import (
    add_ballot, add_proposal, add_room, add_room_member, add_round, begin_round, commit_ballot,
    finish_round, get_room, get_round, list_rooms_for_user, rotate_room_invitation,
    set_proposal_status,
)
from app.models import (
    DecisionBallot, DecisionProposal, DecisionRoom, DecisionRoomMember,
    DecisionRound, DecisionRoundOption, DecisionRoundParticipant, User,
)
from app.schemas import DecisionBallotRequest, DecisionRoomCreate, ProposalCreate


def _fail(code: int, message: str) -> None:
    raise HTTPException(code, message)


def _member(room: DecisionRoom, user_id: str) -> DecisionRoomMember | None:
    return next((member for member in room.members if member.user_id == user_id), None)


def _authorized(room: DecisionRoom, user_id: str, invite_token: str | None = None) -> bool:
    if _member(room, user_id):
        return True
    if not invite_token:
        return False
    supplied = hashlib.sha256(invite_token.encode()).hexdigest()
    return secrets.compare_digest(room.invite_token_hash, supplied)


def _result(round_: DecisionRound) -> dict | None:
    return json.loads(round_.result_json) if round_.result_json else None


def _serialize_round(round_: DecisionRound, user_id: str) -> dict:
    ballot_by_user = {ballot.user_id: ballot for ballot in round_.ballots}
    completed = round_.status == "result"
    options = [{"id": option.id, "text": option.text, "position": option.position} for option in round_.options]
    ballots = []
    if completed or not round_.hide_results:
        for ballot in round_.ballots:
            ballots.append({"user_id": ballot.user_id, "answer": json.loads(ballot.answer_json), "submitted_at": ballot.submitted_at})
    own = ballot_by_user.get(user_id)
    return {
        "id": round_.id, "number": round_.number, "status": round_.status,
        "method": round_.method, "hide_results": bool(round_.hide_results),
        "started_at": round_.started_at, "completed_at": round_.completed_at,
        "participants": [{"user_id": p.user_id, "display_name": p.display_name, "is_owner": bool(p.is_owner), "voted": p.user_id in ballot_by_user} for p in round_.participants],
        "options": options, "voted_count": len(round_.ballots), "participant_count": len(round_.participants),
        "votes": ballots, "my_vote": json.loads(own.answer_json) if own else None,
        "result": _result(round_) if completed else None,
    }


def _serialize_room(room: DecisionRoom, user: User, invite_token: str | None = None) -> dict:
    last_round = room.rounds[-1] if room.rounds else None
    status_value = "gathering" if last_round is None else last_round.status
    return {
        "id": room.id, "owner_id": room.owner_id, "owner_name": next((m.user.display_name for m in room.members if m.user_id == room.owner_id), "Организатор"),
        "question": room.question, "method": room.method, "hide_results": bool(room.hide_results),
        "deadline": room.deadline, "created_at": room.created_at, "status": status_value,
        "is_member": _member(room, user.id) is not None, "is_owner": room.owner_id == user.id,
        "invite_token": invite_token,
        "members": [{"user_id": m.user_id, "display_name": m.user.display_name, "is_owner": m.user_id == room.owner_id} for m in room.members],
        "proposals": [{"id": p.id, "text": p.text, "status": p.status, "author": p.author.display_name, "user_id": p.user_id} for p in room.proposals],
        "rounds": [_serialize_round(round_, user.id) for round_ in room.rounds],
        "active_round": _serialize_round(last_round, user.id) if last_round and last_round.status == "voting" else None,
    }


def create_room(db: Session, user: User, data: DecisionRoomCreate) -> dict:
    token = secrets.token_urlsafe(32)
    room = DecisionRoom(owner_id=user.id, question=data.question, method=data.method,
                        hide_results=int(data.hide_results), deadline=data.deadline,
                        invite_token_hash=hashlib.sha256(token.encode()).hexdigest())
    add_room(db, room, user)
    room = get_room(db, room.id)
    return _serialize_room(room, user, token)


def list_rooms(db: Session, user: User) -> list[dict]:
    return [_serialize_room(room, user) for room in list_rooms_for_user(db, user.id)]


def create_room_invitation(db: Session, user: User, room_id: str) -> dict:
    room = get_room(db, room_id)
    if room is None or room.owner_id != user.id:
        _fail(status.HTTP_403_FORBIDDEN, "Создать ссылку может только организатор.")
    if room.rounds:
        _fail(status.HTTP_409_CONFLICT, "Состав раунда уже зафиксирован.")
    token = secrets.token_urlsafe(32)
    rotate_room_invitation(db, room, hashlib.sha256(token.encode()).hexdigest())
    return {"invite_token": token}


def get_room_view(db: Session, user: User, room_id: str, invite_token: str | None = None) -> dict:
    room = get_room(db, room_id)
    if room is None or not _authorized(room, user.id, invite_token):
        _fail(status.HTTP_404_NOT_FOUND, "Комната не найдена.")
    return _serialize_room(room, user)


def join_room(db: Session, user: User, room_id: str, invite_token: str) -> dict:
    room = get_room(db, room_id, lock=True)
    if room is None or not _authorized(room, user.id, invite_token):
        _fail(status.HTTP_404_NOT_FOUND, "Комната не найдена или ссылка приглашения неверна.")
    if room.rounds:
        _fail(status.HTTP_409_CONFLICT, "Раунд уже начат. Присоединиться можно до фиксации состава участников.")
    if not _member(room, user.id):
        add_room_member(db, room.id, user.id)
    return _serialize_room(get_room(db, room.id), user)


def propose_option(db: Session, user: User, room_id: str, data: ProposalCreate) -> dict:
    room = get_room(db, room_id, lock=True)
    if room is None or not _member(room, user.id):
        _fail(status.HTTP_404_NOT_FOUND, "Комната не найдена.")
    if room.rounds:
        _fail(status.HTTP_409_CONFLICT, "После начала раунда список вариантов зафиксирован.")
    if len(room.proposals) >= 100:
        _fail(status.HTTP_409_CONFLICT, "Достигнут лимит вариантов в комнате.")
    proposal = DecisionProposal(room_id=room.id, user_id=user.id, text=data.text,
                                normalized_text=data.text.casefold())
    try:
        add_proposal(db, proposal)
    except IntegrityError:
        db.rollback()
        _fail(status.HTTP_409_CONFLICT, "Такой вариант уже предложен.")
    return _serialize_room(get_room(db, room.id), user)


def decide_proposal(db: Session, user: User, room_id: str, proposal_id: str, decision: str) -> dict:
    room = get_room(db, room_id, lock=True)
    if room is None or room.owner_id != user.id:
        _fail(status.HTTP_403_FORBIDDEN, "Только организатор может принять или отклонить вариант.")
    if room.rounds:
        _fail(status.HTTP_409_CONFLICT, "Список вариантов уже зафиксирован.")
    proposal = next((item for item in room.proposals if item.id == proposal_id), None)
    if proposal is None:
        _fail(status.HTTP_404_NOT_FOUND, "Предложение не найдено.")
    set_proposal_status(db, proposal, decision)
    return _serialize_room(get_room(db, room.id), user)


def start_round(db: Session, user: User, room_id: str) -> dict:
    room = get_room(db, room_id, lock=True)
    if room is None or room.owner_id != user.id:
        _fail(status.HTTP_403_FORBIDDEN, "Запустить голосование может только организатор.")
    if room.rounds and room.rounds[-1].status != "result":
        _fail(status.HTTP_409_CONFLICT, "Текущий раунд ещё не завершён.")
    if len(room.members) < 2:
        _fail(status.HTTP_409_CONFLICT, "Для запуска нужен хотя бы один участник помимо организатора.")
    accepted = [proposal for proposal in room.proposals if proposal.status == "accepted"]
    if not accepted:
        _fail(status.HTTP_409_CONFLICT, "Примите хотя бы один предложенный вариант.")
    round_ = DecisionRound(room_id=room.id, number=len(room.rounds) + 1, method=room.method,
                           hide_results=room.hide_results, status="preparation")
    round_.participants = [DecisionRoundParticipant(user_id=m.user_id, display_name=m.user.display_name,
                                                     is_owner=int(m.user_id == room.owner_id)) for m in room.members]
    round_.options = [DecisionRoundOption(proposal_id=p.id, text=p.text, position=i) for i, p in enumerate(accepted)]
    add_round(db, round_)
    return _serialize_room(get_room(db, room.id), user)


def begin_voting(db: Session, user: User, room_id: str, round_id: str) -> dict:
    room = get_room(db, room_id, lock=True)
    round_ = get_round(db, room_id, round_id, lock=True)
    if room is None or room.owner_id != user.id:
        _fail(status.HTTP_403_FORBIDDEN, "Начать голосование может только организатор.")
    if round_ is None or round_.status != "preparation":
        _fail(status.HTTP_409_CONFLICT, "Раунд не находится на этапе подготовки.")
    begin_round(db, round_)
    return _serialize_room(get_room(db, room.id), user)


def submit_ballot(db: Session, user: User, room_id: str, round_id: str, data: DecisionBallotRequest) -> dict:
    room = get_room(db, room_id)
    round_ = get_round(db, room_id, round_id, lock=True)
    if room is None or round_ is None:
        _fail(status.HTTP_404_NOT_FOUND, "Раунд не найден.")
    if round_.status != "voting":
        _fail(status.HTTP_409_CONFLICT, "Голосование уже завершено.")
    if not any(participant.user_id == user.id for participant in round_.participants):
        _fail(status.HTTP_403_FORBIDDEN, "Вы не входите в зафиксированный состав этого раунда.")
    valid_ids = {option.id for option in round_.options}
    if round_.method in ("majority", "unanimity"):
        if data.option_id not in valid_ids or data.evaluations is not None:
            _fail(status.HTTP_400_BAD_REQUEST, "Выберите ровно один вариант из списка раунда.")
        answer = {"option_id": data.option_id}
    else:
        if data.option_id is not None or data.evaluations is None:
            _fail(status.HTTP_400_BAD_REQUEST, "Оцените каждый вариант: подходит или есть возражение.")
        evaluations = data.evaluations
        ids = [item.option_id for item in evaluations]
        if len(ids) != len(valid_ids) or set(ids) != valid_ids or len(ids) != len(set(ids)):
            _fail(status.HTTP_400_BAD_REQUEST, "Нужно оценить каждый вариант ровно один раз.")
        answer = {"evaluations": [{"option_id": item.option_id, "objection": item.objection} for item in evaluations]}
    ballot = DecisionBallot(round_id=round_.id, user_id=user.id, answer_json=json.dumps(answer))
    try:
        add_ballot(db, ballot)
    except IntegrityError:
        db.rollback()
        _fail(status.HTTP_409_CONFLICT, "Вы уже отправили голос в этом раунде.")
    round_.ballots.append(ballot)
    participant_count = len(round_.participants)
    ballot_by_user = {b.user_id: b for b in round_.ballots}
    if len(ballot_by_user) == participant_count:
        result = _calculate_result(round_)
        finish_round(db, round_, json.dumps(result, ensure_ascii=False), datetime.now(timezone.utc))
    else:
        commit_ballot(db)
    return _serialize_room(get_room(db, room.id), user)


def _calculate_result(round_: DecisionRound) -> dict:
    ballots = [{"user_id": b.user_id, **json.loads(b.answer_json)} for b in round_.ballots]
    options = [{"id": o.id, "text": o.text, "votes": 0, "objections": 0} for o in round_.options]
    by_id = {option["id"]: option for option in options}
    method = round_.method
    if method in ("majority", "unanimity"):
        for ballot in ballots:
            by_id[ballot["option_id"]]["votes"] += 1
        if method == "majority":
            maximum = max((o["votes"] for o in options), default=0)
            leaders = [o["id"] for o in options if o["votes"] == maximum and maximum > 0]
            kind = "winner" if len(leaders) == 1 else "tie" if leaders else "no_consensus"
            explanation = "Победил вариант с наибольшим числом голосов." if kind == "winner" else "У нескольких вариантов одинаковое число голосов — это ничья." if kind == "tie" else "Голоса не поданы."
        else:
            choices = {ballot["option_id"] for ballot in ballots}
            leaders = [next(iter(choices))] if len(choices) == 1 else []
            kind = "winner" if leaders else "no_consensus"
            explanation = "Все участники выбрали один и тот же вариант." if leaders else "Участники выбрали разные варианты, единогласия нет."
    else:
        for ballot in ballots:
            for evaluation in ballot["evaluations"]:
                if evaluation["objection"]:
                    by_id[evaluation["option_id"]]["objections"] += 1
        leaders = [o["id"] for o in options if o["objections"] == 0]
        kind = "acceptable" if leaders else "no_consensus"
        explanation = "Есть варианты, против которых никто не возразил." if leaders else "Против каждого варианта есть хотя бы одно возражение."
    return {"kind": kind, "winner_ids": leaders, "options": options,
            "voted_count": len(ballots), "participant_count": len(round_.participants),
            "explanation": explanation}
