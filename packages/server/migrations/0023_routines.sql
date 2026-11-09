-- Routines engine.
-- Artifact-scoped scheduled commands: definition + scheduler state in `routines`,
-- run history in `routine_runs`. Step stdout/stderr lives in run_outputs
-- (run_kind = "routine", run_id = "rt:<id>"); isolated memory is a persistent
-- per-routine directory under <dataDir>/routines/<artifactId>/<routineId>/,
-- removed by the purge eraser after COMMIT.
CREATE TABLE routines (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  routine_id TEXT NOT NULL,
  name TEXT,
  definition TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at TEXT,
  last_run_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (artifact_id, routine_id)
);
CREATE INDEX idx_routines_due ON routines (enabled, next_run_at);

CREATE TABLE routine_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  routine_id TEXT NOT NULL,
  status TEXT NOT NULL,
  trigger TEXT NOT NULL,
  triggered_by TEXT NOT NULL,
  exit_code INTEGER,
  timed_out INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX idx_routine_runs_artifact ON routine_runs (artifact_id, id);
CREATE INDEX idx_routine_runs_status ON routine_runs (status, id);
