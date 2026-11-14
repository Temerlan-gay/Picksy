from app.services.auth import hash_password, password_matches


def register(client, username):
    response = client.post(
        "/api/auth/register",
        json={
            "display_name": username.title(),
            "username": username,
            "email": f"{username}@example.com",
            "password": "a-secure-test-password",
        },
    )
    assert response.status_code == 201
    return response.json()["user"]


def test_registration_session_and_poll_authorization(client):
    assert client.get("/api/auth/me").json() == {"user": None}
    owner = register(client, "pollowner")
    assert client.get("/api/auth/me").json()["user"]["id"] == owner["id"]

    created = client.post(
        "/api/polls",
        json={
            "title": "План на пятницу",
            "type": "rating",
            "visibility": "public",
            "options": ["Кофейня", "Боулинг", "Парк"],
        },
    )
    assert created.status_code == 201
    poll = created.json()
    assert len(poll["options"]) == 3
    assert poll["vote_count"] == 0
    assert client.get("/api/polls").json()["polls"][0]["id"] == poll["id"]

    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").json() == {"user": None}
    assert client.get("/api/polls").status_code == 401


def test_poll_place_subtitles_are_persisted(client):
    register(client, "placeowner")
    response = client.post(
        "/api/polls",
        json={
            "title": "Куда вернёмся?",
            "type": "rating",
            "options": [
                {"text": "Рамен-бар «Тёплый»", "subtitle": "Вокзальная · ₽₽"},
                {"text": "Боулинг «Страйк»", "subtitle": "Север · ₽₽₽"},
                {"text": "Кофейня «Сова»", "subtitle": "Центр · ₽₽"},
            ],
        },
    )

    assert response.status_code == 201
    assert [option["subtitle"] for option in response.json()["options"]] == [
        "Вокзальная · ₽₽",
        "Север · ₽₽₽",
        "Центр · ₽₽",
    ]


def test_google_sign_in_creates_a_session(client, monkeypatch):
    from app.services import auth as auth_service

    monkeypatch.setattr(auth_service, "GOOGLE_CLIENT_ID", "picksy-test-client")
    monkeypatch.setattr(
        auth_service.id_token,
        "verify_oauth2_token",
        lambda *_args, **_kwargs: {
            "sub": "google-user-123",
            "email": "googleuser@example.com",
            "email_verified": True,
            "name": "Google User",
        },
    )

    response = client.post("/api/auth/google", json={"credential": "mock.google.credential"})

    assert response.status_code == 200
    user = response.json()["user"]
    assert user["email"] == "googleuser@example.com"
    assert client.get("/api/auth/me").json()["user"]["id"] == user["id"]


def test_discussion_limits_each_participant_to_two_questions(client):
    register(client, "discussionowner")
    poll = client.post(
        "/api/polls",
        json={"title": "Куда пойдём?", "type": "rating", "options": ["Рамен", "Боулинг"]},
    ).json()
    poll_id = poll["id"]
    client.post("/api/auth/logout")
    register(client, "discussionguest")

    initial = client.get(f"/api/polls/{poll_id}/messages")
    assert initial.status_code == 200
    assert initial.json()["questions_remaining"] == 2
    assert initial.json()["is_leader"] is False

    for text in ("Есть парковка?", "До скольки работаете?"):
        sent = client.post(f"/api/polls/{poll_id}/messages", json={"body": text})
        assert sent.status_code == 201
        assert sent.json()["is_leader"] is False

    assert client.get(f"/api/polls/{poll_id}/messages").json()["questions_remaining"] == 0
    blocked = client.post(f"/api/polls/{poll_id}/messages", json={"body": "Можно ещё вопрос?"})
    assert blocked.status_code == 429
    assert blocked.json()["detail"] == "Вы использовали оба вопроса в этом голосовании."


def test_discussion_leader_is_unlimited_but_rate_limited(client, monkeypatch):
    from app.services import discussion as discussion_service

    register(client, "discussionlead")
    poll = client.post(
        "/api/polls",
        json={"title": "Куда пойдём?", "type": "rating", "options": ["Рамен", "Боулинг"]},
    ).json()
    poll_id = poll["id"]

    first = client.post(f"/api/polls/{poll_id}/messages", json={"body": "Команда, голосуем до 18:00."})
    second = client.post(f"/api/polls/{poll_id}/messages", json={"body": "Напоминаю про голосование."})

    assert first.status_code == 201
    assert first.json()["is_leader"] is True
    assert second.status_code == 429
    assert second.headers["retry-after"]

    monkeypatch.setattr(discussion_service, "LEADER_COOLDOWN_SECONDS", 0)
    for index in range(9):
        accepted = client.post(
            f"/api/polls/{poll_id}/messages",
            json={"body": f"Уточнение лидера номер {index + 1}"},
        )
        assert accepted.status_code == 201

    rate_limited = client.post(f"/api/polls/{poll_id}/messages", json={"body": "Ещё одно объявление."})
    assert rate_limited.status_code == 429
    assert rate_limited.json()["detail"] == "Лимит сообщений лидера — 10 в минуту."


