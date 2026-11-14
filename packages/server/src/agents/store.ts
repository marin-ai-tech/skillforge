import { bumpRegistryEpoch } from "../registry-epoch.ts";
import { randomBytes } from "node:crypto";
import type { Database } from "../db.ts";
import type { SnapshotItem } from "./scan.ts";
import type { DuplicateGroup } from "./duplicates.ts";
import { parseSourceMarkerJson, type SourceMarker } from "./source-marker.ts";

export type AgentKind = "upload" | "server";

export type AgentRow = {
  id: string;
  owner_id: string;
  name: string;
  kind: AgentKind;
  runtime: string | null;
  server_path: string | null;
  created_at: string;
  updated_at: string;
  scanned_at: string | null;
  duplicates: DuplicateGroup[];
};

export type AgentItemRow = {
  agent_id: string;
  key: string;
  type: string;
  name: string;
  digest: string;
  files: Array<{ path: string; sha256: string; size: number }>;
  version: string | null;
  root: string;
  scanned_at: string;
  translated: boolean;
  /** agent-source-marker: the artifact the file was built from, or null. */
  source?: SourceMarker | null;
};

function newId(): string {
  return randomBytes(16).toString("hex");
}

function parseFiles(raw: string): Array<{ path: string; sha256: string; size: number }> {
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v as Array<{ path: string; sha256: string; size: number }>;
  } catch {
    return [];
  }
}

function parseDuplicates(raw: unknown): DuplicateGroup[] {
  if (typeof raw !== "string") return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as DuplicateGroup[]) : [];
  } catch {
    return [];
  }
}

function mapAgent(row: Record<string, unknown>): AgentRow {
  return {
    id: String(row.id),
    owner_id: String(row.owner_id),
    name: String(row.name),
    kind: row.kind as AgentKind,
    runtime: row.runtime == null ? null : String(row.runtime),
    server_path: row.server_path == null ? null : String(row.server_path),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    scanned_at: row.scanned_at == null ? null : String(row.scanned_at),
    duplicates: parseDuplicates(row.duplicates),
  };
}

function mapItem(row: Record<string, unknown>): AgentItemRow {
  return {
    agent_id: String(row.agent_id),
    key: String(row.key),
    type: String(row.type),
    name: String(row.name),
    digest: String(row.digest),
    files: parseFiles(String(row.files)),
    version: row.version == null ? null : String(row.version),
    root: String(row.root),
    scanned_at: String(row.scanned_at),
    translated: Number(row.translated ?? 0) !== 0,
    source: row.source == null ? null : parseSourceMarkerJson(String(row.source)),
  };
}

export function getAgentByName(db: Database, ownerId: string, name: string): AgentRow | null {
  const row = db
    .prepare("SELECT * FROM agents WHERE owner_id = ? AND name = ?")
    .get(ownerId, name) as Record<string, unknown> | undefined;
  return row ? mapAgent(row) : null;
}

export function getAgentById(db: Database, id: string): AgentRow | null {
  const row = db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as
    Record<string, unknown> | undefined;
  return row ? mapAgent(row) : null;
}

export function listAgents(db: Database, ownerId: string): AgentRow[] {
  const rows = db
    .prepare("SELECT * FROM agents WHERE owner_id = ? ORDER BY name ASC")
    .all(ownerId) as Record<string, unknown>[];
  return rows.map(mapAgent);
}

export function listAllAgents(db: Database): AgentRow[] {
  const rows = db.prepare("SELECT * FROM agents ORDER BY name ASC, owner_id ASC").all() as Record<
    string,
    unknown
  >[];
  return rows.map(mapAgent);
}

export function listAgentItems(db: Database, agentId: string): AgentItemRow[] {
  const rows = db
    .prepare("SELECT * FROM agent_items WHERE agent_id = ? ORDER BY key ASC")
    .all(agentId) as Record<string, unknown>[];
  return rows.map(mapItem);
}

export function getAgentItem(
  db: Database,
  agentId: string,
  type: string,
  name: string,
): AgentItemRow | null {
  const key = `${type}/${name}`;
  const row = db
    .prepare("SELECT * FROM agent_items WHERE agent_id = ? AND key = ?")
    .get(agentId, key) as Record<string, unknown> | undefined;
  return row ? mapItem(row) : null;
}

export function countAgentItems(db: Database, agentId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM agent_items WHERE agent_id = ?")
    .get(agentId) as { n: number | bigint };
  return Number(row.n);
}

export type UpsertAgentInput = {
  ownerId: string;
  name: string;
  kind: AgentKind;
  runtime?: string | null;
  serverPath?: string | null;
  scannedAt: string;
  duplicates?: DuplicateGroup[];
};

export function upsertAgent(db: Database, input: UpsertAgentInput): AgentRow {
  const existing = getAgentByName(db, input.ownerId, input.name);
  const now = input.scannedAt;
  const duplicates = JSON.stringify(input.duplicates ?? []);
  if (existing) {
    db.prepare(
      `UPDATE agents SET kind = ?, runtime = ?, server_path = ?, updated_at = ?, scanned_at = ?, duplicates = ?
       WHERE id = ?`,
    ).run(
      input.kind,
      input.runtime ?? existing.runtime,
      input.serverPath !== undefined ? input.serverPath : existing.server_path,
      now,
      input.scannedAt,
      duplicates,
      existing.id,
    );
    bumpRegistryEpoch();
    return getAgentById(db, existing.id)!;
  }
  const id = newId();
  db.prepare(
    `INSERT INTO agents (id, owner_id, name, kind, runtime, server_path, created_at, updated_at, scanned_at, duplicates)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.ownerId,
    input.name,
    input.kind,
    input.runtime ?? null,
    input.serverPath ?? null,
    now,
    now,
    input.scannedAt,
    duplicates,
  );
  bumpRegistryEpoch();
  return getAgentById(db, id)!;
}

export function replaceItems(
  db: Database,
  agentId: string,
  items: SnapshotItem[],
  scannedAt: string,
): void {
  db.prepare("DELETE FROM agent_items WHERE agent_id = ?").run(agentId);
  const insert = db.prepare(
    `INSERT INTO agent_items (agent_id, key, type, name, digest, files, version, root, scanned_at, translated, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const it of items) {
    insert.run(
      agentId,
      it.key,
      it.type,
      it.name,
      it.digest,
      JSON.stringify(it.files),
      it.version,
      it.root,
      scannedAt,
      it.translated ? 1 : 0,
      it.source ? JSON.stringify(it.source) : null,
    );
  }
  bumpRegistryEpoch();
}

export function deleteAgent(db: Database, id: string): boolean {
  db.prepare("DELETE FROM agent_items WHERE agent_id = ?").run(id);
  db.prepare("DELETE FROM agent_mcp_servers WHERE agent_id = ?").run(id);
  const r = db.prepare("DELETE FROM agents WHERE id = ?").run(id);
  bumpRegistryEpoch();
  return Number(r.changes) > 0;
}

export function agentPublicView(row: AgentRow): {
  id: string;
  name: string;
  kind: AgentKind;
  runtime: string | null;
  server_path: string | null;
  scanned_at: string | null;
} {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    runtime: row.runtime,
    server_path: row.server_path,
    scanned_at: row.scanned_at,
  };
}
