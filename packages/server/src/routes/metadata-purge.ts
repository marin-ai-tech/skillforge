import { bumpRegistryEpoch } from "../registry-epoch.ts";
import {
  AgentDeclarationError,
  isArtifactType,
  parseAgentDeclarations,
  type AgentDeclaration,
} from "@skillforge/core";
import fs from "node:fs";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { actorFromRequest } from "../actor.ts";
import { requireUser } from "../auth/guard.ts";
import { blobPath } from "../blobs.ts";
import { deleteBackup, listBackups } from "../backups/store.ts";
import { bumpMarketplaceVersion } from "../distribution/marketplace.ts";
import { canPublishVersion } from "../ownership.ts";
import { emitPluginEvent } from "../plugins/events.ts";
import { runErasers, type PurgeContext } from "../purge/erasers.ts";
import {
  appendAudit,
  applyOverride,
  getArtifactByTypeName,
  getVersion,
  rowToSummary,
  type Database,
  type Metadata,
} from "../repo.ts";
import { recomputeLatest } from "../versions/channels.ts";
import type { AppConfig } from "../config.ts";

type Params = { type: string; name: string; version?: string };
type PurgeBody = { reason?: unknown; confirm?: unknown; delete_backups?: unknown };
const fields = ["display_name", "description", "tags", "agents"] as const;
type Field = (typeof fields)[number];

const TAG_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/u;

function validDisplayName(value: unknown): boolean {
  return value === null || (typeof value === "string" && value.length <= 100);
}

function validDescription(value: unknown): boolean {
  return (
    value === null || (typeof value === "string" && value.length <= 1024 && !hasControls(value))
  );
}

function validTags(value: unknown): boolean {
  return (
    value === null ||
    (Array.isArray(value) &&
      value.length <= 20 &&
      value.every((t) => typeof t === "string" && TAG_RE.test(t)) &&
      new Set(value).size === value.length)
  );
}

function validMetadata(body: unknown): body is MetadataBody {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const b = body as Record<string, unknown>;
  const keys = Object.keys(b);
  if (!keys.length || keys.some((k) => !fields.includes(k as Field))) return false;
  if ("display_name" in b && !validDisplayName(b.display_name)) return false;
  if ("description" in b && !validDescription(b.description)) return false;
  if ("tags" in b && !validTags(b.tags)) return false;
  return true;
}

/** `agents` in a metadata PATCH: parsed for the artifact type (null removes the override). */
function metadataAgents(
  type: string,
  body: MetadataBody,
): { ok: true; body: MetadataBody } | { ok: false; detail: string } {
  if (!("agents" in body) || body.agents === null) return { ok: true, body };
  if (!isArtifactType(type)) return { ok: false, detail: `unknown artifact type ${type}` };
  try {
    return { ok: true, body: { ...body, agents: parseAgentDeclarations(body.agents, type) } };
  } catch (e) {
    if (e instanceof AgentDeclarationError) return { ok: false, detail: e.message };
    throw e;
  }
}

function hasControls(value: string): boolean {
  return [...value].some((c) => {
    const code = c.charCodeAt(0);
    return (code < 32 && code !== 10) || code === 127;
  });
}

function baseMetadata(db: Database, id: string, latest: string | null): Metadata {
  const version = latest ? getVersion(db, id, latest) : undefined;
  return {
    description: version?.description ?? "",
    display_name: version?.display_name ?? null,
    tags: version?.tags ?? [],
    agents: version?.agents ?? [],
  };
}

type MetadataBody = Partial<Record<Field, string | string[] | AgentDeclaration[] | null>>;
type ArtifactRecord = NonNullable<ReturnType<typeof getArtifactByTypeName>>;
type TxFailure = { ok: false; status: number; error: string };

/** Applies the PATCH body to the stored override; null removes a field from the override. */
function mergeMetadataOverride(prior: Record<string, unknown>, body: MetadataBody) {
  const next = { ...prior };
  const changes: Record<string, unknown> = {};
  for (const field of fields) {
    if (!(field in body)) continue;
    const value = body[field];
    if (value === null) delete next[field];
    else next[field] = value;
    if (JSON.stringify(prior[field] ?? null) !== JSON.stringify(next[field] ?? null)) {
      changes[field] = { from: prior[field] ?? null, to: next[field] ?? null };
    }
  }
  return { next, changes };
}

