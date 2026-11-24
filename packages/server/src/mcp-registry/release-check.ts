/**
 * Package release checks for mcp-server artifacts (mcp-version-tracking, decisions 2–4, 8).
 * A failed request is stored as a state; the background pass does not throw for network errors.
 */
import { semverGreater, semverValid } from "@skillforge/core";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db.ts";
import { notify } from "../notifications/notify.ts";
import { getArtifactById } from "../repo.ts";
import { cardOf, versionDescriptor, type McpCardDescriptor } from "./descriptor.ts";
import {
  normalizedPackageName,
  packageKey,
  packageVersion,
  registryTypeOfLauncher,
} from "./package-key.ts";
import { registryIndex } from "./usage.ts";
import type { McpSnapshotServer } from "../agents/mcp-body.ts";

const FETCH_TIMEOUT_MS = 30_000;
const MAX_BYTES = 8 * 1024 * 1024;
const VERSION_RE = /^[0-9A-Za-z.+!-]{1,128}$/;

export type ReleaseState =
  "up_to_date" | "update_available" | "failed" | "not_found" | "unsupported";

export type ReleaseInfo = {
  registry_type: string;
  identifier: string;
  registry_version: string | null;
  upstream_version: string | null;
  state: ReleaseState;
  state_detail: string | null;
  checked_at: string;
};

export function mcpReleaseSettings(config: AppConfig): {
  npmRegistryUrl: string;
  pypiUrl: string;
  enabled: boolean;
} {
  return {
    npmRegistryUrl: config.npmRegistryUrl ?? "https://registry.npmjs.org",
    pypiUrl: config.pypiUrl ?? "https://pypi.org",
    enabled: config.mcpReleaseCheck !== false,
  };
}

/** A pre-release is never treated as newer than the registry version. */
export function isPreRelease(version: string): boolean {
  if (version.includes("-")) return true;
  return /\d(?:a|b|rc|dev|alpha|beta|preview|pre|c)\d|\.dev\d/i.test(version);
}

/** Compare dotted numeric release segments; null when a side cannot be parsed. */
export function compareNumericRelease(a: string, b: string): number | null {
  const parts = (v: string): number[] | null => {
    const m = v.match(/^(\d+(?:\.\d+)*)/);
    if (!m) return null;
    return m[1]!.split(".").map(Number);
  };
  const pa = parts(a);
  const pb = parts(b);
  if (!pa || !pb) return null;
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

/** True when `upstream` is a newer non-pre-release than `registry`. */
export function isUpstreamNewer(upstream: string, registry: string, registryType: string): boolean {
  if (isPreRelease(upstream) || upstream === registry) return false;
  if (registryType === "pypi") {
    const cmp = compareNumericRelease(upstream, registry);
    return cmp === null ? true : cmp > 0;
  }
  if (semverValid(upstream) && semverValid(registry)) return semverGreater(upstream, registry);
  return true;
}

export function parseRegistryVersion(body: string, registryType: string): string | null {
  let obj: unknown;
  try {
    obj = JSON.parse(body);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const raw =
    registryType === "pypi"
      ? (obj as { info?: { version?: unknown } }).info?.version
      : (obj as { version?: unknown }).version;
  if (typeof raw !== "string" || !VERSION_RE.test(raw)) return null;
  return raw;
}

type Fetched =
  { ok: true; body: string } | { ok: false; state: "failed" | "not_found"; detail: string | null };

function isTimeout(e: unknown): boolean {
  return e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
}

function isRedirect(res: Response): boolean {
  return (
    res.status === 0 || res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)
  );
}

async function readCapped(res: Response): Promise<string | null> {
  const announced = Number(res.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > MAX_BYTES) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) {
    const text = await res.text();
    return Buffer.byteLength(text) > MAX_BYTES ? null : text;
  }
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchRegistry(url: string): Promise<Fetched> {
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
  } catch (e) {
    return { ok: false, state: "failed", detail: isTimeout(e) ? "timeout" : "network" };
  }
  if (isRedirect(res)) return { ok: false, state: "failed", detail: "redirect" };
  if (res.status === 404) return { ok: false, state: "not_found", detail: null };
  if (res.status !== 200) return { ok: false, state: "failed", detail: `http_${res.status}` };
  const body = await readCapped(res);
  if (body === null) return { ok: false, state: "failed", detail: "response_too_large" };
  return { ok: true, body };
}

