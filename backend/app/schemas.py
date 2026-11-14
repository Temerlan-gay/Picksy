from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    username: str
    display_name: str
    email: EmailStr


class AuthResponse(BaseModel):
    user: UserResponse | None


class RegisterRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=50)
    username: str | None = Field(default=None, min_length=3, max_length=24, pattern=r"^[A-Za-z0-9_]+$")
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class GoogleCredentialRequest(BaseModel):
    credential: str = Field(min_length=20, max_length=4096)


class OptionCreate(BaseModel):
    text: str = Field(min_length=1, max_length=100)
    subtitle: str = Field(default="", max_length=160)

    @model_validator(mode="before")
    @classmethod
    def accept_text_value(cls, value: object) -> object:
        if isinstance(value, str):
            return {"text": value}
        return value

    @model_validator(mode="after")
    def trim_text(self) -> "OptionCreate":
        self.text = self.text.strip()
        self.subtitle = self.subtitle.strip()
        if not self.text:
            raise ValueError("Вариант не может быть пустым.")
        return self


class PollCreate(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=1000)
    type: Literal["rating", "single", "multiple"] = "rating"
    visibility: Literal["public", "private"] = "public"
    options: list[OptionCreate] = Field(min_length=2, max_length=10)
    deadline: datetime | None = None

    @model_validator(mode="after")
    def validate_poll(self) -> "PollCreate":
        self.title = self.title.strip()
        self.description = self.description.strip()
        if not self.title:
            raise ValueError("Добавьте вопрос для голосования.")
        option_texts = [option.text.casefold() for option in self.options]
        if len(set(option_texts)) != len(option_texts):
            raise ValueError("Варианты должны отличаться друг от друга.")
        if self.deadline and _as_utc(self.deadline) <= datetime.now(timezone.utc):
            raise ValueError("Срок завершения должен быть в будущем.")
        return self


class RatingInput(BaseModel):
    option_id: str
    score: int = Field(ge=1, le=10)


class VoteRequest(BaseModel):
    ratings: list[RatingInput] | None = Field(default=None, max_length=10)
    option_ids: list[str] | None = Field(default=None, max_length=10)

    @model_validator(mode="after")
    def validate_vote_shape(self) -> "VoteRequest":
        if bool(self.ratings) == bool(self.option_ids):
            raise ValueError("Отправьте оценки или выбранные варианты.")
        if self.ratings:
            ids = [item.option_id for item in self.ratings]
            if len(set(ids)) != len(ids):
                raise ValueError("Каждый вариант можно оценить только один раз.")
        if self.option_ids and len(set(self.option_ids)) != len(self.option_ids):
            raise ValueError("Выбранные варианты не должны повторяться.")
        return self


class PollMessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def trim_body(self) -> "PollMessageCreate":
        self.body = self.body.strip()
        if not self.body:
            raise ValueError("Напишите вопрос перед отправкой.")
        return self


class PollMessageResponse(BaseModel):
    id: str
    user_id: str
    display_name: str
    body: str
    created_at: datetime
    is_leader: bool


class PollDiscussionResponse(BaseModel):
    messages: list[PollMessageResponse]
    is_leader: bool
    questions_remaining: int | None
    question_limit: int


class RatingResponse(BaseModel):
    option_id: str
    score: int


class VoteResponse(BaseModel):
    ratings: list[RatingResponse]
    option_ids: list[str] = Field(default_factory=list)
    updated_at: datetime


class PollOptionResponse(BaseModel):
    id: str
    text: str
    subtitle: str = ""
    position: int
    count: int
    score: float | None


class PollResponse(BaseModel):
    id: str
    owner_id: str
    organizer: str
    title: str
    description: str
    type: str
    visibility: str
    deadline: datetime | None
    closed: bool
    created_at: datetime
    participant_count: int
    vote_count: int
    vote_change_allowed: bool
    options: list[PollOptionResponse]
    my_vote: VoteResponse | None
    invite_token: str | None = None


class PollListResponse(BaseModel):
    polls: list[PollResponse]


class DecisionRoomCreate(BaseModel):
    question: str = Field(min_length=1, max_length=200)
    method: Literal["majority", "unanimity", "no_objections"]
    visibility: Literal["public", "private"] = "private"
    hide_results: bool = False
    deadline: datetime | None = None

    @model_validator(mode="after")
    def clean_question(self) -> "DecisionRoomCreate":
        self.question = self.question.strip()
        if not self.question:
            raise ValueError("Добавьте вопрос для комнаты.")
        if self.deadline and _as_utc(self.deadline) <= datetime.now(timezone.utc):
            raise ValueError("Срок голосования должен быть в будущем.")
        return self


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


class DecisionJoinRequest(BaseModel):
    invite_token: str = Field(min_length=20, max_length=200)


class RoomGuestEnterRequest(BaseModel):
    code: str = Field(min_length=8, max_length=8, pattern=r"^[A-HJ-NP-Z2-9]{8}$")
    display_name: str = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def clean_guest(self) -> "RoomGuestEnterRequest":
        self.code = self.code.strip().upper()
        self.display_name = self.display_name.strip()
        if not self.display_name:
            raise ValueError("Укажите имя для комнаты.")
        return self


class ProposalCreate(BaseModel):
    text: str = Field(min_length=1, max_length=160)

    @model_validator(mode="after")
    def clean_text(self) -> "ProposalCreate":
        self.text = self.text.strip()
        if not self.text:
            raise ValueError("Название варианта не может быть пустым.")
        return self


class ProposalDecision(BaseModel):
    decision: Literal["accepted", "rejected"]


class BallotEvaluation(BaseModel):
    option_id: str
    objection: bool


class DecisionBallotRequest(BaseModel):
    option_id: str | None = None
    evaluations: list[BallotEvaluation] | None = Field(default=None, max_length=100)


class DecisionVoteRequest(BaseModel):
    ballot: DecisionBallotRequest
