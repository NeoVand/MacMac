CREATE TABLE IF NOT EXISTS battle_claims (
  id TEXT PRIMARY KEY NOT NULL,
  battle_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS battle_claims_user_battle ON battle_claims (user_id, battle_id);
