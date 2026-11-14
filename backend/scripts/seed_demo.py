from datetime import datetime, timedelta, timezone
from pathlib import Path
import os
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.database import SessionLocal, create_database_schema  # noqa: E402
from app.crud.auth import get_user_by_email  # noqa: E402
from app.models import Poll, PollOption, User  # noqa: E402
from app.services.auth import hash_password  # noqa: E402


DEMO_EMAIL = "demo@picksy.local"
DEMO_PASSWORD = "picksy-demo-only"
DEMO_POLL_TITLE = "Куда вернёмся в следующий раз?"


def main() -> None:
    if os.getenv("VERCEL") or os.getenv("APP_ENV") == "production" or os.getenv("ALLOW_DEMO_SEED") != "true":
        raise SystemExit("Set ALLOW_DEMO_SEED=true in a non-production environment to load demo data.")

    create_database_schema()
    with SessionLocal() as db:
        user = get_user_by_email(db, DEMO_EMAIL)
        if user is None:
            user = User(
                username="picksy_demo",
                display_name="Демо-команда",
                email=DEMO_EMAIL,
                password_hash=hash_password(DEMO_PASSWORD),
            )
            db.add(user)
            db.flush()

        has_demo_poll = db.query(Poll.id).filter(
            Poll.owner_id == user.id,
            Poll.title == DEMO_POLL_TITLE,
            Poll.closed_at.is_(None),
        ).first()
        if has_demo_poll is None:
            db.add(Poll(
                owner_id=user.id,
                title=DEMO_POLL_TITLE,
                description="Три места из недавних встреч — оцените каждое и выберите, куда пойти снова.",
                type="rating",
                visibility="public",
                invite_token_hash="",
                allow_vote_change=1,
                deadline=datetime.now(timezone.utc) + timedelta(days=1),
                options=[
                    PollOption(text="Рамен-бар «Тёплый»", subtitle="Вокзальная · ₽₽", position=0),
                    PollOption(text="Боулинг «Страйк»", subtitle="Север · ₽₽₽", position=1),
                    PollOption(text="Кофейня «Сова»", subtitle="Центр · ₽₽", position=2),
                ],
            ))
        db.commit()

    print(f"Demo account: {DEMO_EMAIL} / {DEMO_PASSWORD}")
    print("The seeded active poll contains three recent-place options.")


if __name__ == "__main__":
    main()
