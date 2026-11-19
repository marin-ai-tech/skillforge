-- news-delivery: each item is announced to plugins (`news.published`) once. `announced_at` is set in the same
-- transaction that picks the item, before the event goes out, so neither a restart nor a racing tick repeats it.
-- Items already published when this migration runs count as announced: an upgrade does not replay the old feed.
ALTER TABLE news_items ADD COLUMN announced_at TEXT;
UPDATE news_items SET announced_at = updated_at
  WHERE draft = 0 AND at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
CREATE INDEX idx_news_items_unannounced ON news_items(at) WHERE announced_at IS NULL;

-- The reader's summary period; no row means the default (`weekly`). The list of values is checked in code.
CREATE TABLE news_summary_prefs (
  username TEXT PRIMARY KEY COLLATE NOCASE,
  period TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One summary per reader and period, also across a restart. An empty period writes no row.
CREATE TABLE news_summary_sent (
  username TEXT NOT NULL COLLATE NOCASE,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  items INTEGER NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (username, period_start)
);

-- The personal Atom key (`sfa_<prefix>_<secret>`): one per user, stored as a hash; a new one replaces the old.
CREATE TABLE news_atom_keys (
  username TEXT PRIMARY KEY COLLATE NOCASE,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
