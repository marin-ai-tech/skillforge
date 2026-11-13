-- tracked-sources: the git source an artifact came from, checked for updates that go to beta for review.
CREATE TABLE IF NOT EXISTS artifact_sources (
  artifact_id TEXT PRIMARY KEY REFERENCES artifacts(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  path TEXT NOT NULL,
  ref TEXT,
  last_commit TEXT,
  last_checked_at TEXT,
  state TEXT,
  state_detail TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  edits TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
