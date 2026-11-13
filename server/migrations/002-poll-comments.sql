CREATE TABLE poll_comments (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES poll_comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL
);
CREATE INDEX poll_comments_roots_idx ON poll_comments(poll_id, created_at DESC) WHERE parent_id IS NULL;
CREATE INDEX poll_comments_parent_idx ON poll_comments(parent_id, created_at);
