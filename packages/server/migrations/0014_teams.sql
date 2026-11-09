
-- teams-and-visibility: teams, visibility, labels
CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT,
  description TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE team_members (
  team_id TEXT NOT NULL REFERENCES teams(id),
  username TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('member', 'lead')),
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (team_id, username)
);

CREATE TABLE team_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id),
  action TEXT NOT NULL,
  meta TEXT CHECK (meta IS NULL OR json_valid(meta))
);

CREATE INDEX idx_team_audit_team_ts ON team_audit(team_id, ts);

ALTER TABLE artifacts ADD COLUMN labels TEXT NOT NULL DEFAULT '[]';
