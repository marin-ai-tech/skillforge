-- news: one registry-wide feed. Automatic items (`new_artifact`, `new_version`, `status_change`) keep the event
-- fields, not a text: the text is built at read time in the reader's language, and rights are checked at read time.
-- Posts (`post`) keep their own fields. The list of kinds is checked once in code (news/kinds.ts), not by a CHECK.
CREATE TABLE news_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  artifact_id TEXT REFERENCES artifacts(id),
  version TEXT,
  from_status TEXT,
  to_status TEXT,
  title TEXT,
  body TEXT,
  team TEXT,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  important INTEGER NOT NULL DEFAULT 0 CHECK (important IN (0, 1)),
  draft INTEGER NOT NULL DEFAULT 0 CHECK (draft IN (0, 1)),
  publish_at TEXT,
  expires_at TEXT,
  author TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_news_items_at ON news_items(at, id);
CREATE INDEX idx_news_items_artifact ON news_items(artifact_id, kind);

CREATE TABLE news_seen (
  username TEXT PRIMARY KEY COLLATE NOCASE,
  seen_at TEXT NOT NULL
);
