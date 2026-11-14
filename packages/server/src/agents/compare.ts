import type { Database } from "../db.ts";
import { getArtifactByTypeName, listArtifacts, listVersions, type VersionDetail } from "../repo.ts";
import type { AgentItemRow, AgentRow } from "./store.ts";
import { listAgentItems } from "./store.ts";
import { canView, type Viewer } from "../visibility/index.ts";
import type { SourceMarker } from "./source-marker.ts";

export type CompareSummary = {
  local_only: number;
  in_sync: number;
  outdated: number;
  modified: number;
  registry_only: number;
};

export type CompareItem = {
  key: string;
  type: string;
  name: string;
  status: "local_only" | "in_sync" | "outdated" | "modified";
  root: string;
  local: { version: string | null; digest: string; files: number };
  registry: {
    status: string;
    latest_version: string | null;
    latest_digest: string | null;
    matched_version: string | null;
  } | null;
  changed_files?: string[];
  translated?: boolean;
  /** agent-source-marker: the visible registry artifact this file was built from. */
  source?: SourceMarker;
};

export type RegistryOnlyItem = {
  type: string;
  name: string;
  status: string;
  latest_version: string | null;
  description: string;
};

export type CompareResult = {
  summary: CompareSummary;
  items: CompareItem[];
  registry_only: RegistryOnlyItem[];
};

function changedFiles(
  local: Array<{ path: string; sha256: string }>,
  base: Array<{ path: string; sha256: string }>,
): string[] {
  const localMap = new Map(local.map((f) => [f.path, f.sha256]));
  const baseMap = new Map(base.map((f) => [f.path, f.sha256]));
  const paths = new Set<string>([...localMap.keys(), ...baseMap.keys()]);
  const out: string[] = [];
  for (const p of paths) {
    if (localMap.get(p) !== baseMap.get(p)) out.push(p);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function withTranslated(item: AgentItemRow, result: CompareItem): CompareItem {
  if (item.translated) result.translated = true;
  return result;
}

function localOnlyItem(item: AgentItemRow): CompareItem {
  return withTranslated(item, {
    key: item.key,
    type: item.type,
    name: item.name,
    status: "local_only",
    root: item.root,
    local: { version: item.version, digest: item.digest, files: item.files.length },
    registry: null,
  });
}

function pickLatestVersion(
  versions: VersionDetail[],
  latestVersion: string | null | undefined,
): VersionDetail | null {
  if (!latestVersion) return versions[0] ?? null;
  return versions.find((v) => v.version === latestVersion) ?? versions[0] ?? null;
}

function compareStatus(
  itemDigest: string,
  latestDigest: string | null,
  matched: VersionDetail | null,
): CompareItem["status"] {
  if (latestDigest && itemDigest === latestDigest) return "in_sync";
  if (matched) return "outdated";
  return "modified";
}

function modifiedChangedFiles(
  item: AgentItemRow,
  versions: VersionDetail[],
  latestVer: VersionDetail | null,
): string[] {
  let base: VersionDetail | null = null;
  if (item.version) {
    base = versions.find((v) => v.version === item.version) ?? null;
  }
  if (!base) base = latestVer;
  if (base) return changedFiles(item.files, base.files);
  return item.files.map((f) => f.path).sort((a, b) => a.localeCompare(b));
}

/**
 * agent-source-marker: a file built from a visible registry artifact is compared with that artifact by the version
 * in its marker (its content differs from the source by design). null: no marker or the source is not visible.
 */
function compareBuilt(db: Database, item: AgentItemRow, viewer: Viewer): CompareItem | null {
  const src = item.source;
  if (!src) return null;
  const art = getArtifactByTypeName(db, src.type, src.name);
  if (!art || art.purged_at || !canView(db, viewer, art)) return null;
  const versions = listVersions(db, art.id).filter((v) => !v.purged);
  const known = versions.some((v) => v.version === src.version);
  const status = src.version === art.latest_version ? "in_sync" : known ? "outdated" : "modified";
  return withTranslated(item, {
    key: item.key,
    type: item.type,
    name: item.name,
    status,
    root: item.root,
    local: { version: item.version, digest: item.digest, files: item.files.length },
    registry: {
      status: art.status,
      latest_version: art.latest_version,
      latest_digest: pickLatestVersion(versions, art.latest_version)?.digest ?? null,
      matched_version: known ? src.version : null,
    },
    source: { ...src },
  });
}

function compareOne(db: Database, item: AgentItemRow, viewer: Viewer): CompareItem {
  const built = compareBuilt(db, item, viewer);
  if (built) return built;
  const art = getArtifactByTypeName(db, item.type, item.name);
  if (!art || art.purged_at || !canView(db, viewer, art)) return localOnlyItem(item);

  const versions = listVersions(db, art.id).filter((v) => !v.purged);
  const latestVer = pickLatestVersion(versions, art.latest_version);
  const latestDigest = latestVer?.digest ?? null;
  const matched = versions.find((v) => v.digest === item.digest) ?? null;
  const status = compareStatus(item.digest, latestDigest, matched);

  const result: CompareItem = {
    key: item.key,
    type: item.type,
    name: item.name,
    status,
    root: item.root,
    local: { version: item.version, digest: item.digest, files: item.files.length },
    registry: {
      status: art.status,
      latest_version: art.latest_version,
      latest_digest: latestDigest,
      matched_version: matched ? matched.version : null,
    },
  };

  if (status === "modified") {
    result.changed_files = modifiedChangedFiles(item, versions, latestVer);
  }

  return withTranslated(item, result);
}

export function compareAgent(
  db: Database,
  agent: AgentRow,
  opts: { registryStatus?: string; viewer?: Viewer } = {},
): CompareResult {
  const viewer = opts.viewer ?? null;
  const items = listAgentItems(db, agent.id).map((it) => compareOne(db, it, viewer));
  const keys = new Set(items.map((i) => i.key));
  for (const i of items) if (i.source) keys.add(`${i.source.type}/${i.source.name}`);

  const registryStatus = opts.registryStatus ?? "active";
  const registry_only: RegistryOnlyItem[] = [];

  if (registryStatus === "all") {
    const listed = listArtifacts(db, { limit: 10000, offset: 0, viewer });
    for (const a of listed.items) {
      if (a.status === "retired") continue;
      const key = `${a.type}/${a.name}`;
      if (keys.has(key)) continue;
      registry_only.push({
        type: a.type,
        name: a.name,
        status: a.status,
        latest_version: a.latest_version,
        description: a.description,
      });
    }
  } else {
    const listed = listArtifacts(db, { status: registryStatus, limit: 10000, offset: 0, viewer });
    for (const a of listed.items) {
      const key = `${a.type}/${a.name}`;
      if (keys.has(key)) continue;
      registry_only.push({
        type: a.type,
        name: a.name,
        status: a.status,
        latest_version: a.latest_version,
        description: a.description,
      });
    }
  }

  registry_only.sort((a, b) => `${a.type}/${a.name}`.localeCompare(`${b.type}/${b.name}`));

  const summary: CompareSummary = {
    local_only: items.filter((i) => i.status === "local_only").length,
    in_sync: items.filter((i) => i.status === "in_sync").length,
    outdated: items.filter((i) => i.status === "outdated").length,
    modified: items.filter((i) => i.status === "modified").length,
    registry_only: registry_only.length,
  };

  return { summary, items, registry_only };
}
