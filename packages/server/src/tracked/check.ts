import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import semver from "semver";
import { scanImportTree } from "@skillforge/core";
import type { AppConfig } from "../config.ts";
import type { Database } from "../repo.ts";
import { getArtifactById } from "../repo.ts";
import { emitNotifications, notify } from "../notifications/notify.ts";
import {
  freshnessOf,
  isSourceAllowed,
  loadImportPolicy,
  recordCommitSeen,
} from "../imports/policy.ts";
import { importCandidate, resolveCandidates, type ImportRunContext } from "../imports/run.ts";
import { materialize } from "../imports/sources.ts";
import { applyEdits } from "./edits.ts";
import {
  SourceFetchError,
  githubCommit,
  githubFolder,
  githubRepoOf,
  type SourceFile,
} from "./github.ts";
import {
  getSource,
  listEnabledSources,
  saveCheck,
  type SourceState,
  type TrackedSource,
} from "./store.ts";

/**
 * One check of a tracked source (tracked-sources): a new upstream commit goes through the same gates as an import —
 * source policy, quarantine of fresh commits, edit rules, parsing, the security scan and the hook gate — and becomes a
 * beta version published by `system`; stable and the status stay. Problems are kept on the source and sent to the
 * owner, maintainers and watchers.
 */
export type CheckResult = {
  state: SourceState;
  detail?: string;
  commit?: string;
  ready_at?: string;
  version?: string;
};

const PROBLEMS = new Set<SourceState>(["failed", "edits_outdated", "path_missing"]);

let gitChecked: boolean | null = null;
function gitAvailable(): boolean {
  gitChecked ??= spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;
  return gitChecked;
}

type Fetched =
  { commit: string; files: SourceFile[] } | { quarantined: CheckResult } | { unchanged: string };

type Snapshot = { commit: string; files: SourceFile[] };

/** A shallow clone of the source's branch or tag (default branch when none): its commit and the folder's files. */
async function gitSnapshot(
  config: AppConfig,
  db: Database,
  source: TrackedSource,
): Promise<Snapshot> {
  const workRoot = path.join(config.dataDir, "tmp", "sources", randomBytes(8).toString("hex"));
  fs.mkdirSync(workRoot, { recursive: true });
  try {
    const src = {
      kind: "git" as const,
      url: source.url,
      ...(source.ref ? { ref: source.ref } : {}),
      ...(source.path ? { path: source.path } : {}),
    };
    const mat = await materialize(src, config, workRoot, loadImportPolicy(db));
    if (!mat.ok) throw new SourceFetchError(mat.error);
    const commit = mat.git?.commit;
    if (!commit) throw new SourceFetchError("import_git_failed");
    return {
      commit,
      files: mat.files.map((x) => ({ path: x.path, content: Buffer.from(x.content) })),
    };
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
  }
}

/**
 * The head commit and, lazily, the folder: by git when it is on and installed (any git host), otherwise by the GitHub
 * API and archive (GitHub only).
 */
async function upstream(
  config: AppConfig,
  db: Database,
  source: TrackedSource,
): Promise<{ commit: string; files: () => Promise<SourceFile[]> }> {
  if (config.importGit && gitAvailable()) {
    const snap = await gitSnapshot(config, db, source);
    return { commit: snap.commit, files: async () => snap.files };
  }
  const repo = githubRepoOf(source.url);
  if (!repo) throw new SourceFetchError("transport_unavailable");
  const commit = await githubCommit(config.githubApiUrl, config.githubToken, repo, source.ref);
  return {
    commit,
    files: () => githubFolder(config.githubApiUrl, config.githubToken, repo, commit, source.path),
  };
}

async function fetchSource(
  config: AppConfig,
  db: Database,
  source: TrackedSource,
): Promise<Fetched> {
  const policy = loadImportPolicy(db);
  if (!isSourceAllowed(policy, source.url)) throw new SourceFetchError("import_source_not_allowed");
  const up = await upstream(config, db, source);
  if (up.commit === source.last_commit) return { unchanged: up.commit };
  const fresh = freshnessOf(policy, recordCommitSeen(db, `source:${source.url}`, up.commit));
  if (!fresh.ready) return { quarantined: { state: "quarantined", ready_at: fresh.ready_at } };
  return { commit: up.commit, files: await up.files() };
}

