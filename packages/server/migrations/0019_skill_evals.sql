-- skill-evals: suites, cases, runs, results
CREATE TABLE eval_suites (
  artifact_id TEXT PRIMARY KEY REFERENCES artifacts(id),
  gate TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE eval_cases (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  case_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL,
  prompt TEXT NOT NULL,
  holdout INTEGER NOT NULL DEFAULT 0,
  expect_trigger INTEGER,
  checks TEXT,
  PRIMARY KEY (artifact_id, case_id)
);

CREATE TABLE eval_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  kind TEXT NOT NULL,
  version TEXT NOT NULL,
  against TEXT,
  runner TEXT NOT NULL,
  scope TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  summary TEXT,
  errors INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE TABLE eval_results (
  run_id INTEGER NOT NULL REFERENCES eval_runs(id),
  case_id TEXT NOT NULL,
  side TEXT NOT NULL,
  passed INTEGER NOT NULL,
  triggered INTEGER,
  error TEXT,
  duration_ms INTEGER NOT NULL,
  output_excerpt TEXT,
  PRIMARY KEY (run_id, case_id, side)
);

CREATE INDEX idx_eval_runs_artifact_created ON eval_runs (artifact_id, created_at);
CREATE INDEX idx_eval_cases_artifact ON eval_cases (artifact_id, position);
