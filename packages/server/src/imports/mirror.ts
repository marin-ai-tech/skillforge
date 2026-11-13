import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { scanImportTree } from "@skillforge/core";
import type { AppConfig } from "../config.ts";
import type { Database } from "../repo.ts";
import { getUserByUsername, type Role } from "../auth/users.ts";
import { freshnessOf, isSourceAllowed, loadImportPolicy, recordCommitSeen } from "./policy.ts";
import {
  importCandidate,
  resolveCandidates,
  type ImportRunContext,
  type RunResultItem,
} from "./run.ts";
import {
  isGitUrlAllowed,
  isSafeImportPath,
  isSafeImportRef,
  materialize,
  stripUserinfo,
} from "./sources.ts";

/**
 * Upstream mirrors: a git source the registry checks again and again. New packages
 * arrive as candidates, changed packages as a new version in the beta channel, so people on stable get nothing
 * until a reviewer moves it. Every check goes through the same policy, quarantine, scan and hook gate as an import.
 */
export type Mirror = {
  id: string;
  url: string;
  ref: string | null;
  path: string | null;
  include: string[];
  created_by: string;
  created_at: string;
  last_checked_at: string | null;
  last_commit: string | null;
  last_status: string | null;
  last_report: MirrorReport | null;
};

export type MirrorReport = {
  status: "ok" | "quarantined" | "failed";
  commit?: string;
  ready_at?: string;
  error?: string;
  imported: string[];
  updated: string[];
  unchanged: string[];
  failed: Array<{ id: string; reason?: string; errors?: unknown[] }>;
};

type MirrorRow = Omit<Mirror, "include" | "last_report"> & {
  include: string;
  last_report: string | null;
};

const INCLUDE_RE = /^[a-z]+\/[a-z0-9][a-z0-9-]{0,63}$/;

export class MirrorInputError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message?: string) {
    super(message ?? code);
    this.code = code;
    this.status = status;
  }
}

function toMirror(row: MirrorRow): Mirror {
  return {
    ...row,
    include: JSON.parse(row.include) as string[],
    last_report: row.last_report ? (JSON.parse(row.last_report) as MirrorReport) : null,
  };
}

export function listMirrors(db: Database): Mirror[] {
  return (db.prepare("SELECT * FROM import_mirrors ORDER BY created_at").all() as MirrorRow[]).map(
    toMirror,
  );
}

export function getMirror(db: Database, id: string): Mirror | null {
  const row = db.prepare("SELECT * FROM import_mirrors WHERE id = ?").get(id) as
    MirrorRow | undefined;
  return row ? toMirror(row) : null;
}

function checkMirrorUrl(db: Database, config: AppConfig, url: string): void {
  if (!url) throw new MirrorInputError("bad_request", 400, "url required");
  if (!config.importGit) throw new MirrorInputError("import_git_disabled", 400);
  if (!isGitUrlAllowed(url, { allowFileUrls: config.importAllowFileUrls }).ok) {
    throw new MirrorInputError("import_url_not_allowed", 400);
  }
  if (!isSourceAllowed(loadImportPolicy(db), url)) {
    throw new MirrorInputError("import_source_not_allowed", 403);
  }
}

/** An optional string field: absent or empty is null, anything else must pass `valid`. */
function optional(raw: unknown, valid: (v: string) => boolean, what: string): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || !valid(raw))
    throw new MirrorInputError("bad_request", 400, `invalid ${what}`);
  return raw;
}

function parseInclude(raw: unknown): string[] {
  const include = Array.isArray(raw) ? raw : [];
  if (include.length > 200 || !include.every((i) => typeof i === "string" && INCLUDE_RE.test(i))) {
    throw new MirrorInputError("bad_request", 400, "include must list type/name ids");
  }
  return include as string[];
}

/** The same checks an import makes, at the time the mirror is set up. */
function parseMirrorInput(db: Database, config: AppConfig, body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const url = typeof b.url === "string" ? b.url.trim() : "";
  checkMirrorUrl(db, config, url);
  return {
    url,
    ref: optional(b.ref, isSafeImportRef, "ref"),
    path: optional(b.path, isSafeImportPath, "path"),
    include: parseInclude(b.include),
  };
}

