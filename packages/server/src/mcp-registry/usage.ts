import type { Database } from "../repo.ts";
import { listAllAgents } from "../agents/store.ts";
import { listAllMcpServers } from "../agents/mcp-store.ts";
import { getArtifactByTypeName } from "../repo.ts";
import { identitiesOf, versionDescriptor, cardOf, type McpCardDescriptor } from "./descriptor.ts";
import { packageKey, packageVersion, registryTypeOfLauncher } from "./package-key.ts";

export type McpUsage = {
  installs: number;
  people: number;
  same_version: number;
  other_versions: Array<{ version: string; installs: number }>;
};

function packageKeysOf(card: McpCardDescriptor): Map<string, string | null> {
  const keys = new Map<string, string | null>();
  for (const p of card.packages) {
    if (!p.identifier) continue;
    const key = packageKey(p.registryType, p.identifier);
    if (!keys.has(key)) keys.set(key, packageVersion(p.registryType, p.identifier, p.version));
  }
  return keys;
}

function observationKey(launcher: string | null, pkg: string): string {
  return packageKey(registryTypeOfLauncher(launcher), pkg);
}

/**
 * Who uses a registry MCP server, from inventory observations: counts only. A package matches by
 * packageKey (${registryType}: plus npm as-is, pypi PEP 503, OCI without digest); a remote server by its origin.
 */
export function mcpUsage(db: Database, card: McpCardDescriptor): McpUsage {
  const pkgKeys = packageKeysOf(card);
  const origins = identitiesOf(card).origins;
  const ownerOf = new Map(listAllAgents(db).map((a) => [a.id, a.owner_id]));
  const matched = listAllMcpServers(db).filter(
    (s) =>
      (s.package !== null &&
        s.transport === "stdio" &&
        pkgKeys.has(observationKey(s.launcher, s.package))) ||
      (s.origin !== null && origins.has(s.origin)),
  );
  const registryVersionOf = (pkg: string, launcher: string | null) =>
    pkgKeys.get(observationKey(launcher, pkg));
  const same_version = matched.filter(
    (s) =>
      s.package !== null &&
      s.pinned &&
      s.version !== null &&
      registryVersionOf(s.package, s.launcher) === s.version,
  ).length;
  const counts = new Map<string, number>();
  for (const s of matched) {
    if (!s.package || !s.pinned || !s.version) continue;
    if (registryVersionOf(s.package, s.launcher) === s.version) continue;
    if (registryVersionOf(s.package, s.launcher) === undefined) continue;
    counts.set(s.version, (counts.get(s.version) ?? 0) + 1);
  }
  const other_versions = [...counts.entries()]
    .map(([version, installs]) => ({ version, installs }))
    .sort(
      (a, b) =>
        b.installs - a.installs || (a.version < b.version ? -1 : a.version > b.version ? 1 : 0),
    )
    .slice(0, 10);
  return {
    installs: matched.length,
    people: new Set(matched.map((s) => ownerOf.get(s.agent_id) ?? s.agent_id)).size,
    same_version,
    other_versions,
  };
}

export type RegistryLink = { name: string; status: string; version: string | null };

/** Package key and remote origin → the registry mcp-server whose latest version declares it. */
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
    const card = cardOf(d.obj);
    const originsLink = { name: row.name, status: row.status, version: null as string | null };
    for (const p of card.packages) {
      if (!p.identifier) continue;
      const key = packageKey(p.registryType, p.identifier);
      if (!packages.has(key)) {
        packages.set(key, {
          name: row.name,
          status: row.status,
          version: packageVersion(p.registryType, p.identifier, p.version),
        });
      }
    }
    for (const o of identitiesOf(card).origins) if (!origins.has(o)) origins.set(o, originsLink);
  }
  return { packages, origins };
}
