import { successorsOf } from "../replacements.ts";
import { applyLayers, fetchLayers, layersDigest, type Layer } from "../overlays.ts";
import { fetchAssignments, keyOf, type Assignments } from "../assignments.ts";
import { verifyBundle, type VersionMeta } from "../verify.ts";
import fs from "node:fs";
import path from "node:path";
import {
  isArtifactType,
  isDowngrade,
  parseVersionSpec,
  runtimeDef,
  semverGreater,
  runtimeSupport,
  translateAgent,
  translateCommand,
  translateRule,
  type AgentTranslateMethod,
  type RuntimeDef,
  type RuntimeInstallMethod,
  type RuntimeScope,
} from "@skillforge/core";
import {
  assertRealPathsInside,
  assertSafeRelPath,
  unzipBundle,
  type UnzippedFile,
} from "../bundle.ts";
import type { SkillforgeClient } from "../client.ts";
import { ApiError } from "../client.ts";
import { EXIT, type ExitCode } from "../exit.ts";
import {
  invalidPinWarning,
  lockPathFor,
  pruneEmptyDirs,
  readLock,
  safeLockPaths,
  sha256Hex,
  writeLock,
  type LockArtifact,
  type LockFile,
} from "../lock.ts";
import type { AppContext } from "../context.ts";
import { requireClient, setExit } from "../context.ts";
import { parseTypeName } from "./info.ts";
import { fetchAllArtifacts } from "./list.ts";
import { resolveTarget, type TargetFlags } from "../runtime.ts";

export type InstallFlags = TargetFlags & {
  force?: boolean;
  allowDowngrade?: boolean;
  allowRisky?: boolean;
};

/** content-security-scan: a version whose scan failed is not installed without --allow-risky. */
export class RiskyError extends ApiError {
  constructor(key: string, version: string, rules: string[]) {
    super(
      `${key}@${version}: security scan failed (${rules.join(", ")}); review it, then use --allow-risky`,
      EXIT.VALIDATION,
    );
    this.name = "RiskyError";
  }
}

type ScanView = {
  verdict?: string;
  findings?: Array<{ rule: string; severity: string; mention?: boolean }>;
};

async function checkSecurity(
  ctx: AppContext,
  client: SkillforgeClient,
  key: string,
  version: string,
  flags: { allowRisky?: boolean; quiet?: boolean },
): Promise<VersionMeta> {
  const res = await client.request(
    "GET",
    `/api/v1/artifacts/${key}/versions/${encodeURIComponent(version)}`,
  );
  if (!res.ok) throw client.errorFromResult(res);
  const meta = res.data as VersionMeta & { quality?: { security?: ScanView } | null };
  const scan = meta.quality?.security;
  if (!scan || scan.verdict === "pass") return meta;
  const rules = [...new Set((scan.findings ?? []).filter((f) => !f.mention).map((f) => f.rule))];
  if (scan.verdict === "fail" && !flags.allowRisky) throw new RiskyError(key, version, rules);
  if (!flags.quiet) {
    ctx.out.error(
      `warning: ${key}@${version} security scan: ${scan.verdict} (${rules.join(", ")})`,
    );
  }
  return meta;
}

export class DowngradeError extends ApiError {
  constructor(installed: string, wanted: string) {
    super(`would downgrade ${installed} -> ${wanted} (use --allow-downgrade)`, EXIT.LOCAL_CHANGES);
    this.name = "DowngradeError";
  }
}

function purgedError(): ApiError {
  return new ApiError("version purged", EXIT.NOT_FOUND, 410, { error: "purged" });
}

async function isPurgedVersion(
  client: SkillforgeClient,
  key: string,
  version: string,
): Promise<boolean> {
  const res = await client.request(
    "GET",
    `/api/v1/artifacts/${key}/versions/${encodeURIComponent(version)}`,
  );
  return res.status === 410 && (res.data as { error?: unknown } | undefined)?.error === "purged";
}

export type InstallResult =
  | { status: "installed"; key: string; version: string }
  | { status: "updated"; key: string; version: string }
  | { status: "up_to_date"; key: string; version: string };

function checkLocalChanges(into: string, entry: LockArtifact | undefined): string[] {
  if (!entry) return [];
  safeLockPaths(entry, into);
  const dirty: string[] = [];
  for (const [rel, expected] of Object.entries(entry.files)) {
    const abs = path.join(into, ...rel.split("/"));
    if (!fs.existsSync(abs)) continue;
    const actual = sha256Hex(fs.readFileSync(abs));
    if (actual !== expected) dirty.push(rel);
  }
  return dirty;
}

