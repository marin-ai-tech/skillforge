-- quality-rubric: company rules (scope 'company') and team rules (scope 'team:<id>'); the score of each version.
CREATE TABLE quality_rubrics (
  scope TEXT PRIMARY KEY,
  settings TEXT NOT NULL CHECK (json_valid(settings)),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
ALTER TABLE artifact_versions ADD COLUMN rubric TEXT;
