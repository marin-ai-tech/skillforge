-- Plugin platform tables
CREATE TABLE IF NOT EXISTS plugins (
  name TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  config TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config)),
  first_seen TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plugin_migrations (
  plugin TEXT NOT NULL,
  id TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  PRIMARY KEY (plugin, id)
);