function collectUnmanaged(
  into: string,
  bundlePaths: string[],
  entry: LockArtifact | undefined,
): string[] {
  const unmanaged: string[] = [];
  for (const rel of bundlePaths) {
    const abs = assertSafeRelPath(rel, into);
    if (!fs.existsSync(abs)) continue;
    const managed = entry?.files?.[rel] !== undefined;
    if (!managed) unmanaged.push(rel);
  }
  return unmanaged;
}

async function latestFromCard(
  client: SkillforgeClient,
  type: string,
  name: string,
): Promise<{ version: string; digest: string }> {
  const cardRes = await client.request("GET", `/api/v1/artifacts/${type}/${name}`);
  if (!cardRes.ok) throw client.errorFromResult(cardRes);
  const card = cardRes.data as { latest: { version: string; digest: string } | null };
  if (!card.latest?.version) {
    throw new ApiError("not found: no latest version", EXIT.NOT_FOUND, 404);
  }
  return { version: card.latest.version, digest: card.latest.digest };
}

/** Server-side resolution of a version spec (`latest`, `beta`, exact, range). */
export async function resolveSpecVersion(
  client: SkillforgeClient,
  type: string,
  name: string,
  spec: string,
): Promise<{ version: string; digest: string }> {
  const res = await client.request(
    "GET",
    `/api/v1/artifacts/${type}/${name}/resolve?spec=${encodeURIComponent(spec)}`,
  );
  if (res.status === 410 && (res.data as { error?: unknown } | undefined)?.error === "purged")
    throw purgedError();
  if (!res.ok) throw client.errorFromResult(res);
  const data = res.data as { version?: unknown; digest?: unknown } | undefined;
  const version = data?.version;
  const digest = data?.digest;
  if (
    typeof version !== "string" ||
    typeof digest !== "string" ||
    parseVersionSpec(version)?.kind !== "exact"
  ) {
    throw new ApiError("invalid resolve response from registry", EXIT.VALIDATION);
  }
  return { version, digest };
}

export function isSpecInvalidError(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 400) return false;
  const body = err.body as { error?: unknown } | undefined;
  return body?.error === "spec_invalid";
}

async function resolveVersionDetail(
  client: SkillforgeClient,
  type: string,
  name: string,
  spec: string | undefined,
): Promise<{ version: string; digest: string }> {
  if (spec === undefined || spec === "latest") return latestFromCard(client, type, name);
  return resolveSpecVersion(client, type, name, spec);
}

type FileMethod = Exclude<RuntimeInstallMethod, "plugin" | "settings">;

const AGENT_METHODS: readonly FileMethod[] = ["codex-toml", "opencode-agent", "cursor-agent"];

function isAgentMethod(method: FileMethod): method is AgentTranslateMethod {
  return AGENT_METHODS.includes(method);
}

async function marketplaceCommand(
  client: SkillforgeClient,
  type: string,
  name: string,
): Promise<string> {
  const cardRes = await client.request("GET", `/api/v1/artifacts/${type}/${name}`);
  if (!cardRes.ok) throw client.errorFromResult(cardRes);
  const card = cardRes.data as {
    install?: { plugin_name?: string; marketplace_name?: string };
  };
  const pname = card.install?.plugin_name ?? name;
  const market = card.install?.marketplace_name ?? "marketplace";
  return `/plugin install ${pname}@${market}`;
}

/** Hooks and plugins are never unpacked as files: Claude Code loads them only as marketplace plugins. */
async function marketplaceOnly(
  client: SkillforgeClient,
  runtime: RuntimeDef,
  scope: RuntimeScope,
  type: "hook" | "plugin",
  name: string,
): Promise<ApiError> {
  const command = await marketplaceCommand(client, type, name);
  const support = runtimeSupport(runtime, type, scope);
  const lead = !support.supported
    ? `${type}/${name}: ${support.reason}`
    : type === "plugin"
      ? "Claude Code plugins are installed via marketplace"
      : "hooks are installed as Claude Code plugins via marketplace (Claude Code does not load hooks from .claude/hooks)";
  return new ApiError(`${lead}: ${command}`, EXIT.VALIDATION);
}

function fileMethod(
  runtime: RuntimeDef,
  scope: RuntimeScope,
  type: string,
  name: string,
): FileMethod {
  if (!isArtifactType(type)) return "files";
  const support = runtimeSupport(runtime, type, scope);
  if (!support.supported) {
    throw new ApiError(`${type}/${name}: ${support.reason}`, EXIT.VALIDATION);
  }
  const method = support.method;
  if (method === "plugin" || method === "settings") {
    throw new ApiError(`${type}/${name}: not installable as files`, EXIT.VALIDATION);
  }
  return method;
}

