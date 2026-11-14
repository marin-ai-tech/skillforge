import type { Database } from "../repo.ts";
import { mcpInventory } from "./mcp-inventory.ts";
import { getUserById } from "../auth/users.ts";
import type { Viewer } from "../visibility/index.ts";
import { compareAgent, type CompareItem } from "./compare.ts";
import { listAllAgents } from "./store.ts";

/**
 * Organisation-wide summary of agent snapshots: what stands on people's machines,
 * own and imported artifacts, copies that differ from the registry and copies the registry has never seen.
 * Names and counts only: no roots, paths or file contents.
 */
export type CopyStatus = "in_sync" | "outdated" | "modified" | "unregistered";
type Origin = "own" | "imported" | "unregistered";

type Copy = { type: string; name: string; status: CopyStatus; digest: string; person: string };

type ArtifactEntry = {
  type: string;
  name: string;
  origin: Origin;
  registry_status: string | null;
  copies: number;
  people: number;
  variants: number;
  statuses: Partial<Record<CopyStatus, number>>;
};

const ATTENTION: CopyStatus[] = ["unregistered", "modified", "outdated", "in_sync"];

function copyStatus(item: CompareItem): CopyStatus {
  return item.status === "local_only" ? "unregistered" : item.status;
}

function originOf(
  db: Database,
  type: string,
  name: string,
): { origin: Origin; status: string | null } {
  const row = db
    .prepare(
      `SELECT a.status, v.provenance FROM artifacts a
       LEFT JOIN artifact_versions v ON v.artifact_id = a.id AND v.version = a.latest_version
       WHERE a.type = ? AND a.name = ? AND a.purged_at IS NULL`,
    )
    .get(type, name) as { status: string; provenance: string | null } | undefined;
  if (!row) return { origin: "unregistered", status: null };
  const source = row.provenance ? (JSON.parse(row.provenance) as { source?: string }).source : null;
  return { origin: source === "import" ? "imported" : "own", status: row.status };
}

/** Lower rank = needs attention sooner: any copy outside the registry, then modified, outdated, in sync. */
function rank(e: ArtifactEntry): number {
  return ATTENTION.findIndex((s) => (e.statuses[s] ?? 0) > 0);
}

function entries(db: Database, copies: Copy[]): ArtifactEntry[] {
  const groups = new Map<string, Copy[]>();
  for (const c of copies) {
    const key = `${c.type}/${c.name}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const out: ArtifactEntry[] = [];
  for (const list of groups.values()) {
    const { type, name } = list[0]!;
    const { origin, status } = originOf(db, type, name);
    const statuses: ArtifactEntry["statuses"] = {};
    for (const c of list) statuses[c.status] = (statuses[c.status] ?? 0) + 1;
    out.push({
      type,
      name,
      origin,
      registry_status: status,
      copies: list.length,
      people: new Set(list.map((c) => c.person)).size,
      variants: new Set(list.map((c) => c.digest)).size,
      statuses,
    });
  }
  return out.sort(
    (a, b) => rank(a) - rank(b) || b.copies - a.copies || a.name.localeCompare(b.name),
  );
}

export function organisationInventory(db: Database, viewer: Viewer, dataDir?: string) {
  const agents = listAllAgents(db);
  const copies: Copy[] = [];
  const people = new Map<
    string,
    { agents: number; copies: number; unregistered: number; last_scan: string | null }
  >();
  for (const agent of agents) {
    const person = getUserById(db, agent.owner_id)?.username ?? agent.owner_id;
    const p = people.get(person) ?? { agents: 0, copies: 0, unregistered: 0, last_scan: null };
    p.agents++;
    if (agent.scanned_at && (!p.last_scan || agent.scanned_at > p.last_scan))
      p.last_scan = agent.scanned_at;
    for (const item of compareAgent(db, agent, { viewer }).items) {
      const status = copyStatus(item);
      // agent-source-marker: a built copy counts at its source artifact.
      const id = item.source ?? item;
      copies.push({ type: id.type, name: id.name, status, digest: item.local.digest, person });
      p.copies++;
      if (status === "unregistered") p.unregistered++;
    }
    people.set(person, p);
  }
  const by_status: Record<CopyStatus, number> = {
    in_sync: 0,
    outdated: 0,
    modified: 0,
    unregistered: 0,
  };
  for (const c of copies) by_status[c.status]++;
  return {
    totals: { agents: agents.length, people: people.size, copies: copies.length, by_status },
    artifacts: entries(db, copies),
    people: [...people]
      .map(([username, p]) => ({ username, ...p }))
      .sort((a, b) => b.unregistered - a.unregistered || a.username.localeCompare(b.username)),
    mcp: mcpInventory(db, dataDir),
  };
}