type MetadataUpdate = {
  type: string;
  name: string;
  actor: string;
  role: Parameters<typeof canPublishVersion>[2];
  body: MetadataBody;
};

/** Runs inside BEGIN IMMEDIATE; the caller commits on ok and rolls back otherwise. */
function applyMetadataUpdate(db: Database, req: MetadataUpdate): { ok: true } | TxFailure {
  const { actor, role } = req;
  const row = getArtifactByTypeName(db, req.type, req.name);
  if (!row || row.purged_at) return { ok: false, status: 404, error: "not_found" };
  const right = canPublishVersion(db, actor, role, row);
  if (!right.allowed) return { ok: false, status: 403, error: "not_owner" };
  const prior = row.meta_override ? (JSON.parse(row.meta_override) as Record<string, unknown>) : {};
  const { next, changes } = mergeMetadataOverride(prior, req.body);
  const override = Object.keys(next).length ? JSON.stringify(next) : null;
  const effective = applyOverride(baseMetadata(db, row.id, row.latest_version), override);
  const at = new Date().toISOString();
  db.prepare(
    "UPDATE artifacts SET meta_override = ?, description = ?, display_name = ?, tags = ?, agents = ?, updated_at = ? WHERE id = ?",
  ).run(
    override,
    effective.description,
    effective.display_name,
    JSON.stringify(effective.tags),
    JSON.stringify(effective.agents),
    at,
    row.id,
  );
  bumpRegistryEpoch();
  appendAudit(db, {
    ts: at,
    actor,
    artifact_id: row.id,
    version: null,
    action: "metadata_change",
    meta: changes,
  });
  if (right.override)
    appendAudit(db, {
      ts: at,
      actor,
      artifact_id: row.id,
      version: null,
      action: "publish_override",
      meta: { by_role: role, owner: right.owner, via: "metadata_change" },
    });
  return { ok: true };
}

function updateMetadata(db: Database, req: MetadataUpdate): { ok: true } | TxFailure {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = applyMetadataUpdate(db, req);
    db.exec(result.ok ? "COMMIT" : "ROLLBACK");
    return result;
  } catch (e) {
    if (db.isOpen) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* already committed */
      }
    }
    throw e;
  }
}

/** All three purge-body errors answer 400; null = body is valid. */
function purgeBodyError(body: PurgeBody, confirmTarget: string): string | null {
  if (typeof body.reason !== "string" || body.reason.trim().length < 10 || body.reason.length > 500)
    return "reason_required";
  if (body.confirm !== confirmTarget) return "confirm_mismatch";
  if (body.delete_backups !== undefined && typeof body.delete_backups !== "boolean")
    return "bad_request";
  return null;
}

type PurgeTarget = { id: string; version: string; files: string; purged_at: string | null };
type SharedBlob = { sha256: string; versions: string[] };
type PurgeRequest = {
  type: string;
  name: string;
  version: string | undefined;
  actor: string;
  reason: string;
  at: string;
};
type PurgeTxResult =
  | TxFailure
  | {
      ok: true;
      targetId: string;
      artifactPurged: boolean;
      candidates: Set<string>;
      shared: SharedBlob[];
    };

function loadPurgeTargets(
  db: Database,
  artifactId: string,
  version: string | undefined,
): PurgeTarget[] {
  return db
    .prepare(
      `SELECT id, version, files, purged_at FROM artifact_versions WHERE artifact_id = ? ${version ? "AND version = ?" : ""}`,
    )
    .all(...(version ? [artifactId, version] : [artifactId])) as PurgeTarget[];
}

/** Blobs of the not-yet-purged target versions: candidates for deletion. */
function liveBlobShas(targets: PurgeTarget[]): Set<string> {
  const candidates = new Set<string>();
  for (const target of targets) {
    if (target.purged_at) continue;
    for (const file of JSON.parse(target.files) as Array<{ sha256: string }>)
      candidates.add(file.sha256);
  }
  return candidates;
}