/** rule-artifacts: a rule for Cursor becomes rules/<name>.mdc with Cursor's frontmatter. */
function translateRuleBundle(files: UnzippedFile[], name: string): UnzippedFile[] {
  const main = `rules/${name}.md`;
  const file = files.find((f) => f.path === main);
  if (!file) throw new Error(`bundle has no ${main} to translate`);
  const t = translateRule(name, file.content.toString("utf8"));
  return [{ path: t.path, content: Buffer.from(t.content, "utf8") }];
}

function translateBundle(
  ctx: AppContext,
  files: UnzippedFile[],
  name: string,
  method: FileMethod,
): UnzippedFile[] {
  if (method === "files") return files;
  if (method === "cursor-rule") return translateRuleBundle(files, name);
  const agent = isAgentMethod(method);
  const main = `${agent ? "agents" : "commands"}/${name}.md`;
  if (!files.some((f) => f.path === main)) {
    throw new Error(`bundle has no ${main} to translate`);
  }
  return files.map((f) => {
    if (f.path !== main) return f;
    const text = f.content.toString("utf8");
    const t = isAgentMethod(method)
      ? translateAgent(method, name, text)
      : translateCommand(method, name, text);
    for (const w of t.warnings) ctx.out.error(`warning: ${w}`);
    return { path: t.path, content: Buffer.from(t.content, "utf8") };
  });
}

function removeFiles(into: string, absPaths: readonly string[]): void {
  for (const abs of absPaths) {
    if (fs.existsSync(abs)) {
      fs.unlinkSync(abs);
      pruneEmptyDirs(abs, into);
    }
  }
}

async function resolveInstallTarget(
  ctx: AppContext,
  client: SkillforgeClient,
  type: string,
  name: string,
  key: string,
  specArg: string | undefined,
  existing: LockArtifact | undefined,
  quiet: boolean,
): Promise<{ version: string; digest: string; pin: string | undefined }> {
  let pin = specArg === undefined ? existing?.pin : specArg === "latest" ? undefined : specArg;
  let resolved: { version: string; digest: string };
  try {
    resolved = await resolveVersionDetail(client, type, name, pin);
  } catch (err) {
    if (specArg !== undefined || pin === undefined || !isSpecInvalidError(err)) throw err;
    if (!quiet) ctx.out.error(invalidPinWarning(key));
    pin = undefined;
    resolved = await resolveVersionDetail(client, type, name, undefined);
  }
  return { ...resolved, pin };
}

function assertNoLocalChanges(
  into: string,
  existing: LockArtifact | undefined,
  force: boolean | undefined,
): void {
  const dirty = checkLocalChanges(into, existing);
  if (dirty.length > 0 && !force) {
    throw new ApiError(
      `local changes detected in ${dirty.join(", ")}; use --force to overwrite`,
      EXIT.LOCAL_CHANGES,
    );
  }
}

function maybeUpdateLockMetaOnly(
  into: string,
  lock: LockFile,
  key: string,
  existing: LockArtifact,
  target: ReturnType<typeof resolveTarget>,
  pin: string | undefined,
  version: string,
  quiet: boolean,
  ctx: AppContext,
): InstallResult | null {
  const dirty = checkLocalChanges(into, existing);
  if (dirty.length !== 0) return null;
  const runtimeField = target.runtime ? { runtime: target.runtime.id } : {};
  const pinField = pin !== undefined ? { pin } : {};
  const runtimeChanged = Boolean(target.runtime) && existing.runtime !== target.runtime?.id;
  if (runtimeChanged || existing.pin !== pin) {
    const { pin: _previousPin, ...unpinned } = existing;
    assertRealPathsInside(into, [lockPathFor(into)]);
    writeLock(into, {
      registry: lock.registry,
      artifacts: {
        ...lock.artifacts,
        [key]: { ...unpinned, ...runtimeField, ...pinField },
      },
    });
  }
  if (!quiet && !ctx.out.json) ctx.out.write(`${key}@${version} up to date`);
  return { status: "up_to_date", key, version };
}

function collectStalePaths(
  into: string,
  existing: LockArtifact | undefined,
  files: UnzippedFile[],
  version: string,
  digest: string,
  force: boolean | undefined,
): string[] {
  const stale: string[] = [];
  if (existing && (existing.version !== version || existing.digest !== digest || force)) {
    safeLockPaths(existing, into);
    const newSet = new Set(files.map((f) => f.path));
    for (const rel of Object.keys(existing.files)) {
      if (!newSet.has(rel)) stale.push(path.join(into, ...rel.split("/")));
    }
  }
  return stale;
}

