import type { Database } from "../repo.ts";
import { listAllAgents } from "../agents/store.ts";
import { listAllMcpServers } from "../agents/mcp-store.ts";
import { getArtifactByTypeName } from "../repo.ts";
import { identitiesOf, versionDescriptor, cardOf, type McpCardDescriptor } from "./descriptor.ts";

/**
 * Who uses a registry MCP server, from inventory observations: counts only. A package matches by its identifier
 * whatever the launcher (npx, bunx, pnpm dlx), a remote server by its origin.
 */
export function mcpUsage(
  db: Database,
  card: McpCardDescriptor,
): { installs: number; people: number; same_version: number } {
  const ids = identitiesOf(card);
  const versionOf = new Map(card.packages.map((p) => [p.identifier, p.version]));
  const ownerOf = new Map(listAllAgents(db).map((a) => [a.id, a.owner_id]));
  const matched = listAllMcpServers(db).filter(
    (s) =>
      (s.package !== null && s.transport === "stdio" && ids.packages.has(s.package)) ||
      (s.origin !== null && ids.origins.has(s.origin)),
  );
  return {
    installs: matched.length,
    people: new Set(matched.map((s) => ownerOf.get(s.agent_id) ?? s.agent_id)).size,
    same_version: matched.filter(
      (s) =>
        s.package !== null &&
        s.pinned &&
        s.version !== null &&
        versionOf.get(s.package) === s.version,
    ).length,
  };
}

export type RegistryLink = { name: string; status: string };

/** Package identifier and remote origin → the registry mcp-server whose latest version declares it. */
export function registryIndex(
  db: Database,
  dataDir: string | undefined,
): { packages: Map<string, RegistryLink>; origins: Map<string, RegistryLink> } {
  const packages = new Map<string, RegistryLink>();
  const origins = new Map<string, RegistryLink>();
  if (!dataDir) return { packages, origins };
  const rows = db
    .prepare(
      "SELECT name FROM artifacts WHERE type = 'mcp-server' AND purged_at IS NULL AND latest_version IS NOT NULL ORDER BY name",
    )
    .all() as Array<{ name: string }>;
  for (const { name } of rows) {
    const row = getArtifactByTypeName(db, "mcp-server", name);
    if (!row?.latest_version) continue;
    const d = versionDescriptor(db, dataDir, row.id, row.latest_version);
    if (!d) continue;
    const link = { name: row.name, status: row.status };
    const ids = identitiesOf(cardOf(d.obj));
    for (const p of ids.packages) if (!packages.has(p)) packages.set(p, link);
    for (const o of ids.origins) if (!origins.has(o)) origins.set(o, link);
  }
  return { packages, origins };
}
