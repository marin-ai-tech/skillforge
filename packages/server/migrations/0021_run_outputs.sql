-- Run output index.
-- One row per stored stream (stdout / stderr / trace / file) of a run against an artifact
-- version. Content lives in the dedicated content-addressed store data/run-outputs/<aa>/<sha256>
-- (not data/blobs); purge erases rows through the eraser registry and unlinks files after COMMIT.
CREATE TABLE run_outputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  run_kind TEXT NOT NULL,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  version TEXT NOT NULL,
  stream TEXT NOT NULL,
  name TEXT,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  truncated INTEGER NOT NULL DEFAULT 0,
  exit_code INTEGER,
  timed_out INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT
);
CREATE INDEX idx_run_outputs_artifact ON run_outputs (artifact_id, version, created_at);
CREATE INDEX idx_run_outputs_run ON run_outputs (run_id);
CREATE INDEX idx_run_outputs_sha ON run_outputs (sha256);
CREATE INDEX idx_run_outputs_expires ON run_outputs (expires_at);