function writeInstalledFiles(
  into: string,
  files: UnzippedFile[],
  stale: string[],
): Record<string, string> {
  const writes = files.map((f) => ({ file: f, abs: assertSafeRelPath(f.path, into) }));
  assertRealPathsInside(into, [...stale, ...writes.map((w) => w.abs), lockPathFor(into)]);
  removeFiles(into, stale);
  const fileMap: Record<string, string> = {};
  for (const { file, abs } of writes) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, file.content);
    fileMap[file.path] = sha256Hex(file.content);
  }
  return fileMap;
}

function validateInstallSpec(
  type: string,
  name: string,
  key: string,
  specArg: string | undefined,
  runtime: RuntimeDef,
): void {
  if (specArg !== undefined && parseVersionSpec(specArg) === null) {
    throw new ApiError(`invalid version spec for ${key}: ${specArg}`, EXIT.VALIDATION);
  }
  if (type === "settings" && runtime.id === "claude-code") {
    throw new ApiError(
      `settings profiles are applied with: skillforge settings apply ${type}/${name} --scope <scope>`,
      EXIT.VALIDATION,
    );
  }
}

async function downloadBundleFiles(
  ctx: AppContext,
  client: SkillforgeClient,
  release: {
    type: string;
    name: string;
    version: string;
    meta: VersionMeta;
    registryUrl: string;
    layers: Layer[];
  },
  into: string,
  method: FileMethod,
  quiet: boolean,
): Promise<UnzippedFile[]> {
  const { type, name, version } = release;
  const zipRes = await client.request(
    "GET",
    `/api/v1/artifacts/${type}/${name}/versions/${version}/bundle.zip`,
    { raw: true, accept: "application/zip" },
  );
  if (zipRes.status === 410) throw purgedError();
  if (!zipRes.ok) throw client.errorFromResult(zipRes);
  const zipBuf = zipRes.data as Buffer;
  const raw = unzipBundle(new Uint8Array(zipBuf), into);
  const signed = await verifyBundle(client, release.registryUrl, type, name, release.meta, raw);
  if (!signed && !quiet) {
    ctx.out.error(`warning: ${type}/${name}@${version} is not signed by the registry`);
  }
  // artifact-overlays: the layers go over the verified files, before translation for the agent.
  const layered = applyLayers(raw, release.layers, (m) => {
    if (!quiet) ctx.out.error(m);
  });
  return translateBundle(ctx, layered, name, method);
}

/** Layers for this install and the lock field that records them. */
async function overlayState(client: SkillforgeClient, type: string, name: string) {
  const layers = await fetchLayers(client, type, name);
  const digest = layersDigest(layers);
  return { layers, digest, field: digest ? { overlays: digest } : {} };
}

function assertUnmanagedOk(
  into: string,
  files: UnzippedFile[],
  existing: LockArtifact | undefined,
  force: boolean | undefined,
): void {
  const unmanaged = collectUnmanaged(
    into,
    files.map((f) => f.path),
    existing,
  );
  if (unmanaged.length > 0 && !force) {
    throw new ApiError(
      `refusing to overwrite files not managed by SkillForge: ${unmanaged.join(", ")}; use --force`,
      EXIT.LOCAL_CHANGES,
    );
  }
}

function handleSameVersion(
  into: string,
  lock: LockFile,
  key: string,
  existing: LockArtifact,
  target: ReturnType<typeof resolveTarget>,
  pin: string | undefined,
  version: string,
  digest: string,
  flags: InstallFlags,
  quiet: boolean,
  ctx: AppContext,
): InstallResult | "continue" {
  if (existing.version !== version || existing.digest !== digest) {
    assertNoLocalChanges(into, existing, flags.force);
    return "continue";
  }
  const upToDate = maybeUpdateLockMetaOnly(
    into,
    lock,
    key,
    existing,
    target,
    pin,
    version,
    quiet,
    ctx,
  );
  if (upToDate) return upToDate;
  assertNoLocalChanges(into, existing, flags.force);
  return "continue";
}

function commitInstall(
  into: string,
  registryUrl: string,
  lock: LockFile,
  key: string,
  existing: LockArtifact | undefined,
  version: string,
  digest: string,
  fileMap: Record<string, string>,
  runtimeField: { runtime?: string },
  pinField: { pin?: string },
  quiet: boolean,
  ctx: AppContext,
): InstallResult {
  const next: LockFile = {
    registry: registryUrl,
    artifacts: { ...lock.artifacts },
  };
  const wasPresent = Boolean(existing);
  next.artifacts[key] = {
    version,
    digest,
    files: fileMap,
    installed_at: new Date().toISOString(),
    ...runtimeField,
    ...pinField,
  };
  writeLock(into, next);

  const status: InstallResult["status"] = wasPresent ? "updated" : "installed";
  if (!quiet && !ctx.out.json) {
    ctx.out.write(`${status === "installed" ? "Installed" : "Updated"} ${key}@${version}`);
  }
  return { status, key, version };
}

