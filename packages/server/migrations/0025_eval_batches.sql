-- Eval orchestrator.
-- eval_batches orchestrates one suite version across multiple eval runners:
-- children are ordinary eval_runs (one per runner) linked via eval_batch_runs,
-- executed sequentially by the existing single-flight queue. The finished
-- batch summary carries the saturation verdict (suite too easy signal).
CREATE TABLE eval_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  version TEXT NOT NULL,
  kind TEXT NOT NULL,
  scope TEXT NOT NULL,
  against TEXT,
  runners TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  summary TEXT,
  error TEXT
);
CREATE INDEX idx_eval_batches_artifact ON eval_batches (artifact_id, id);
CREATE INDEX idx_eval_batches_status ON eval_batches (status, id);

CREATE TABLE eval_batch_runs (
  batch_id INTEGER NOT NULL REFERENCES eval_batches(id),
  run_id INTEGER NOT NULL REFERENCES eval_runs(id),
  runner TEXT NOT NULL,
  PRIMARY KEY (batch_id, run_id)
);
CREATE INDEX idx_eval_batch_runs_batch ON eval_batch_runs (batch_id);
