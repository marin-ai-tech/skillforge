import { bumpRegistryEpoch } from "../registry-epoch.ts";
import { createHash } from "node:crypto";
import type { AppConfig } from "../config.ts";
import { getVersion, type Database } from "../repo.ts";
import { pluginName } from "./plugin.ts";
import { pluginZipSha256 } from "./plugin-archive.ts";
import { pluginDirCommand, shellSafeEntry } from "./source-mode.ts";
import { visibleClause } from "../visibility/sql.ts";
import type { Viewer } from "../visibility/index.ts";

/** Types that are not Claude Code plugins: they never enter the marketplace or plugin tarballs. */
export const NOT_PLUGINS: ReadonlySet<string> = new Set(["settings", "mcp-server"]);

export type MarketplacePlugin = {
  name: string;
  description: string;
  version: string;
  category: string;
  keywords: string[];
  /** Claude Code plugin source (>= 2.1.288): zip over https, or a command printing the plugin dir. */
  source:
    { source: "archive"; url: string; sha256: string } | { source: "command"; command: string };
  homepage: string;
};

export type MarketplaceDoc = {
  name: string;
  owner: { name: string };
  metadata: {
    description: string;
    version: string;
    generated_at: string;
  };
  plugins: MarketplacePlugin[];
};

export type MarketplaceResult = {
  body: MarketplaceDoc;
  etag: string;
  json: string;
};

let marketplaceVersion = 0;
const cache = new Map<string, MarketplaceResult>();

export function bumpMarketplaceVersion(): void {
  marketplaceVersion += 1;
  cache.clear();
  // Marketplace changes are registry changes: agent summary caches must drop too.
  bumpRegistryEpoch();
}

export function getMarketplaceVersion(): number {
  return marketplaceVersion;
}

function parseTags(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

type ArtifactListRow = {
  id: string;
  type: string;
  name: string;
  description: string;
  tags: string;
  latest_version: string | null;
  status: string;
};

function pluginSource(
  db: Database,
  config: AppConfig,
  base: string,
  row: ArtifactListRow,
  version: string,
): MarketplacePlugin["source"] {
  if (config.marketplaceSource !== "archive") {
    return { source: "command", command: pluginDirCommand(base, row.type, row.name, version) };
  }
  const detail = getVersion(db, row.id, version);
  if (!detail) throw new Error(`marketplace: version ${row.type}/${row.name}@${version} not found`);
  return {
    source: "archive",
    url: `${base}/api/v1/plugins/${row.type}/${row.name}/${version}.zip`,
    sha256: pluginZipSha256(config.dataDir, row, detail, config),
  };
}

export function buildMarketplace(
  db: Database,
  config: AppConfig,
  opts: { statuses: string[]; type?: string; viewer?: Viewer },
): MarketplaceResult {
  const statuses = opts.statuses.length > 0 ? opts.statuses : ["active"];
  const viewer = opts.viewer ?? null;
  const audience = viewer ? viewer.role + ":" + viewer.username : "anon";
  const cacheKey = `${marketplaceVersion}|${statuses.slice().sort().join(",")}|${opts.type ?? ""}|${audience}|${config.marketplaceName}|${config.baseUrl}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  const placeholders = statuses.map(() => "?").join(", ");
  const vis = visibleClause(viewer, "artifacts");
  const params: string[] = [...statuses, ...vis.params];
  let sql = `SELECT id, type, name, description, tags, latest_version, status
             FROM artifacts
             WHERE status IN (${placeholders})
               AND latest_version IS NOT NULL
               AND ${vis.sql}`;
  if (opts.type) {
    sql += " AND type = ?";
    params.push(opts.type);
  }
  sql += " ORDER BY type ASC, name ASC";

  const rows = (db.prepare(sql).all(...params) as ArtifactListRow[]).filter(
    (r) => !NOT_PLUGINS.has(r.type) && shellSafeEntry(r.type, r.name, r.latest_version!),
  );
  const base = config.baseUrl.replace(/\/$/, "");

  const plugins: MarketplacePlugin[] = rows.map((row) => {
    const version = row.latest_version!;
    const pname = pluginName(row.type, row.name);
    return {
      name: pname,
      description: row.description,
      version,
      category: row.type,
      keywords: parseTags(row.tags),
      source: pluginSource(db, config, base, row, version),
      homepage: `${base}/artifacts/${row.type}/${row.name}`,
    };
  });

  const body: MarketplaceDoc = {
    name: config.marketplaceName,
    owner: { name: config.marketplaceOwner },
    metadata: {
      description: `${config.marketplaceOwner} Claude Code marketplace`,
      version: String(marketplaceVersion),
      generated_at: new Date().toISOString(),
    },
    plugins,
  };

  const etagSource =
    plugins.map((p) => `${p.name}@${p.version}`).join("\n") +
    "\n" +
    config.marketplaceName +
    "\n" +
    String(marketplaceVersion) +
    "\n" +
    audience;
  const hash = createHash("sha256").update(etagSource, "utf8").digest("hex");
  const etag = `"${hash}"`;
  const json = JSON.stringify(body);
  const result: MarketplaceResult = { body, etag, json };
  cache.set(cacheKey, result);
  return result;
}
