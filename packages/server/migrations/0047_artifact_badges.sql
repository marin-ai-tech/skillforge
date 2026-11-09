-- plugin-artifact-badges: badges plugins put on artifact cards; one row per artifact, plugin and badge id.
CREATE TABLE artifact_badges (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  plugin TEXT NOT NULL,
  badge_id TEXT NOT NULL,
  label TEXT NOT NULL,
  tone TEXT NOT NULL CHECK (tone IN ('ok', 'info', 'warn', 'danger')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (artifact_id, plugin, badge_id)
);
