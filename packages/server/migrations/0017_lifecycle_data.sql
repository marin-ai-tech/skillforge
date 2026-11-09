-- lifecycle-by-data: holds + indexes for activity signals
CREATE TABLE lifecycle_holds (
  artifact_id TEXT PRIMARY KEY REFERENCES artifacts(id),
  until TEXT NOT NULL,
  reason TEXT NOT NULL,
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL
);

CREATE INDEX idx_usage_reports_artifact_reported
  ON artifact_usage_reports (artifact_id, reported_at);

CREATE INDEX idx_session_facts_artifact_used
  ON session_facts (artifact_id, used_at);