/** Path of an npm package in a registry URL: one encoded segment, or @scope%2Fname. */
export function npmPackagePath(identifier: string): string {
  if (identifier.startsWith("@")) {
    const slash = identifier.indexOf("/");
    if (slash >= 0) {
      const scope = identifier.slice(1, slash);
      const name = identifier.slice(slash + 1);
      return `@${encodeURIComponent(scope)}%2F${encodeURIComponent(name)}`;
    }
  }
  return encodeURIComponent(identifier);
}

export function npmLatestUrl(base: string, identifier: string): string {
  return `${base}/${npmPackagePath(identifier)}/latest`;
}

function registryUrl(
  settings: { npmRegistryUrl: string; pypiUrl: string },
  type: string,
  id: string,
): string {
  if (type === "pypi") return `${settings.pypiUrl}/pypi/${normalizedPackageName("pypi", id)}/json`;
  return npmLatestUrl(settings.npmRegistryUrl, id);
}

function firstNpmOrPypi(card: McpCardDescriptor) {
  return card.packages.find(
    (p) => (p.registryType === "npm" || p.registryType === "pypi") && p.identifier,
  );
}

function firstOci(card: McpCardDescriptor) {
  return card.packages.find((p) => p.registryType === "oci" && p.identifier);
}

function saveRelease(db: Database, artifactId: string, release: ReleaseInfo): void {
  db.prepare(
    `INSERT INTO mcp_release_checks
      (artifact_id, registry_type, identifier, registry_version, upstream_version, state, state_detail, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (artifact_id) DO UPDATE SET
      registry_type = excluded.registry_type,
      identifier = excluded.identifier,
      registry_version = excluded.registry_version,
      upstream_version = excluded.upstream_version,
      state = excluded.state,
      state_detail = excluded.state_detail,
      checked_at = excluded.checked_at`,
  ).run(
    artifactId,
    release.registry_type,
    release.identifier,
    release.registry_version,
    release.upstream_version,
    release.state,
    release.state_detail,
    release.checked_at,
  );
}

