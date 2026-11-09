-- content-security-scan: whether a content scan blocks publishing; one row edited by an admin.
CREATE TABLE security_policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  settings TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);