export async function installOne(
  ctx: AppContext,
  client: SkillforgeClient,
  registryUrl: string,
  spec: string,
  flags: InstallFlags,
  quiet = false,
): Promise<InstallResult> {
  const target = resolveTarget(flags);
  const into = target.base;
  const runtime = target.runtime ?? runtimeDef("claude-code");
  const { type, name, version: specArg } = parseTypeName(spec);
  const key = `${type}/${name}`;
  validateInstallSpec(type, name, key, specArg, runtime);

  if (type === "plugin" || type === "hook") {
    throw await marketplaceOnly(client, runtime, target.scope, type, name);
  }

  const method = fileMethod(runtime, target.scope, type, name);
  const lock = readLock(into, quiet ? undefined : (k) => ctx.out.error(invalidPinWarning(k)));
  const existing = lock.artifacts[key];
  const { version, digest, pin } = await resolveInstallTarget(
    ctx,
    client,
    type,
    name,
    key,
    specArg,
    existing,
    quiet,
  );

  if (existing && !flags.allowDowngrade && isDowngrade(existing.version, version)) {
    throw new DowngradeError(existing.version, version);
  }
  const meta = await checkSecurity(ctx, client, key, version, {
    allowRisky: flags.allowRisky,
    quiet,
  });

  const runtimeField = target.runtime ? { runtime: target.runtime.id } : {};
  const pinField = pin !== undefined ? { pin } : {};
  const overlays = await overlayState(client, type, name);

  // A changed layer is a reason to reinstall even the same version.
  if (existing && existing.overlays === overlays.digest) {
    const same = handleSameVersion(
      into,
      lock,
      key,
      existing,
      target,
      pin,
      version,
      digest,
      flags,
      quiet,
      ctx,
    );
    if (same !== "continue") return same;
  }

  const files = await downloadBundleFiles(
    ctx,
    client,
    { type, name, version, meta, registryUrl, layers: overlays.layers },
    into,
    method,
    quiet,
  );
  assertUnmanagedOk(into, files, existing, flags.force);
  const stale = collectStalePaths(into, existing, files, version, digest, flags.force);
  const fileMap = writeInstalledFiles(into, files, stale);
  return commitInstall(
    into,
    registryUrl,
    lock,
    key,
    existing,
    version,
    digest,
    fileMap,
    { ...runtimeField, ...overlays.field },
    pinField,
    quiet,
    ctx,
  );
}

type Declared = { runtime: string; min_version: string | null };

/**
 * artifact-agent-compat: the author's agent declaration is advice, not a ban — install proceeds and the exit code is
 * unchanged; stderr says when the target agent is not in the list, or which version it was declared for.
 */
async function declarationNotice(
  ctx: AppContext,
  client: SkillforgeClient,
  spec: string,
  flags: InstallFlags,
): Promise<void> {
  if (ctx.out.json) return;
  const { type, name } = parseTypeName(spec);
  const runtime = flags.into !== undefined ? "claude-code" : (flags.runtime ?? "claude-code");
  const res = await client.request("GET", `/api/v1/artifacts/${type}/${name}`);
  if (!res.ok) return;
  const declared =
    (res.data as { artifact?: { agents?: { declared?: Declared[] } } }).artifact?.agents
      ?.declared ?? [];
  if (!declared.length) return;
  const mine = declared.find((d) => d.runtime === runtime);
  if (!mine) {
    const list = declared
      .map((d) => (d.min_version ? `${d.runtime}>=${d.min_version}` : d.runtime))
      .join(", ");
    ctx.out.error(
      `warning: ${type}/${name} is declared for ${list}; ${runtime} is not in the list`,
    );
  } else if (mine.min_version) {
    ctx.out.error(`note: declared for ${runtime} >= ${mine.min_version}`);
  }
}

export async function runInstall(
  ctx: AppContext,
  spec: string,
  flags: InstallFlags,
): Promise<void> {
  const { client, url } = requireClient(ctx);
  const target = parseTypeName(spec.split("@")[0]!);
  const successor = (await successorsOf(client, [`${target.type}/${target.name}`]))
    .values()
    .next().value;
  if (successor)
    ctx.out.error(`warning: ${target.type}/${target.name} is replaced by ${successor}`);
  const unavailable = (await fetchAssignments(client)).unavailable.map(keyOf);
  if (unavailable.includes(`${target.type}/${target.name}`) && !flags.force) {
    throw new ApiError(
      `${target.type}/${target.name} is not available for your teams (use --force to install anyway)`,
      EXIT.VALIDATION,
    );
  }
  await declarationNotice(ctx, client, spec, flags);
  const result = await installOne(ctx, client, url, spec, flags);
  if (ctx.out.json) {
    ctx.out.printJson(result);
  }
  setExit(EXIT.OK);
}

