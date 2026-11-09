-- audit-export: events that are not about one artifact (policies, users, LLM settings, mirrors).
CREATE TABLE system_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  meta TEXT CHECK (meta IS NULL OR json_valid(meta))
);
CREATE INDEX idx_system_events_ts ON system_events(ts);
CREATE INDEX idx_audit_events_ts ON audit_events(ts);