def test_ratings_are_persisted_calculated_and_editable(client):
    register(client, "ratingowner")
    poll = client.post(
        "/api/polls",
        json={
            "title": "Куда пойдём?",
            "type": "rating",
            "options": ["Кафе", "Боулинг"],
        },
    ).json()
    poll_id = poll["id"]
    first_option, second_option = poll["options"]

    first_vote = client.post(
        f"/api/polls/{poll_id}/vote",
        json={
            "ratings": [
                {"option_id": first_option["id"], "score": 8},
                {"option_id": second_option["id"], "score": 6},
            ]
        },
    )
    assert first_vote.status_code == 200
    assert first_vote.json()["vote_count"] == 1
    assert first_vote.json()["options"][0]["score"] == 8
    assert {
        rating["option_id"]: rating["score"]
        for rating in first_vote.json()["my_vote"]["ratings"]
    }[first_option["id"]] == 8

    changed_vote = client.post(
        f"/api/polls/{poll_id}/vote",
        json={"ratings": [{"option_id": first_option["id"], "score": 10}]},
    )
    assert changed_vote.status_code == 200
    assert changed_vote.json()["vote_count"] == 1
    assert changed_vote.json()["options"][0]["score"] == 10
    assert changed_vote.json()["options"][1]["score"] is None
    assert len(changed_vote.json()["my_vote"]["ratings"]) == 1


def test_vote_validation_deadline_and_private_invite(client):
    register(client, "privacyowner")
    private = client.post(
        "/api/polls",
        json={
            "title": "Приватный план",
            "type": "rating",
            "visibility": "private",
            "options": ["Музей", "Кафе"],
        },
    )
    assert private.status_code == 201
    poll = private.json()
    invite = poll["invite_token"]

    client.post("/api/auth/logout")
    register(client, "privacyguest")
    assert client.get(f"/api/polls/{poll['id']}").status_code == 404
    assert client.get(f"/api/polls/{poll['id']}", headers={"x-poll-invite": invite}).status_code == 200

    invalid_score = client.post(
        f"/api/polls/{poll['id']}/vote",
        headers={"x-poll-invite": invite},
        json={"ratings": [{"option_id": poll["options"][0]["id"], "score": 11}]},
    )
    assert invalid_score.status_code == 422


def test_only_poll_owner_can_close_and_closed_poll_keeps_results(client):
    register(client, "closeowner")
    poll = client.post(
        "/api/polls",
        json={"title": "Close this poll", "type": "single", "options": ["A", "B"]},
    ).json()
    first_option = poll["options"][0]["id"]
    assert client.post(f"/api/polls/{poll['id']}/vote", json={"option_ids": [first_option]}).status_code == 200

    client.post("/api/auth/logout")
    register(client, "closeguest")
    forbidden = client.post(f"/api/polls/{poll['id']}/close")
    assert forbidden.status_code == 403

    client.post("/api/auth/login", json={"email": "closeowner@example.com", "password": "a-secure-test-password"})
    closed = client.post(f"/api/polls/{poll['id']}/close")
    assert closed.status_code == 200
    assert closed.json()["closed"] is True
    assert closed.json()["vote_count"] == 1
    assert closed.json()["options"][0]["count"] == 1
    after_close = client.post(f"/api/polls/{poll['id']}/vote", json={"option_ids": [poll["options"][1]["id"]]})
    assert after_close.status_code == 409


def test_legacy_scrypt_password_hashes_are_supported():
    password = "legacy-password"
    salt = b"picksy-legacy-salt"
    import hashlib

    legacy_hash = hashlib.scrypt(
        password.encode(),
        salt=salt,
        n=16_384,
        r=8,
        p=1,
        dklen=64,
        maxmem=64 * 1024 * 1024,
    )
    stored = f"{salt.hex()}:{legacy_hash.hex()}"
    assert password_matches(password, stored)
    assert not password_matches("wrong-password", stored)
    assert len(hash_password(password).split(":", 1)[1]) == 64
