-- Agent inventory (snapshots + items)
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  runtime TEXT,
  server_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  scanned_at TEXT,
  UNIQUE(owner_id, name)
);

CREATE TABLE IF NOT EXISTS agent_items (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  digest TEXT NOT NULL,
  files TEXT NOT NULL CHECK (json_valid(files)),
  version TEXT,
  root TEXT NOT NULL,
  scanned_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, key)
);

CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner_id);
CREATE INDEX IF NOT EXISTS idx_agent_items_agent ON agent_items(agent_id);
