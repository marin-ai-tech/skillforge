import type { Database } from "../db.ts";
import type { McpSnapshot, McpSnapshotServer } from "./mcp-body.ts";

export type StoredMcpServer = McpSnapshotServer;

/** Replaces all MCP observations of an agent and stamps `mcp_scanned_at`; the caller holds the transaction. */
export function replaceMcpServers(
  db: Database,
  agentId: string,
  mcp: McpSnapshot,
  scannedAt: string,
): void {
  db.prepare("DELETE FROM agent_mcp_servers WHERE agent_id = ?").run(agentId);
  const insert = db.prepare(
    `INSERT INTO agent_mcp_servers (agent_id, runtime, source, name, scope, transport, launcher, package, pinned,
       version, origin, env, headers, literal_secret, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const s of mcp.servers) {
    insert.run(
      agentId,
      s.runtime,
      s.source,
      s.name,
      s.scope,
      s.transport,
      s.launcher,
      s.package,
      s.pinned ? 1 : 0,
      s.version,
      s.origin,
      JSON.stringify(s.env),
      JSON.stringify(s.headers),
      s.literal_secret ? 1 : 0,
      s.enabled ? 1 : 0,
    );
  }
  db.prepare("UPDATE agents SET mcp_scanned_at = ? WHERE id = ?").run(scannedAt, agentId);
}

function mapRow(row: Record<string, unknown>): StoredMcpServer {
  const text = (v: unknown) => (v == null ? null : String(v));
  return {
    name: String(row.name),
    runtime: String(row.runtime),
    source: String(row.source),
    scope: row.scope as StoredMcpServer["scope"],
    transport: row.transport as StoredMcpServer["transport"],
    launcher: text(row.launcher),
    package: text(row.package),
    pinned: Number(row.pinned) === 1,
    version: text(row.version),
    origin: text(row.origin),
    env: JSON.parse(String(row.env)) as StoredMcpServer["env"],
    headers: JSON.parse(String(row.headers)) as StoredMcpServer["headers"],
    literal_secret: Number(row.literal_secret) === 1,
    enabled: Number(row.enabled) === 1,
  };
}

export function listMcpServers(db: Database, agentId: string): StoredMcpServer[] {
  const rows = db
    .prepare(
      "SELECT * FROM agent_mcp_servers WHERE agent_id = ? ORDER BY name, scope, source, rowid",
    )
    .all(agentId) as Record<string, unknown>[];
  return rows.map(mapRow);
}

/** Every observation with its agent, for the organisation summary. */
export function listAllMcpServers(db: Database): Array<StoredMcpServer & { agent_id: string }> {
  const rows = db.prepare("SELECT * FROM agent_mcp_servers ORDER BY rowid").all() as Record<
    string,
    unknown
  >[];
  return rows.map((r) => ({ ...mapRow(r), agent_id: String(r.agent_id) }));
}

export function mcpScannedAt(db: Database, agentId: string): string | null {
  const row = db.prepare("SELECT mcp_scanned_at FROM agents WHERE id = ?").get(agentId) as
    { mcp_scanned_at: string | null } | undefined;
  return row?.mcp_scanned_at ?? null;
}

/** Counts for the snapshot response: unpinned are stdio servers with a package that is not pinned. */
export function mcpSummary(mcp: McpSnapshot): {
  servers: number;
  unpinned: number;
  literal_secret: number;
} {
  return {
    servers: mcp.servers.length,
    unpinned: mcp.servers.filter(isUnpinned).length,
    literal_secret: mcp.servers.filter((s) => s.literal_secret).length,
  };
}

export function isUnpinned(s: Pick<StoredMcpServer, "transport" | "package" | "pinned">): boolean {
  return s.transport === "stdio" && s.package !== null && !s.pinned;
}
