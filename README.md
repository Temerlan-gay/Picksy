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

See [ARCHITECTURE.md](ARCHITECTURE.md) for the service diagram, release and rollback steps, migration notes, and diagnostics endpoints. GitHub Actions runs backend integration tests, Node regression tests, and the frontend production build on pushes and pull requests.

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

To load a local walkthrough account and an active rating poll with three places from the reference design, run `ALLOW_DEMO_SEED=true python backend/scripts/seed_demo.py` (PowerShell: `$env:ALLOW_DEMO_SEED='true'; python backend/scripts/seed_demo.py`). Sign in with `demo@picksy.local` / `picksy-demo-only`. The seed script refuses to run in Vercel or when `APP_ENV=production` is set.

## Run

With the Python environment activated, from the project root:

```sh
npm start
```

Open <http://127.0.0.1:5173>. This starts Vite and FastAPI together. The equivalent command is `npm run dev`. To run either process separately, use two terminals with the virtual environment activated:

```sh
npm run dev:web
npm run dev:api
```

The API is available at <http://127.0.0.1:8000>; interactive API docs are at <http://127.0.0.1:8000/api/docs>.

## First end-to-end flow

1. Create an account in the browser. FastAPI validates the input, hashes the password, stores the account, and sets an HTTP-only session cookie. Google sign-in is also available when the OAuth client is configured.
2. Create a poll with a question, two or more options, a voting type, and an optional deadline.
3. Share the poll URL with participants. Participants sign in, open the poll, and submit a choice or ratings from 1 to 10.
4. FastAPI validates and stores each ballot in SQL tables. The React app reloads the poll and displays counts and rating averages from the API response.
5. The owner can close the poll. The backend rejects further ballots and the UI shows the winner, a tie, or that nobody voted.

Participants can discuss the choices in the active poll card. Each non-owner can post two messages per poll; the poll owner can answer without that cap, with server-side rate limits to prevent spam. The discussion remains in PostgreSQL and refreshes in the browser every ten seconds.

The three supported types are single choice, multiple choice, and 1–10 ratings. Each account can submit one ballot per poll; existing ballots can be updated until the poll closes. Public polls are visible to signed-in users.

The poll creation form now lets the organizer choose public or private access. A private poll can be shared as an invitation link or QR code; invitees sign in before voting.

## Group decision rooms

Open **Комнаты** to create a VETO decision room. The organizer sets a question, access mode, and majority, unanimity, or no-objections method. Every room gets an eight-character entry code and a QR code. Participants scan it or open the invitation, enter a display name, and join without creating an account. They can then suggest options; the organizer accepts or rejects them. A round can start once there is at least one other participant and one accepted option. The server snapshots the roster and choices before voting begins.

Each person in the snapshot, including the organizer, can submit one complete ballot. Results are saved when the last participant votes. Hidden-result rounds reveal progress and voter status while ballots are still pending, then show the result distribution. Previous rounds stay in the room history, and the organizer can prepare another round with the same accepted options and room members.

The room deadline is saved as a setting and shown in the room. The server does not automatically close a round when that deadline passes; rounds currently finish after all snapshotted participants submit a ballot.

## Configuration

Environment variables are read by FastAPI:

- `DATABASE_URL` — SQLAlchemy URL; defaults to `sqlite:///data/decido.sqlite`.
- `DATABASE_URL_POOLED` — optional pooled PostgreSQL connection string, preferred for serverless deployment.
- `SESSION_TTL_DAYS` — session lifetime (14 by default).
- `COOKIE_SECURE` — set to `true` when serving over HTTPS.
- `CORS_ORIGINS` — comma-separated browser origins when frontend and API use separate hosts.
- `VITE_API_URL` — optional API origin for the built frontend; keep empty when Nginx proxies `/api/` on the same origin.
- `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID` — the public Web OAuth client ID used to verify Google sign-in. The Google consent screen can restrict sign-in to configured test accounts while it is in Testing mode.

## Verify

With the virtual environment activated:

```sh
npm test
npm run build
```

`npm test` runs the legacy Node regression tests and FastAPI integration tests. The frontend build is written to `frontend/dist`.

## Run the production container locally

Docker Compose runs the React build, FastAPI, and PostgreSQL on one origin. Create a Docker environment file and replace its sample password with a long URL-safe value:

```sh
cp .env.docker.example .env.docker
docker compose --env-file .env.docker up --build
```

Open <http://localhost:8000>. The PostgreSQL data is stored in the `postgres_data` Docker volume. Stop the containers with `docker compose --env-file .env.docker down`; keep the volume to retain poll data.

Prometheus scrapes API metrics at <http://127.0.0.1:9090>; Grafana is available at <http://127.0.0.1:3001> with the provisioned Decido API dashboard. Set `GRAFANA_ADMIN_PASSWORD` in `.env.docker` before starting the monitoring services. Both monitoring ports bind to localhost.

## VM deployment

Build and run the container on the VM, keep its published port bound to `127.0.0.1`, and configure Nginx with `deploy/nginx.conf`. Enable HTTPS in Nginx and set `COOKIE_SECURE=true`. Keep `.env.docker` and database credentials on the server; do not commit them. Back up the PostgreSQL volume. The container serves the built React app and its `/api` endpoints from the same origin.

## Vercel deployment

The repository includes a Vercel Services configuration that builds `frontend/` as the Vite site and `backend/` as a FastAPI service. Both use the same public origin: `/api/*` goes to FastAPI and other paths go to React. The backend prefers `DATABASE_URL_POOLED` when the database integration provides it, then falls back to `DATABASE_URL`. Set `GOOGLE_CLIENT_ID` for backend token verification and `VITE_GOOGLE_CLIENT_ID` for the Vite build; both contain the OAuth web client ID, which is public. Set `COOKIE_SECURE=true`; same-origin routing keeps the session cookie first-party. The current Google OAuth consent screen is in Testing mode, so only configured test users can sign in until the app is published. The `vercel.json` Services feature is currently in beta.