/** Candidates still referenced by a live version anywhere: they must survive. */
function sharedBlobs(db: Database, candidates: Set<string>): SharedBlob[] {
  const shared: SharedBlob[] = [];
  for (const sha of candidates) {
    const refs = db
      .prepare(
        `SELECT v.version FROM artifact_versions v, json_each(v.files) f
          WHERE v.purged_at IS NULL AND json_extract(f.value, '$.sha256') = ?`,
      )
      .all(sha) as Array<{ version: string }>;
    if (refs.length) shared.push({ sha256: sha, versions: refs.map((r) => r.version) });
  }
  return shared;
}

/** Updates the artifact row after the erasers; true when it became a tombstone. */
function refreshArtifactAfterPurge(
  db: Database,
  row: ArtifactRecord,
  ctx: PurgeContext,
  req: PurgeRequest,
): boolean {
  const latest = recomputeLatest(db, row.id);
  if (!latest) {
    db.prepare(
      "UPDATE artifacts SET purged_at = ?, purged_by = ?, status = 'retired', description = '', display_name = NULL, tags = '[]', labels = '[]', agents = '[]', meta_override = NULL, updated_at = ? WHERE id = ?",
    ).run(req.at, req.actor, req.at, row.id);
    bumpRegistryEpoch();
    // The last live version was purged: the artifact becomes a tombstone, so the
    // artifact-scoped erasers run too; audit redaction stays version-scoped as before.
    if (req.version) runErasers(db, { ...ctx, version: null }, { exclude: ["audit_events"] });
    return true;
  }
  const effective = applyOverride(baseMetadata(db, row.id, latest), row.meta_override);
  db.prepare(
    "UPDATE artifacts SET description = ?, display_name = ?, tags = ?, updated_at = ? WHERE id = ?",
  ).run(
    effective.description,
    effective.display_name,
    JSON.stringify(effective.tags),
    req.at,
    row.id,
  );
  return false;
}

/** Runs inside BEGIN IMMEDIATE; the caller commits on ok and rolls back otherwise. */
function applyPurge(
  db: Database,
  dataDir: string,
  req: PurgeRequest,
  afterCommit: Array<() => void>,
): PurgeTxResult {
  const { type, name, version, at } = req;
  const row = getArtifactByTypeName(db, type, name);
  if (!row) return { ok: false, status: 404, error: "not_found" };
  const targets = loadPurgeTargets(db, row.id, version);
  if (!targets.length) return { ok: false, status: 404, error: "not_found" };
  if (targets.every((v) => v.purged_at)) return { ok: false, status: 409, error: "purged" };
  const candidates = liveBlobShas(targets);
  // All per-artifact tables are erased through the registry (purge/erasers.ts):
  // version purge runs version-scoped entries, whole-artifact purge runs all of them,
  // audit_events is redacted last before the purge audit row below.
  const ctx: PurgeContext = {
    artifactId: row.id,
    type,
    name,
    version: version ?? null,
    actor: req.actor,
    at,
    dataDir,
    afterCommit: (fn) => {
      afterCommit.push(fn);
    },
  };
  runErasers(db, ctx);
  const artifactPurged = refreshArtifactAfterPurge(db, row, ctx, req);
  const shared = sharedBlobs(db, candidates);
  appendAudit(db, {
    ts: at,
    actor: req.actor,
    artifact_id: row.id,
    version: version ?? null,
    action: "purge",
    reason: req.reason,
    meta: {
      version: version ?? null,
      blobs_deleted: candidates.size - shared.length,
      blobs_shared: shared,
    },
  });
  return { ok: true, targetId: row.id, artifactPurged, candidates, shared };
}

function purgeInTransaction(
  db: Database,
  dataDir: string,
  req: PurgeRequest,
  afterCommit: Array<() => void>,
): PurgeTxResult {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = applyPurge(db, dataDir, req, afterCommit);
    db.exec(result.ok ? "COMMIT" : "ROLLBACK");
    return result;
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* already committed */
    }
    throw e;
  }
}

function runAfterCommit(afterCommit: Array<() => void>): void {
  for (const fn of afterCommit) {
    try {
      fn();
    } catch {
      /* one failed unlink must not abort the others; prune sweeps orphans later */
    }
  }
}

