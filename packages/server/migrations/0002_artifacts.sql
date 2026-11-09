CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  display_name TEXT,
  tags TEXT NOT NULL CHECK (json_valid(tags)),
  status TEXT NOT NULL DEFAULT 'candidate',
  visibility TEXT NOT NULL DEFAULT 'org',
  owner_team TEXT,
  latest_version TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(type, name)
);

CREATE TABLE artifact_versions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  version TEXT NOT NULL,
  digest TEXT NOT NULL,
  description TEXT NOT NULL,
  display_name TEXT,
  tags TEXT NOT NULL CHECK (json_valid(tags)),
  frontmatter TEXT CHECK (frontmatter IS NULL OR json_valid(frontmatter)),
  files TEXT NOT NULL CHECK (json_valid(files)),
  warnings TEXT NOT NULL CHECK (json_valid(warnings)),
  changelog TEXT,
  model_compat TEXT NOT NULL CHECK (json_valid(model_compat)),
  provenance TEXT NOT NULL CHECK (json_valid(provenance)),
  evidence TEXT NOT NULL CHECK (json_valid(evidence)),
  validated_at TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  help_count INTEGER NOT NULL DEFAULT 0,
  published_by TEXT NOT NULL,
  published_at TEXT NOT NULL,
  UNIQUE(artifact_id, version),
  UNIQUE(artifact_id, digest)
);

CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  version TEXT,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  reason TEXT,
  meta TEXT CHECK (meta IS NULL OR json_valid(meta))
);

CREATE INDEX idx_artifacts_type ON artifacts(type);
CREATE INDEX idx_artifacts_updated_at ON artifacts(updated_at);
CREATE INDEX idx_audit_events_artifact_ts ON audit_events(artifact_id, ts);