/** A required artifact stays: uninstalling it needs --force (team-availability). */
async function refuseRequired(ctx: AppContext, key: string, force: boolean | undefined) {
  if (force) return;
  const { client } = requireClient(ctx);
  const required = (await fetchAssignments(client)).required.find((a) => keyOf(a) === key);
  if (required) {
    throw new ApiError(
      `${key} is required for your team ${required.team} (use --force to remove it anyway)`,
      EXIT.VALIDATION,
    );
  }
}

export async function runUninstall(
  ctx: AppContext,
  spec: string,
  flags: TargetFlags & { force?: boolean },
): Promise<void> {
  const into = resolveTarget(flags).base;
  const { type, name } = parseTypeName(spec);
  const key = `${type}/${name}`;
  await refuseRequired(ctx, key, flags.force);
  const lock = readLock(into);
  const entry = lock.artifacts[key];
  if (!entry) {
    throw new ApiError(`not found: ${key} is not installed`, EXIT.NOT_FOUND);
  }

  const absPaths = safeLockPaths(entry, into);
  assertRealPathsInside(into, [...absPaths, lockPathFor(into)]);

  removeFiles(into, absPaths);

  delete lock.artifacts[key];
  writeLock(into, lock);

  if (ctx.out.json) {
    ctx.out.printJson({ ok: true, removed: key });
  } else {
    ctx.out.write(`Uninstalled ${key}`);
  }
  setExit(EXIT.OK);
}

export type SyncFlags = InstallFlags & {
  status?: string;
  type?: string;
  tag?: string;
  prune?: boolean;
};

export type SyncSkipped = { artifact: string; reason: string };

/** Why `sync` does not install an artifact type as files for the runtime, or null when it does. */
function syncSkipReason(runtime: RuntimeDef, scope: RuntimeScope, type: string): string | null {
  if (!isArtifactType(type)) return null;
  const support = runtimeSupport(runtime, type, scope);
  if (!support.supported) return support.reason;
  if (support.method === "plugin") {
    return `${type === "hook" ? "hooks are" : "plugins are"} installed as Claude Code plugins via marketplace: /plugin install`;
  }
  if (support.method === "settings") {
    return "settings profiles are applied with: skillforge settings apply";
  }
  return null;
}

async function clearPurgedPins(
  ctx: AppContext,
  client: SkillforgeClient,
  into: string,
  installedLock: LockFile,
): Promise<void> {
  let clearedPurgedPin = false;
  for (const [key, entry] of Object.entries(installedLock.artifacts)) {
    if (await isPurgedVersion(client, key, entry.version)) {
      ctx.out.error(`${key}@${entry.version} was purged; updating from registry`);
      if (entry.pin === entry.version || entry.pin === `=${entry.version}`) {
        delete entry.pin;
        clearedPurgedPin = true;
      }
    }
  }
  if (clearedPurgedPin) writeLock(into, installedLock);
}

type SyncSummary = {
  installed: string[];
  updated: string[];
  up_to_date: string[];
  removed: string[];
  skipped: SyncSkipped[];
  /** Artifacts whose installation failed; sync went on with the others. */
  failed: Array<{ artifact: string; reason: string; code: ExitCode }>;
};

/** A replaced artifact gives way to its successor (artifact-replacement). */
function withSuccessors(
  items: Awaited<ReturnType<typeof fetchAllArtifacts>>,
  replaced: Map<string, string>,
): Awaited<ReturnType<typeof fetchAllArtifacts>> {
  const have = new Set(items.map(keyOf));
  const extra = [...new Set(replaced.values())]
    .filter((k) => !have.has(k))
    .map((k) => {
      const [type, name] = k.split("/");
      return { type, name } as (typeof items)[number];
    });
  return [...items.filter((i) => !replaced.has(keyOf(i))), ...extra];
}

/** Removes replaced artifacts once their successor is installed. */
function removeReplaced(
  ctx: AppContext,
  into: string,
  url: string,
  replaced: Map<string, string>,
  wantedKeys: Set<string>,
  summary: SyncSummary,
): void {
  const lock = readLock(into);
  const done = [...replaced].filter(([old, next]) => lock.artifacts[old] && lock.artifacts[next]);
  if (done.length === 0) return;
  const keep = new Set(
    [...Object.keys(lock.artifacts)].filter((k) => !done.some(([old]) => old === k)),
  );
  for (const k of wantedKeys) keep.add(k);
  for (const [old] of done) keep.delete(old);
  pruneUnwanted(into, url, keep, summary);
  for (const [old, next] of done) ctx.out.error(`replaced ${old} -> ${next}`);
}

