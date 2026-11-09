-- team-availability: per team, whether an artifact is unavailable, installed by default or required
-- (no row means available).
CREATE TABLE artifact_availability (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  team_id TEXT NOT NULL REFERENCES teams(id),
  state TEXT NOT NULL CHECK (state IN ('unavailable', 'default', 'required')),
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL,
  PRIMARY KEY (artifact_id, team_id)
);
