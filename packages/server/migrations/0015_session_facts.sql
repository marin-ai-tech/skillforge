-- session-usage-metrics: attributed session usage facts (four fields only; no prompts/commands/paths).
CREATE TABLE session_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  version TEXT NOT NULL,
  reporter TEXT NOT NULL,
  session_key TEXT NOT NULL,
  used_at TEXT NOT NULL,
  verification TEXT NOT NULL CHECK (verification IN ('pass', 'fail', 'none')),
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_session_facts_idempotent
  ON session_facts (reporter, artifact_id, session_key, used_at);

CREATE INDEX idx_session_facts_artifact
  ON session_facts (artifact_id);

CREATE INDEX idx_session_facts_daily
  ON session_facts (reporter, created_at);

CREATE INDEX idx_session_facts_artifact_version
  ON session_facts (artifact_id, version);