/** Required and default artifacts of the user's teams join the chosen ones; unavailable ones leave. */
function withAssignments(
  items: Awaited<ReturnType<typeof fetchAllArtifacts>>,
  assignments: Assignments,
): Awaited<ReturnType<typeof fetchAllArtifacts>> {
  const blocked = new Set(assignments.unavailable.map(keyOf));
  const have = new Set(items.map(keyOf));
  const extra = [...assignments.required, ...assignments.default]
    .filter((a) => !have.has(keyOf(a)))
    .map((a) => ({ type: a.type, name: a.name }) as (typeof items)[number]);
  return [...items, ...extra].filter((i) => !blocked.has(keyOf(i)));
}

async function syncInstallItems(
  ctx: AppContext,
  client: SkillforgeClient,
  url: string,
  items: Awaited<ReturnType<typeof fetchAllArtifacts>>,
  runtime: RuntimeDef,
  scope: RuntimeScope,
  targetFlags: InstallFlags,
  summary: SyncSummary,
  wantedKeys: Set<string>,
): Promise<void> {
  for (const item of items) {
    const key = `${item.type}/${item.name}`;
    const reason = syncSkipReason(runtime, scope, item.type);
    if (reason !== null) {
      summary.skipped.push({ artifact: key, reason });
      continue;
    }
    wantedKeys.add(key);
    let result: InstallResult;
    try {
      result = await installOne(ctx, client, url, key, targetFlags, true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) {
        summary.skipped.push({ artifact: key, reason: "purged" });
        continue;
      }
      if (err instanceof DowngradeError || err instanceof RiskyError) {
        summary.skipped.push({ artifact: key, reason: err.message });
        continue;
      }
      recordFailure(summary, key, err);
      continue;
    }
    const label = `${result.key}@${result.version}`;
    if (result.status === "installed") summary.installed.push(label);
    else if (result.status === "updated") summary.updated.push(label);
    else summary.up_to_date.push(label);
  }
}

/**
 * One artifact that could not be installed (a signature or a file that does not match the signed release, a server
 * error for that artifact) goes to `failed`, and sync goes on with the rest (fix-sync-continue). An unreachable
 * registry or a refused sign-in concern every artifact, so they stop sync at once.
 */
function recordFailure(summary: SyncSummary, key: string, err: unknown): void {
  if (
    err instanceof ApiError &&
    (err.exitCode === EXIT.UNREACHABLE || err.exitCode === EXIT.UNAUTHORIZED)
  ) {
    throw err;
  }
  const code = err instanceof ApiError ? err.exitCode : EXIT.VALIDATION;
  const reason = err instanceof Error ? err.message : String(err);
  summary.failed.push({ artifact: key, reason, code });
}

function pruneUnwanted(
  into: string,
  url: string,
  wantedKeys: Set<string>,
  summary: SyncSummary,
): void {
  const lock = readLock(into);
  const doomed = Object.keys(lock.artifacts).filter((key) => !wantedKeys.has(key));
  const doomedPaths = doomed.map((key) => safeLockPaths(lock.artifacts[key]!, into));
  assertRealPathsInside(into, [...doomedPaths.flat(), lockPathFor(into)]);
  doomed.forEach((key, i) => {
    removeFiles(into, doomedPaths[i]!);
    summary.removed.push(`${key}@${lock.artifacts[key]!.version}`);
    delete lock.artifacts[key];
  });
  lock.registry = url;
  writeLock(into, lock);
}

function printSyncSummary(ctx: AppContext, summary: SyncSummary): void {
  if (ctx.out.json) {
    ctx.out.printJson(summary);
    return;
  }
  ctx.out.write(
    `sync: installed=${summary.installed.length} updated=${summary.updated.length} up_to_date=${summary.up_to_date.length} removed=${summary.removed.length} skipped=${summary.skipped.length} failed=${summary.failed.length}`,
  );
  for (const x of summary.installed) ctx.out.write(`  installed ${x}`);
  for (const x of summary.updated) ctx.out.write(`  updated ${x}`);
  for (const x of summary.up_to_date) ctx.out.write(`  up_to_date ${x}`);
  for (const x of summary.removed) ctx.out.write(`  removed ${x}`);
  for (const x of summary.skipped) ctx.out.write(`  skipped ${x.artifact}: ${x.reason}`);
  for (const x of summary.failed) ctx.out.write(`  failed ${x.artifact}: ${x.reason}`);
}

