-- mcp-policy: which MCP package types and remote origins may be published; one row edited by an admin.
CREATE TABLE mcp_policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  settings TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);
