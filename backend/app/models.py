from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid4())


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("email", name="uq_users_email"),
        UniqueConstraint("username", name="uq_users_username"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    username: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(50), nullable=False)
    email: Mapped[str] = mapped_column(String(254), nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    google_sub: Mapped[str | None] = mapped_column(String(255), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    polls: Mapped[list["Poll"]] = relationship(back_populates="owner")
    votes: Mapped[list["Vote"]] = relationship(back_populates="user")
    sessions: Mapped[list["UserSession"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class UserSession(Base):
    __tablename__ = "sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    user: Mapped[User] = relationship(back_populates="sessions")


class Poll(Base):
    __tablename__ = "polls"
    __table_args__ = (
        CheckConstraint("type IN ('rating', 'single', 'multiple')", name="ck_polls_type"),
        CheckConstraint("visibility IN ('public', 'private')", name="ck_polls_visibility"),
        Index("ix_polls_visibility_created", "visibility", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    type: Mapped[str] = mapped_column(String(12), default="rating", nullable=False)
    visibility: Mapped[str] = mapped_column(String(12), default="public", nullable=False)
    invite_token_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    allow_vote_change: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    owner: Mapped[User] = relationship(back_populates="polls")
    options: Mapped[list["PollOption"]] = relationship(
        back_populates="poll",
        cascade="all, delete-orphan",
        order_by="PollOption.position",
        lazy="selectin",
    )
    votes: Mapped[list["Vote"]] = relationship(back_populates="poll", cascade="all, delete-orphan")


class PollOption(Base):
    __tablename__ = "poll_options"
    __table_args__ = (
        UniqueConstraint("poll_id", "position", name="uq_poll_options_position"),
        UniqueConstraint("poll_id", "text", name="uq_poll_options_text"),
        CheckConstraint("position >= 0", name="ck_poll_options_position"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    poll_id: Mapped[str] = mapped_column(ForeignKey("polls.id", ondelete="CASCADE"), nullable=False, index=True)
    text: Mapped[str] = mapped_column(String(100), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)

    poll: Mapped[Poll] = relationship(back_populates="options")
    ratings: Mapped[list["VoteScore"]] = relationship(back_populates="option", cascade="all, delete-orphan")


class Vote(Base):
    __tablename__ = "votes"
    __table_args__ = (UniqueConstraint("poll_id", "user_id", name="uq_votes_poll_user"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    poll_id: Mapped[str] = mapped_column(ForeignKey("polls.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    poll: Mapped[Poll] = relationship(back_populates="votes")
    user: Mapped[User] = relationship(back_populates="votes")
    ratings: Mapped[list["VoteScore"]] = relationship(back_populates="vote", cascade="all, delete-orphan", lazy="selectin")
    choices: Mapped[list["VoteChoice"]] = relationship(back_populates="vote", cascade="all, delete-orphan", lazy="selectin")


class VoteScore(Base):
    __tablename__ = "vote_scores"
    __table_args__ = (
        CheckConstraint("score >= 1 AND score <= 10", name="ck_vote_scores_range"),
    )

    vote_id: Mapped[str] = mapped_column(ForeignKey("votes.id", ondelete="CASCADE"), primary_key=True)
    option_id: Mapped[str] = mapped_column(ForeignKey("poll_options.id", ondelete="RESTRICT"), primary_key=True)
    score: Mapped[int] = mapped_column(Integer, nullable=False)

    vote: Mapped[Vote] = relationship(back_populates="ratings")
    option: Mapped[PollOption] = relationship(back_populates="ratings")


class VoteChoice(Base):
    __tablename__ = "vote_choices"

    vote_id: Mapped[str] = mapped_column(ForeignKey("votes.id", ondelete="CASCADE"), primary_key=True)
    option_id: Mapped[str] = mapped_column(ForeignKey("poll_options.id", ondelete="RESTRICT"), primary_key=True)

    vote: Mapped[Vote] = relationship(back_populates="choices")