function unlinkUnsharedBlobs(
  dataDir: string,
  candidates: Set<string>,
  shared: SharedBlob[],
): { blobsDeleted: number; blobsFailed: number } {
  let blobsDeleted = 0;
  let blobsFailed = 0;
  const protectedShas = new Set(shared.map((s) => s.sha256));
  for (const sha of candidates) {
    if (protectedShas.has(sha)) continue;
    try {
      fs.unlinkSync(blobPath(dataDir, sha));
      blobsDeleted++;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") blobsFailed++;
    }
  }
  return { blobsDeleted, blobsFailed };
}

function deleteBackupsAudited(
  db: Database,
  dataDir: string,
  backups: string[],
  audit: { actor: string; artifactId: string; version: string | null },
): number {
  let backupsDeleted = 0;
  for (const backup of backups) {
    deleteBackup(dataDir, backup);
    backupsDeleted++;
    appendAudit(db, {
      ts: new Date().toISOString(),
      actor: audit.actor,
      artifact_id: audit.artifactId,
      version: audit.version,
      action: "backup_delete",
      meta: { name: backup },
    });
  }
  return backupsDeleted;
}

function parseGcBody(raw: unknown): { dryRun: boolean; graceDays: number } | null {
  const body = (raw ?? {}) as { dry_run?: unknown; grace_days?: unknown };
  const grace = body.grace_days ?? 7;
  if (
    !Number.isInteger(grace) ||
    (grace as number) < 0 ||
    (grace as number) > 365 ||
    (body.dry_run !== undefined && typeof body.dry_run !== "boolean")
  )
    return null;
  return { dryRun: body.dry_run !== false, graceDays: grace as number };
}

type GcStats = { scanned: number; orphans: number; orphanBytes: number; deleted: number };

function blobReferenced(db: Database, sha: string): boolean {
  const versionRef = db
    .prepare(
      `SELECT 1 FROM artifact_versions v, json_each(v.files) f WHERE v.purged_at IS NULL AND json_extract(f.value, '$.sha256') = ? LIMIT 1`,
    )
    .get(sha);
  const agentRef = db
    .prepare(
      `SELECT 1 FROM agent_items i, json_each(i.files) f WHERE json_extract(f.value, '$.sha256') = ? LIMIT 1`,
    )
    .get(sha);
  // Evidence documents of live versions (evidence-documents).
  const evidenceRef = db
    .prepare(
      `SELECT 1 FROM artifact_versions v, json_each(v.evidence) e WHERE v.purged_at IS NULL AND json_extract(e.value, '$.document.sha256') = ? LIMIT 1`,
    )
    .get(sha);
  return Boolean(versionRef || agentRef || evidenceRef);
}

/** One blobs/<prefix> directory: count orphans, delete those past the grace period. */
async function sweepBlobDir(
  db: Database,
  dirPath: string,
  opts: { dryRun: boolean; cutoff: number },
  stats: GcStats,
): Promise<void> {
  for await (const entry of await fs.promises.opendir(dirPath)) {
    if (!entry.isFile() || !/^[a-f0-9]{64}$/u.test(entry.name)) continue;
    stats.scanned++;
    const sha = entry.name;
    if (blobReferenced(db, sha)) continue;
    const full = path.join(dirPath, sha);
    const st = await fs.promises.stat(full);
    stats.orphans++;
    stats.orphanBytes += st.size;
    if (!opts.dryRun && st.mtimeMs < opts.cutoff) {
      await fs.promises.unlink(full);
      stats.deleted++;
    }
  }
}

