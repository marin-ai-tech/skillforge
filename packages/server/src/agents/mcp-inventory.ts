import type { Database } from "../db.ts";
import { getUserById } from "../auth/users.ts";
import { listAllAgents } from "./store.ts";
import { isUnpinned, listAllMcpServers, type StoredMcpServer } from "./mcp-store.ts";
import { registryIndex, type RegistryLink } from "../mcp-registry/usage.ts";

type Kind = "package" | "origin" | "name";

export type McpInventoryServer = {
  key: string;
  kind: Kind;
  label: string;
  names: string[];
  transports: string[];
  installs: number;
  people: string[];
  versions: string[];
  unpinned_installs: number;
  literal_secret_installs: number;
  disabled_installs: number;
  /** The registry mcp-server declaring this package or origin (mcp-server-card), or null for a shadow server. */
  registry: RegistryLink | null;
};

/** A package under any local name, a remote origin, otherwise the configured name (local scripts). */
function identity(s: StoredMcpServer): { key: string; kind: Kind; label: string } {
  if (s.transport === "stdio" && s.package && s.launcher) {
    return { key: `package:${s.launcher}:${s.package}`, kind: "package", label: s.package };
  }
  if (s.origin) return { key: `origin:${s.origin}`, kind: "origin", label: s.origin };
  return { key: `name:${s.name}`, kind: "name", label: s.name };
}

const sorted = (values: Iterable<string>) =>
  [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

function attention(a: McpInventoryServer, b: McpInventoryServer): number {
  const secret = Number(b.literal_secret_installs > 0) - Number(a.literal_secret_installs > 0);
  const unpinned = Number(b.unpinned_installs > 0) - Number(a.unpinned_installs > 0);
  return (
    secret ||
    unpinned ||
    b.installs - a.installs ||
    (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)
  );
}

type Install = StoredMcpServer & { person: string };

function summarize(key: string, list: Install[]): McpInventoryServer {
  const id = identity(list[0]!);
  return {
    key,
    kind: id.kind,
    label: id.label,
    names: sorted(list.map((s) => s.name)).slice(0, 10),
    transports: sorted(list.map((s) => s.transport)),
    installs: list.length,
    people: sorted(list.map((s) => s.person)),
    versions: sorted(list.filter((s) => s.pinned && s.version).map((s) => s.version!)),
    unpinned_installs: list.filter(isUnpinned).length,
    literal_secret_installs: list.filter((s) => s.literal_secret).length,
    disabled_installs: list.filter((s) => !s.enabled).length,
    registry: null,
  };
}

/** The `mcp` section of the organisation inventory (admin only, like the rest of it). No paths beyond templates. */
export function mcpInventory(db: Database, dataDir?: string) {
  const agents = listAllAgents(db);
  const personOf = new Map(
    agents.map((a) => [a.id, getUserById(db, a.owner_id)?.username ?? a.owner_id] as const),
  );
  const installs: Install[] = listAllMcpServers(db).map((s) => ({
    ...s,
    person: personOf.get(s.agent_id) ?? s.agent_id,
  }));
  const groups = new Map<string, Install[]>();
  for (const s of installs) {
    const key = identity(s).key;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const index = registryIndex(db, dataDir);
  const linkOf = (s: McpInventoryServer): RegistryLink | null =>
    (s.kind === "package"
      ? index.packages.get(s.label)
      : s.kind === "origin"
        ? index.origins.get(s.label)
        : undefined) ?? null;
  const servers = [...groups]
    .map(([key, list]) => summarize(key, list))
    .map((s) => ({ ...s, registry: linkOf(s) }))
    .sort(attention);
  const scannedAgents = db
    .prepare("SELECT COUNT(*) AS n FROM agents WHERE mcp_scanned_at IS NOT NULL")
    .get() as { n: number | bigint };
  return {
    totals: {
      agents: Number(scannedAgents.n),
      people: new Set(installs.map((s) => s.person)).size,
      servers: servers.length,
      installs: installs.length,
      unpinned_installs: installs.filter(isUnpinned).length,
      literal_secret_installs: installs.filter((s) => s.literal_secret).length,
      remote_installs: installs.filter((s) => s.transport !== "stdio" && s.origin !== null).length,
    },
    servers,
  };
}
