CREATE TABLE IF NOT EXISTS score_submissions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
