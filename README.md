# Decido

Decido is a small social decision app. This first full stack scenario supports account registration and login, creating a poll, inviting people to a public poll link, collecting ratings or choices, viewing aggregate results, and closing a poll.

## Project structure

```text
backend/
  app/
    api/                 FastAPI routes and request dependencies
    core/                Settings and SQLAlchemy engine/session
    crud/                Database reads and writes
    services/            Business rules and use cases
    models.py            SQLAlchemy ORM models
    schemas.py           Pydantic request/response validation
  tests/                 FastAPI integration tests
frontend/
  src/
    app/                 React app shell and routes
    features/            Auth, polls, and idea-selection modules
    shared/api/           Fetch client
    styles/               Responsive styles
```

The browser sends requests to `/api`. Vite proxies API requests to FastAPI in development. Password hashing, sessions, poll permissions, validation, vote persistence, result calculation, and poll closing are handled by the backend. SQLAlchemy creates the schema on startup. The default database is `data/decido.sqlite`; it is separate from the legacy Picksy database.

## Requirements

- Node.js 20 or newer and npm.
- Python 3.12 or newer.

## Install

Install the frontend workspace and root development tools:

```sh
npm install
```

Create a Python environment and install backend dependencies from the project root.

Windows PowerShell:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements-dev.txt
```

macOS/Linux:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements-dev.txt
```

Optionally copy `.env.example` to `.env` and adjust the backend settings. The default configuration works locally without a `.env` file.

## Run

With the Python environment activated, from the project root:

```sh
npm run dev
```

Open <http://127.0.0.1:5173>. This starts Vite and FastAPI together. To run either process separately, use two terminals with the virtual environment activated:

```sh
npm run dev:web
npm run dev:api
```

The API is available at <http://127.0.0.1:8000>; interactive API docs are at <http://127.0.0.1:8000/docs>.

## First end-to-end flow

1. Create an account in the browser. FastAPI validates the input, hashes the password, stores the account, and sets an HTTP-only session cookie.
2. Create a poll with a question, two or more options, a voting type, and an optional deadline.
3. Share the poll URL with participants. Participants sign in, open the poll, and submit a choice or ratings from 1 to 10.
4. FastAPI validates and stores each ballot in SQL tables. The React app reloads the poll and displays counts and rating averages from the API response.
5. The owner can close the poll. The backend rejects further ballots and the UI shows the winner, a tie, or that nobody voted.

The three supported types are single choice, multiple choice, and 1–10 ratings. Each account can submit one ballot per poll; existing ballots can be updated until the poll closes. Public polls are visible to signed-in users. Private invite support exists in the API but is not exposed by the current UI.

## Configuration

Environment variables are read by FastAPI:

- `DATABASE_URL` — SQLAlchemy URL; defaults to `sqlite:///data/decido.sqlite`.
- `SESSION_TTL_DAYS` — session lifetime (14 by default).
- `COOKIE_SECURE` — set to `true` when serving over HTTPS.
- `CORS_ORIGINS` — comma-separated browser origins when frontend and API use separate hosts.
- `VITE_API_URL` — optional API origin for the built frontend; keep empty when Nginx proxies `/api/` on the same origin.

## Verify

With the virtual environment activated:

```sh
npm test
npm run build
```

`npm test` runs the legacy Node regression tests and FastAPI integration tests. The frontend build is written to `frontend/dist`.

## VM deployment direction

Build the frontend with `npm run build`, serve `frontend/dist` from Nginx, and proxy `/api/` to the Uvicorn service. Set `COOKIE_SECURE=true` behind HTTPS and use a persistent SQL database volume. Keep runtime secrets on the server; do not put them in Vite variables.