export async function runSync(ctx: AppContext, flags: SyncFlags): Promise<void> {
  const { client, url } = requireClient(ctx);
  const target = resolveTarget(flags);
  const into = target.base;
  const runtime = target.runtime ?? runtimeDef("claude-code");
  const installedLock = readLock(into, (k) => ctx.out.error(invalidPinWarning(k)));
  await clearPurgedPins(ctx, client, into, installedLock);
  const targetFlags: InstallFlags = {
    into: flags.into,
    runtime: flags.runtime,
    scope: flags.scope,
    force: flags.force,
    allowDowngrade: flags.allowDowngrade,
    allowRisky: flags.allowRisky,
  };

  const assignments = await fetchAssignments(client);
  const chosen = await fetchAllArtifacts(client, {
    status: flags.status,
    type: flags.type,
    tag: flags.tag,
  });
  const replaced = await successorsOf(client, Object.keys(installedLock.artifacts));
  const keep = new Set(assignments.required.map(keyOf));
  for (const old of keep) replaced.delete(old);
  const items = withSuccessors(withAssignments(chosen, assignments), replaced);

  const summary: SyncSummary = {
    installed: [],
    updated: [],
    up_to_date: [],
    removed: [],
    skipped: [],
    failed: [],
  };

  const wantedKeys = new Set<string>(assignments.required.map(keyOf));
  await syncInstallItems(
    ctx,
    client,
    url,
    items,
    runtime,
    target.scope,
    targetFlags,
    summary,
    wantedKeys,
  );

  removeReplaced(ctx, into, url, replaced, wantedKeys, summary);
  if (flags.prune) {
    pruneUnwanted(into, url, wantedKeys, summary);
  }

  printSyncSummary(ctx, summary);
  // The worst code among the failed artifacts; 0 when every artifact was handled.
  setExit(
    summary.failed.reduce<ExitCode>((worst, f) => (f.code > worst ? f.code : worst), EXIT.OK),
  );
}

export type OutdatedRow = {
  artifact: string;
  installed: string;
  wanted: string | null;
  latest: string | null;
  pin: string | null;
  update_available: boolean;
  newer_than_pin: boolean;
  error?: string;
  purged?: boolean;
};

async function outdatedRow(
  ctx: AppContext,
  client: SkillforgeClient,
  key: string,
  entry: LockArtifact,
): Promise<OutdatedRow> {
  const row: OutdatedRow = {
    artifact: key,
    installed: entry.version,
    wanted: null,
    latest: null,
    pin: entry.pin ?? null,
    update_available: false,
    newer_than_pin: false,
  };
  const parts = key.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ...row, error: "invalid lock key" };
  }
  const type = encodeURIComponent(parts[0]);
  const name = encodeURIComponent(parts[1]);
  try {
    row.purged = await isPurgedVersion(client, key, entry.version);
    if (row.purged) ctx.out.error(`${key}@${entry.version} was purged`);
    const latest = await resolveSpecVersion(client, type, name, "latest");
    let wanted = latest;
    if (row.pin !== null) {
      try {
        wanted = await resolveSpecVersion(client, type, name, row.pin);
      } catch (err) {
        if (!isSpecInvalidError(err)) throw err;
        ctx.out.error(invalidPinWarning(key));
        row.pin = null;
      }
    }
    row.latest = latest.version;
    row.wanted = wanted.version;
    row.update_available = semverGreater(wanted.version, entry.version);
    row.newer_than_pin = row.pin !== null && semverGreater(latest.version, wanted.version);
    return row;
  } catch (err) {
    return { ...row, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function runOutdated(ctx: AppContext, flags: TargetFlags): Promise<void> {
  const { client } = requireClient(ctx);
  const into = resolveTarget(flags).base;
  const lock = readLock(into, (k) => ctx.out.error(invalidPinWarning(k)));
  const rows: OutdatedRow[] = [];
  for (const key of Object.keys(lock.artifacts).sort()) {
    rows.push(await outdatedRow(ctx, client, key, lock.artifacts[key]!));
  }

  if (ctx.out.json) {
    ctx.out.printJson(rows);
  } else if (rows.length === 0) {
    ctx.out.write("No installed artifacts");
  } else {
    ctx.out.printTable(
      ["ARTIFACT", "INSTALLED", "WANTED", "LATEST", "PIN", "NOTE"],
      rows.map((r) => [
        r.artifact,
        r.installed,
        r.wanted ?? "-",
        r.latest ?? "-",
        r.pin ?? "-",
        r.purged
          ? "purged"
          : r.error
            ? `error: ${r.error}`
            : r.update_available
              ? "update available"
              : r.newer_than_pin
                ? "newer than pin"
                : "",
      ]),
    );
  }
  setExit(EXIT.OK);
}