export const metadataPurgeRoutes: FastifyPluginAsync<{ db: Database; config: AppConfig }> = async (
  app,
  { db, config },
) => {
  app.patch<{ Params: Params }>(
    "/api/v1/artifacts/:type/:name/metadata",
    async (request, reply) => {
      if (!requireUser(request, reply)) return;
      if (!validMetadata(request.body)) return reply.code(400).send({ error: "metadata_invalid" });
      const { type, name } = request.params;
      const agents = metadataAgents(type, request.body);
      if (!agents.ok)
        return reply.code(400).send({ error: "agents_invalid", detail: agents.detail });
      const result = updateMetadata(db, {
        type,
        name,
        actor: actorFromRequest(request),
        role: request.user.role,
        body: agents.body,
      });
      if (!result.ok) return reply.code(result.status).send({ error: result.error });
      bumpMarketplaceVersion();
      return reply.send({ artifact: rowToSummary(db, getArtifactByTypeName(db, type, name)!) });
    },
  );

  async function purge(
    request: { params: Params; body: unknown; user: { username: string; role: string } | null },
    reply: import("fastify").FastifyReply,
  ) {
    if (!request.user) return reply.code(401).send({ error: "unauthorized" });
    if (request.user.role !== "admin") return reply.code(403).send({ error: "forbidden" });
    // Token check is performed in the route wrapper (requires FastifyRequest).
    const { type, name, version } = request.params;
    const body = (request.body ?? {}) as PurgeBody;
    const bodyError = purgeBodyError(body, `${type}/${name}${version ? `@${version}` : ""}`);
    if (bodyError) return reply.code(400).send({ error: bodyError });
    const backups = listBackups(config.dataDir).items.map((b) => b.name);
    const at = new Date().toISOString();
    const actor = request.user.username;
    const auditVersion = version ?? null;
    // Side effects queued by erasers (run output file unlinks), run only after COMMIT.
    const afterCommit: Array<() => void> = [];
    const tx = purgeInTransaction(
      db,
      config.dataDir,
      { type, name, version, actor, reason: body.reason as string, at },
      afterCommit,
    );
    if (!tx.ok) return reply.code(tx.status).send({ error: tx.error });
    const { targetId, shared } = tx;
    runAfterCommit(afterCommit);
    const { blobsDeleted, blobsFailed } = unlinkUnsharedBlobs(
      config.dataDir,
      tx.candidates,
      shared,
    );
    // The purge audit row is append-only: blob counters go into a separate event
    // written after COMMIT and the unlinks, never by rewriting the purge row.
    appendAudit(db, {
      ts: new Date().toISOString(),
      actor,
      artifact_id: targetId,
      version: auditVersion,
      action: "purge_blobs",
      meta: {
        version: auditVersion,
        blobs_deleted: blobsDeleted,
        blobs_failed: blobsFailed,
        blobs_shared: shared,
      },
    });
    const backupsDeleted =
      body.delete_backups === true
        ? deleteBackupsAudited(db, config.dataDir, backups, {
            actor,
            artifactId: targetId,
            version: auditVersion,
          })
        : 0;
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    emitPluginEvent({
      type: "artifact.purged",
      at,
      artifact: { id: targetId, type, name },
      version: tx.artifactPurged ? null : auditVersion,
    });
    bumpMarketplaceVersion();
    return reply.send({
      purged: version ?? `${type}/${name}`,
      blobs_deleted: blobsDeleted,
      blobs_failed: blobsFailed,
      blobs_shared: shared,
      backups_predating: backups,
      backups_deleted: backupsDeleted,
    });
  }

  app.post<{ Params: Params }>("/api/v1/artifacts/:type/:name/purge", async (request, reply) => {
    return purge(request, reply);
  });
  app.post<{ Params: Params }>(
    "/api/v1/artifacts/:type/:name/versions/:version/purge",
    async (request, reply) => {
      return purge(request, reply);
    },
  );

  app.post("/api/v1/admin/blobs/gc", async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: "unauthorized" });
    if (request.user.role !== "admin") return reply.code(403).send({ error: "forbidden" });
    const gc = parseGcBody(request.body);
    if (!gc) return reply.code(400).send({ error: "bad_request" });
    const dryRun = gc.dryRun;
    const cutoff = Date.now() - gc.graceDays * 86400000;
    const root = path.join(config.dataDir, "blobs");
    const stats: GcStats = { scanned: 0, orphans: 0, orphanBytes: 0, deleted: 0 };
    if (fs.existsSync(root)) {
      for await (const dir of await fs.promises.opendir(root)) {
        if (!dir.isDirectory()) continue;
        await sweepBlobDir(db, path.join(root, dir.name), { dryRun, cutoff }, stats);
      }
    }
    return reply.send({
      scanned: stats.scanned,
      orphans: stats.orphans,
      orphan_bytes: stats.orphanBytes,
      deleted: stats.deleted,
      dry_run: dryRun,
    });
  });
};
