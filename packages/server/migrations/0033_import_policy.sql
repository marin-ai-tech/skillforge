-- import-source-policy: one row of settings edited by an admin, and when the registry first saw each commit of
-- each git address (the release quarantine counts from here, since a commit's own date is set by its author).
CREATE TABLE import_policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  settings TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE import_commit_seen (
  location_key TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  PRIMARY KEY (location_key, commit_sha)
);
