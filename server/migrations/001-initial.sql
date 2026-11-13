CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE polls (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL CHECK(type IN ('single', 'multiple', 'rating')),
  deadline TEXT,
  visibility TEXT NOT NULL CHECK(visibility IN ('public', 'private')),
  invite_token_hash TEXT NOT NULL,
  allow_vote_change INTEGER NOT NULL DEFAULT 0 CHECK(allow_vote_change IN (0, 1)),
  created_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE INDEX polls_created_at_idx ON polls(created_at DESC);
CREATE INDEX polls_owner_created_idx ON polls(owner_id, created_at DESC);

CREATE TABLE poll_options (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  position INTEGER NOT NULL,
  UNIQUE(poll_id, position),
  UNIQUE(poll_id, text)
);
CREATE INDEX poll_options_poll_idx ON poll_options(poll_id, position);

CREATE TABLE poll_participants (
  poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  PRIMARY KEY(poll_id, user_id)
);

CREATE TABLE votes (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(poll_id, user_id)
);
CREATE INDEX votes_poll_idx ON votes(poll_id);

CREATE TABLE vote_choices (
  vote_id TEXT NOT NULL REFERENCES votes(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL REFERENCES poll_options(id) ON DELETE RESTRICT,
  PRIMARY KEY(vote_id, option_id)
);

CREATE TABLE vote_scores (
  vote_id TEXT NOT NULL REFERENCES votes(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL REFERENCES poll_options(id) ON DELETE RESTRICT,
  score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 10),
  PRIMARY KEY(vote_id, option_id)
);
