-- Hook runtime.
-- Platform-level subscriptions pin a published hook-artifact version as an
-- active org hook; hook_decisions is the append-only audit of every evaluated
-- handler. The materialized working copy of the version lives under
-- <dataDir>/hook-env/<subscription_id>/, removed by the purge eraser.
CREATE TABLE hook_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  artifact_type TEXT NOT NULL,
  artifact_name TEXT NOT NULL,
  version TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (artifact_id, version)
);

CREATE TABLE hook_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL REFERENCES hook_subscriptions(id),
  event TEXT NOT NULL,
  matcher TEXT,
  entry_idx INTEGER,
  verdict TEXT NOT NULL,
  exit_code INTEGER,
  duration_ms INTEGER,
  detail TEXT,
  actor TEXT NOT NULL,
  context TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_hook_decisions_sub ON hook_decisions (subscription_id, id);
CREATE INDEX idx_hook_decisions_time ON hook_decisions (id);