export function createMirror(
  db: Database,
  config: AppConfig,
  body: unknown,
  actor: string,
): Mirror {
  const input = parseMirrorInput(db, config, body);
  const id = randomBytes(8).toString("hex");
  db.prepare(
    `INSERT INTO import_mirrors (id, url, ref, path, include, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.url,
    input.ref,
    input.path,
    JSON.stringify(input.include),
    actor,
    new Date().toISOString(),
  );
  return getMirror(db, id)!;
}

export function deleteMirror(db: Database, id: string): boolean {
  return Number(db.prepare("DELETE FROM import_mirrors WHERE id = ?").run(id).changes) > 0;
}

function saveResult(db: Database, mirror: Mirror, report: MirrorReport): void {
  db.prepare(
    `UPDATE import_mirrors SET last_checked_at = ?, last_commit = COALESCE(?, last_commit),
       last_status = ?, last_report = ? WHERE id = ?`,
  ).run(
    new Date().toISOString(),
    report.commit ?? null,
    report.status,
    JSON.stringify(report),
    mirror.id,
  );
}

const emptyReport = (status: MirrorReport["status"]): MirrorReport => ({
  status,
  imported: [],
  updated: [],
  unchanged: [],
  failed: [],
});

function sortResult(report: MirrorReport, item: RunResultItem, existed: boolean): void {
  if (item.status === "created") (existed ? report.updated : report.imported).push(item.id);
  else if (item.status === "skipped" && item.reason === "digest_exists")
    report.unchanged.push(item.id);
  else
    report.failed.push({
      id: item.id,
      ...(item.reason ? { reason: item.reason } : {}),
      ...(item.errors ? { errors: item.errors } : {}),
    });
}

/** One check of a mirror, as the user who set it up (or the admin who asked for it). */
export async function syncMirror(
  db: Database,
  config: AppConfig,
  mirror: Mirror,
  actor: { username: string; role: Role },
): Promise<MirrorReport> {
  const policy = loadImportPolicy(db);
  const workRoot = path.join(config.dataDir, "tmp", "mirrors", randomBytes(8).toString("hex"));
  fs.mkdirSync(workRoot, { recursive: true });
  const source = {
    kind: "git" as const,
    url: mirror.url,
    ...(mirror.ref ? { ref: mirror.ref } : {}),
    ...(mirror.path ? { path: mirror.path } : {}),
  };
  try {
    const mat = await materialize(source, config, workRoot, policy);
    if (!mat.ok) {
      const failed = { ...emptyReport("failed"), error: mat.error };
      saveResult(db, mirror, failed);
      return failed;
    }
    const git = mat.git!;
    const fresh = freshnessOf(policy, recordCommitSeen(db, git.location_key, git.commit));
    if (!fresh.ready) {
      const waiting = {
        ...emptyReport("quarantined"),
        commit: git.commit,
        ready_at: fresh.ready_at,
      };
      saveResult(db, mirror, waiting);
      return waiting;
    }
    const report: MirrorReport = { ...emptyReport("ok"), commit: git.commit };
    const ctx: ImportRunContext = {
      db,
      config,
      dataDir: config.dataDir,
      actor: actor.username,
      role: actor.role,
      importId: `mirror:${mirror.id}`,
      meta: { kind: "git", ref: `${stripUserinfo(mirror.url)}@${git.commit}` },
      tree: mat.files,
      provenanceSource: "import",
      provenanceRefPrefix: `${stripUserinfo(mirror.url)}@${git.commit}`,
      skipConflicts: true,
      betaForExisting: true,
    };
    const scanned = scanImportTree(
      mat.files.map((f) => ({ path: f.path, content: f.content })),
      {
        rootSkillTakesRest: true,
      },
    );
    const wanted = new Set(mirror.include);
    for (const c of resolveCandidates(ctx, scanned, mat.files)) {
      if (wanted.size > 0 && !wanted.has(c.id)) continue;
      sortResult(report, await importCandidate(ctx, c), c.exists);
    }
    saveResult(db, mirror, report);
    return report;
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
  }
}

/** The background check of every mirror; failures are kept in each mirror's last result. */
export async function syncAllMirrors(db: Database, config: AppConfig): Promise<void> {
  for (const mirror of listMirrors(db)) {
    const owner = getUserByUsername(db, mirror.created_by);
    if (!owner || owner.role !== "admin") continue;
    try {
      await syncMirror(db, config, mirror, { username: owner.username, role: owner.role });
    } catch {
      /* the next run tries again */
    }
  }
}