/** True when this (artifact, event, version) has not been notified yet. */
export function recordMcpVersionNotice(
  db: Database,
  artifactId: string,
  kind: "release" | "drift",
  version: string,
): boolean {
  const result = db
    .prepare(
      "INSERT OR IGNORE INTO mcp_version_notices (artifact_id, kind, version, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(artifactId, kind, version, new Date().toISOString());
  return result.changes > 0;
}

export function mcpVersionTitle(
  artifactName: string,
  event: "release" | "drift",
  version: string,
  registryVersion: string,
): string {
  if (event === "release") {
    return `mcp-server/${artifactName}: ${version} is out at the source (the registry has ${registryVersion})`;
  }
  return `mcp-server/${artifactName}: agent snapshots have version ${version}, the registry has ${registryVersion}`;
}

function notifyMcpVersion(
  db: Database,
  artifactId: string,
  event: "release" | "drift",
  version: string,
  registryVersion: string,
): void {
  const artifact = getArtifactById(db, artifactId);
  if (!artifact) return;
  if (!recordMcpVersionNotice(db, artifactId, event, version)) return;
  notify(db, {
    kind: "mcp_version",
    artifact,
    actor: "system",
    title: mcpVersionTitle(artifact.name, event, version, registryVersion),
    meta: { event, version, registry_version: registryVersion },
  });
}

export function readRelease(db: Database, artifactId: string): ReleaseInfo | null {
  const row = db
    .prepare(
      `SELECT registry_type, identifier, registry_version, upstream_version, state, state_detail, checked_at
       FROM mcp_release_checks WHERE artifact_id = ?`,
    )
    .get(artifactId) as ReleaseInfo | undefined;
  return row ?? null;
}

/** Card `release` field: null when the version has no package or has never been checked. */
export function cardRelease(
  db: Database,
  artifactId: string,
  card: McpCardDescriptor,
): ReleaseInfo | null {
  const hasPackage = card.packages.some((p) => Boolean(p.registryType && p.identifier));
  if (!hasPackage) return null;
  return readRelease(db, artifactId);
}

function unsupportedRelease(
  pkg: { registryType: string; identifier: string },
  checkedAt: string,
): ReleaseInfo {
  return {
    registry_type: pkg.registryType,
    identifier: pkg.identifier,
    registry_version: packageVersion(pkg.registryType, pkg.identifier, null),
    upstream_version: null,
    state: "unsupported",
    state_detail: null,
    checked_at: checkedAt,
  };
}

async function queryPackage(
  settings: { npmRegistryUrl: string; pypiUrl: string },
  pkg: { registryType: string; identifier: string; version: string | null },
  checkedAt: string,
): Promise<ReleaseInfo> {
  const registryVersion = packageVersion(pkg.registryType, pkg.identifier, pkg.version);
  const base: Omit<ReleaseInfo, "state" | "state_detail" | "upstream_version"> = {
    registry_type: pkg.registryType,
    identifier: pkg.identifier,
    registry_version: registryVersion,
    checked_at: checkedAt,
  };
  const fetched = await fetchRegistry(registryUrl(settings, pkg.registryType, pkg.identifier));
  if (!fetched.ok) {
    return { ...base, upstream_version: null, state: fetched.state, state_detail: fetched.detail };
  }
  const upstream = parseRegistryVersion(fetched.body, pkg.registryType);
  if (upstream === null) {
    return { ...base, upstream_version: null, state: "failed", state_detail: "bad_response" };
  }
  const newer = registryVersion
    ? isUpstreamNewer(upstream, registryVersion, pkg.registryType)
    : true;
  return {
    ...base,
    upstream_version: upstream,
    state: newer ? "update_available" : "up_to_date",
    state_detail: null,
  };
}

/**
 * Check one artifact's current version. Returns null when there is no npm, pypi or OCI package.
 * Network failures become a stored state; this function does not throw for them.
 */
export async function checkRelease(
  db: Database,
  config: AppConfig,
  artifactId: string,
): Promise<ReleaseInfo | null> {
  const artifact = getArtifactById(db, artifactId);
  if (!artifact?.latest_version || !config.dataDir) return null;
  const d = versionDescriptor(db, config.dataDir, artifact.id, artifact.latest_version);
  if (!d) return null;
  const card = cardOf(d.obj);
  const checkedAt = new Date().toISOString();
  const pkg = firstNpmOrPypi(card);
  const oci = firstOci(card);
  let release: ReleaseInfo;
  if (pkg) release = await queryPackage(mcpReleaseSettings(config), pkg, checkedAt);
  else if (oci) release = unsupportedRelease(oci, checkedAt);
  else return null;
  saveRelease(db, artifactId, release);
  if (
    release.state === "update_available" &&
    release.upstream_version &&
    release.registry_version
  ) {
    notifyMcpVersion(db, artifactId, "release", release.upstream_version, release.registry_version);
  }
  return release;
}

/** Background pass: every due mcp-server; a failure on one artifact does not stop the others. */
export async function checkAllReleases(
  db: Database,
  config: AppConfig,
  log?: (msg: string) => void,
  due: (row: { last_checked_at: string | null }) => boolean = () => true,
): Promise<void> {
  if (!mcpReleaseSettings(config).enabled) return;
  const rows = db
    .prepare(
      "SELECT id FROM artifacts WHERE type = 'mcp-server' AND purged_at IS NULL AND latest_version IS NOT NULL",
    )
    .all() as Array<{ id: string }>;
  for (const { id } of rows) {
    const prev = db
      .prepare("SELECT checked_at AS last_checked_at FROM mcp_release_checks WHERE artifact_id = ?")
      .get(id) as { last_checked_at: string | null } | undefined;
    if (!due({ last_checked_at: prev?.last_checked_at ?? null })) continue;
    try {
      await checkRelease(db, config, id);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log?.(`mcp_release_check_failed ${id}: ${message}`);
    }
  }
}

/**
 * After a successful snapshot store: one drift notice per new (artifact, observed version).
 * Must not throw — the upload already succeeded.
 */
export function notifyMcpDrifts(
  db: Database,
  dataDir: string | undefined,
  servers: McpSnapshotServer[],
  log?: (msg: string) => void,
): void {
  try {
    const index = registryIndex(db, dataDir);
    for (const s of servers) {
      if (!s.package || !s.pinned || !s.version) continue;
      const key = packageKey(registryTypeOfLauncher(s.launcher), s.package);
      const link = index.packages.get(key);
      if (!link?.version || link.version === s.version) continue;
      const artifact = db
        .prepare(
          "SELECT id FROM artifacts WHERE type = 'mcp-server' AND name = ? AND purged_at IS NULL",
        )
        .get(link.name) as { id: string } | undefined;
      if (!artifact) continue;
      notifyMcpVersion(db, artifact.id, "drift", s.version, link.version);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log?.(`mcp_drift_notice_failed: ${message}`);
  }
}
