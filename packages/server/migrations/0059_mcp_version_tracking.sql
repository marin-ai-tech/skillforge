-- mcp-version-tracking: last package-registry check per mcp-server, and a journal of versions already notified.
CREATE TABLE mcp_release_checks (
  artifact_id TEXT PRIMARY KEY REFERENCES artifacts(id),
  registry_type TEXT,
  identifier TEXT,
  registry_version TEXT,
  upstream_version TEXT,
  state TEXT,
  state_detail TEXT,
  checked_at TEXT
);

CREATE TABLE mcp_version_notices (
  artifact_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (artifact_id, kind, version)
);
