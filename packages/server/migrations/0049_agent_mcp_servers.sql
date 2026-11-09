-- mcp-shadow-inventory: MCP servers observed in an agent's configs (`agent scan --mcp`). Observations only:
-- names, kinds and flags, never values of variables, headers or arguments. Replaced as a whole per scan with `mcp`.
ALTER TABLE agents ADD COLUMN mcp_scanned_at TEXT;

CREATE TABLE agent_mcp_servers (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  runtime TEXT NOT NULL,
  source TEXT NOT NULL,
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('project', 'user', 'local')),
  transport TEXT NOT NULL CHECK (transport IN ('stdio', 'http', 'sse', 'ws', 'unknown')),
  launcher TEXT,
  package TEXT,
  pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
  version TEXT,
  origin TEXT,
  env TEXT NOT NULL CHECK (json_valid(env)),
  headers TEXT NOT NULL CHECK (json_valid(headers)),
  literal_secret INTEGER NOT NULL CHECK (literal_secret IN (0, 1)),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))
);
-- No primary key: servers of the `local` scope of different projects may share a name and count as separate installs.

CREATE INDEX idx_agent_mcp_servers_agent ON agent_mcp_servers(agent_id);
