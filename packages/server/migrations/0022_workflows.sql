-- Workflow engine.
-- Artifact-scoped workflow definitions, runs and per-step traces. Step stdout/stderr and the
-- run trace live in run_outputs (run_kind = "workflow", run_id = "wf:<id>"); purge erases all
-- three tables through the eraser registry (artifact scope).
CREATE TABLE workflows (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  workflow_id TEXT NOT NULL,
  name TEXT,
  definition TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (artifact_id, workflow_id)
);

CREATE TABLE workflow_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  workflow_id TEXT NOT NULL,
  status TEXT NOT NULL,
  input TEXT,
  def_json TEXT NOT NULL,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  requested_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  error TEXT
);
CREATE INDEX idx_workflow_runs_artifact ON workflow_runs (artifact_id, created_at);
CREATE INDEX idx_workflow_runs_queued ON workflow_runs (status, id);

CREATE TABLE workflow_run_steps (
  run_id INTEGER NOT NULL REFERENCES workflow_runs(id),
  position INTEGER NOT NULL,
  step_id TEXT NOT NULL,
  status TEXT NOT NULL,
  exit_code INTEGER,
  timed_out INTEGER NOT NULL DEFAULT 0,
  next_step TEXT,
  duration_ms INTEGER,
  started_at TEXT,
  finished_at TEXT,
  error TEXT,
  PRIMARY KEY (run_id, position)
);
