-- Learning progress for one learner. The Worker is the only writer.
CREATE TABLE IF NOT EXISTS term_progress (
  term_id TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  stage INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  points INTEGER NOT NULL,
  answered INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  longest_streak INTEGER NOT NULL,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scene_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  at TEXT NOT NULL,
  chain_id TEXT NOT NULL,
  anchor TEXT NOT NULL,
  mode TEXT NOT NULL,
  setting_id TEXT NOT NULL,
  correct INTEGER NOT NULL,
  risk REAL NOT NULL,
  points INTEGER NOT NULL,
  source TEXT NOT NULL,
  note TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS scene_events_anchor ON scene_events (anchor, at);

-- One row per accepted save; its primary key makes a retried save a no-op.
CREATE TABLE IF NOT EXISTS saves (
  save_id TEXT PRIMARY KEY,
  saved_at TEXT NOT NULL,
  session_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS learner_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