/** `version` or `metadata.version` of the main markdown file when it is above the latest version. */
function declaredVersion(files: SourceFile[], latest: string | null): string | undefined {
  const main =
    files.find((f) => /(^|\/)(SKILL|MCP|SETTINGS)\.md$/.test(f.path)) ??
    files.find((f) => f.path.endsWith(".md"));
  const fm = main
    ? /^---\r?\n([\s\S]*?)\r?\n---/.exec(main.content.toString("utf8"))?.[1]
    : undefined;
  const v = fm ? /^\s*version:\s*["']?([0-9][^"'\s]*)/m.exec(fm)?.[1] : undefined;
  return v && semver.valid(v) && (!latest || semver.gt(v, latest)) ? v : undefined;
}

async function publishFrom(
  db: Database,
  config: AppConfig,
  artifact: NonNullable<ReturnType<typeof getArtifactById>>,
  source: TrackedSource,
  commit: string,
  files: SourceFile[],
): Promise<CheckResult> {
  const ctx: ImportRunContext = {
    db,
    config,
    dataDir: config.dataDir,
    actor: "system",
    role: "admin",
    importId: `source:${artifact.id}`,
    meta: { kind: "git", ref: `${source.url}@${commit}` },
    tree: files,
    provenanceSource: "import",
    provenanceRefOverride: `${source.url}@${commit}:${source.path}`,
    ...(declaredVersion(files, artifact.latest_version)
      ? { versionOverride: declaredVersion(files, artifact.latest_version) }
      : {}),
    skipConflicts: true,
    betaForExisting: true,
  };
  const scanned = scanImportTree(files.map((f) => ({ path: f.path, content: f.content })));
  const candidate = resolveCandidates(ctx, scanned, files).find(
    (c) => c.id === `${artifact.type}/${artifact.name}`,
  );
  if (!candidate) return { state: "failed", detail: "artifact_not_in_source", commit };
  const result = await importCandidate(ctx, candidate);
  if (result.status === "created")
    return { state: "ok", commit, ...(result.version ? { version: result.version } : {}) };
  if (result.status === "skipped" && result.reason === "digest_exists")
    return { state: "unchanged", commit };
  const first = result.errors?.[0] as { code?: unknown } | undefined;
  const code = typeof first?.code === "string" ? first.code : "import_failed";
  return { state: "failed", detail: result.reason ?? code };
}

function notifyProblem(db: Database, artifactId: string, result: CheckResult): void {
  if (!PROBLEMS.has(result.state)) return;
  const artifact = getArtifactById(db, artifactId);
  if (artifact) emitNotifications(notify(db, { kind: "source", artifact, actor: "system" }));
}

async function runCheck(
  db: Database,
  config: AppConfig,
  source: TrackedSource,
): Promise<CheckResult> {
  const artifact = getArtifactById(db, source.artifact_id);
  if (!artifact) return { state: "failed", detail: "artifact_missing" };
  const fetched = await fetchSource(config, db, source);
  if ("unchanged" in fetched) return { state: "unchanged", commit: fetched.unchanged };
  if ("quarantined" in fetched) return fetched.quarantined;
  if (fetched.files.length === 0) return { state: "path_missing", commit: undefined };
  const edited = applyEdits(fetched.files, source.edits);
  if (!edited.ok) return { state: "edits_outdated", detail: JSON.stringify(edited.edit) };
  const files = inRepository(edited.files, source.path);
  return publishFrom(db, config, artifact, source, fetched.commit, files);
}

/**
 * The folder's files under their repository path, as the import that created the artifact saw them. Scanned relative
 * to the folder, a skill would sit at the root, and a root SKILL.md claims only itself: the rest of the folder was lost.
 * Edit rules are applied before this, to paths inside the folder.
 */
function inRepository(files: SourceFile[], folder: string): SourceFile[] {
  const prefix = folder ? `${folder.replace(/\/$/, "")}/` : "";
  return files.map((f) => ({ path: prefix + f.path, content: f.content }));
}

export async function checkSource(
  db: Database,
  config: AppConfig,
  artifactId: string,
): Promise<CheckResult> {
  const source = getSource(db, artifactId);
  if (!source) return { state: "failed", detail: "no_source" };
  let result: CheckResult;
  try {
    result = await runCheck(db, config, source);
  } catch (e) {
    result = { state: "failed", detail: e instanceof SourceFetchError ? e.code : "check_failed" };
  }
  saveCheck(db, artifactId, {
    state: result.state,
    // quarantined keeps when the commit may be taken, ok keeps the new version: both survive a reload
    detail: result.detail ?? result.ready_at ?? result.version ?? null,
    commit: result.commit ?? null,
  });
  notifyProblem(db, artifactId, result);
  return result;
}

/** The background check of every enabled source, one at a time. */
export async function checkAllSources(db: Database, config: AppConfig): Promise<void> {
  for (const source of listEnabledSources(db)) {
    try {
      await checkSource(db, config, source.artifact_id);
    } catch {
      /* the next run tries again */
    }
  }
}
