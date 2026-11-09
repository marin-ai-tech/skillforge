-- artifact-overlays: layers of edits over an artifact; scope 'company', 'team:<team_id>' or 'user:<username>'.
CREATE TABLE artifact_overlays (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  scope TEXT NOT NULL,
  ops TEXT NOT NULL CHECK (json_valid(ops)),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (artifact_id, scope)
);
