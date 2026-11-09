CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  version TEXT,
  parent_id TEXT REFERENCES comments(id),
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  ref TEXT,
  mentions TEXT NOT NULL CHECK (json_valid(mentions)),
  created_at TEXT NOT NULL,
  edited_at TEXT,
  deleted_at TEXT
);
CREATE INDEX idx_comments_artifact_created ON comments(artifact_id, created_at);
CREATE INDEX idx_comments_author_created ON comments(author, created_at);
CREATE INDEX idx_comments_parent ON comments(parent_id, created_at);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE,
  kind TEXT NOT NULL,
  artifact_id TEXT REFERENCES artifacts(id),
  version TEXT,
  comment_id TEXT REFERENCES comments(id),
  actor TEXT,
  title TEXT NOT NULL,
  text TEXT,
  url TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta)),
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX idx_notifications_user_created ON notifications(username, created_at);
CREATE INDEX idx_notifications_user_read ON notifications(username, read_at);
CREATE INDEX idx_notifications_artifact ON notifications(artifact_id);

CREATE TABLE artifact_watchers (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  username TEXT NOT NULL COLLATE NOCASE,
  source TEXT NOT NULL CHECK (source IN ('auto', 'manual')),
  PRIMARY KEY (artifact_id, username)
);

CREATE TABLE notification_prefs (
  username TEXT NOT NULL COLLATE NOCASE,
  kind TEXT NOT NULL CHECK (kind IN ('comment', 'mention', 'new_version', 'status_change', 'plugin')),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  PRIMARY KEY (username, kind)
);
