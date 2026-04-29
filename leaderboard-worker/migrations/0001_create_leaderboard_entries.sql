CREATE TABLE IF NOT EXISTS leaderboard_entries (
  username_key TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score >= 0),
  time_survived_seconds REAL NOT NULL CHECK (time_survived_seconds >= 0),
  ships_destroyed INTEGER NOT NULL CHECK (ships_destroyed >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS leaderboard_entries_rank_idx
ON leaderboard_entries (
  score DESC,
  time_survived_seconds DESC,
  ships_destroyed DESC,
  updated_at ASC,
  username_key ASC
);
