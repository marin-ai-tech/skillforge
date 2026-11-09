-- evidence-intake: attributed usage reports; artifact_versions.use_count/help_count cache their sums.
CREATE TABLE artifact_usage_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  version TEXT NOT NULL,
  reporter TEXT NOT NULL,
  uses INTEGER NOT NULL CHECK (uses BETWEEN 0 AND 100000),
  helped INTEGER NOT NULL CHECK (helped BETWEEN 0 AND uses),
  source TEXT NOT NULL,
  report_id TEXT,
  reported_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_usage_reports_reporter_report_id
  ON artifact_usage_reports (reporter, report_id)
  WHERE report_id IS NOT NULL AND report_id <> '';

CREATE INDEX idx_usage_reports_daily
  ON artifact_usage_reports (reporter, artifact_id, reported_at);

CREATE INDEX idx_usage_reports_version
  ON artifact_usage_reports (artifact_id, version);
