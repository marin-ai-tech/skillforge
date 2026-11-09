-- upstream-mirror: git sources the registry checks again and again, with the result of the last check.
CREATE TABLE import_mirrors (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  ref TEXT,
  path TEXT,
  include TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_checked_at TEXT,
  last_commit TEXT,
  last_status TEXT,
  last_report TEXT
);
