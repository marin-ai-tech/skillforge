import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { requireRole, requireUser, type RequestUser } from "../auth/guard.ts";
import { appendAudit, getArtifactByTypeName, type ArtifactRow, type Database } from "../repo.ts";
import {
  getClearance,
  removeClearance,
  setClearance,
  storedSecurityReport,
} from "../security/clearance.ts";
import { isArtifactType } from "@skillforge/core";
import { canView, type Viewer } from "../visibility/index.ts";

type Params = { type: string; name: string; version: string };
type Target = { row: ArtifactRow; version: string; publishedBy: string };

function reasonOf(body: unknown): string | null {
  const raw = (body as { reason?: unknown } | null)?.reason;
  if (typeof raw !== "string") return null;
  const reason = raw.trim();
  return reason.length >= 1 && reason.length <= 500 ? reason : null;
}

/** The artifact and the exact version from the path, or the 404 already sent. */
function target(db: Database, params: Params, reply: FastifyReply, viewer: Viewer): Target | null {
  const row = isArtifactType(params.type)
    ? getArtifactByTypeName(db, params.type, params.name)
    : undefined;
  if (!row || !canView(db, viewer, row)) {
    void reply.code(404).send({ error: "not_found" });
    return null;
  }
  const version = params.version === "latest" ? (row.latest_version ?? "") : params.version;
  const v = db
    .prepare(
      "SELECT published_by FROM artifact_versions WHERE artifact_id = ? AND version = ? AND purged_at IS NULL",
    )
    .get(row.id, version) as { published_by: string } | undefined;
  if (!v) {
    void reply.code(404).send({ error: "not_found" });
    return null;
  }
  return { row, version, publishedBy: v.published_by };
}

/** Self-clearance: the author of the version is refused unless admin; returns the audit meta or the sent refusal. */
function clearanceActor(
  request: FastifyRequest,
  reply: FastifyReply,
  user: RequestUser,
  t: Target,
): { meta: Record<string, unknown> | null } | null {
  if (t.publishedBy !== user.username) {
    return requireRole(request, reply, "reviewer") ? { meta: null } : null;
  }
  if (user.role !== "admin") {
    void reply.code(403).send({ error: "self_clearance_forbidden" });
    return null;
  }
  return { meta: { self_clearance: true } };
}

function conflictOf(db: Database, t: Target): string | null {
  if (storedSecurityReport(db, t.row.id, t.version)?.verdict !== "fail") return "nothing_to_clear";
  return getClearance(db, t.row.id, t.version)?.current ? "already_cleared" : null;
}

/** Security Clearance (security-gates): a reviewer marks the blocking findings of a version as false positives. */
export const securityClearanceRoutes: FastifyPluginAsync<{ db: Database }> = async (app, opts) => {
  const { db } = opts;
  const PATH = "/api/v1/artifacts/:type/:name/versions/:version/security-clearance";

  app.post<{ Params: Params }>(PATH, async (request, reply) => {
    if (!requireUser(request, reply)) return;
    const t = target(db, request.params, reply, request.user);
    if (!t) return;
    const who = clearanceActor(request, reply, request.user, t);
    if (!who) return;
    const reason = reasonOf(request.body);
    if (reason === null) return reply.code(400).send({ error: "reason_required" });
    const conflict = conflictOf(db, t);
    if (conflict) return reply.code(409).send({ error: conflict });
    const at = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      const findings = setClearance(db, {
        artifactId: t.row.id,
        version: t.version,
        clearedBy: request.user.username,
        reason,
        at,
      });
      appendAudit(db, {
        ts: at,
        actor: request.user.username,
        artifact_id: t.row.id,
        version: t.version,
        action: "security_clearance_set",
        reason,
        meta: { ...who.meta, rules: [...new Set(findings.map((f) => f.rule))] },
      });
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return reply.code(201).send({ security_clearance: getClearance(db, t.row.id, t.version) });
  });

  app.delete<{ Params: Params }>(PATH, async (request, reply) => {
    if (!requireRole(request, reply, "reviewer")) return;
    const t = target(db, request.params, reply, request.user);
    if (!t) return;
    const at = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      const removed = removeClearance(db, t.row.id, t.version);
      if (removed) {
        appendAudit(db, {
          ts: at,
          actor: request.user.username,
          artifact_id: t.row.id,
          version: t.version,
          action: "security_clearance_removed",
        });
      }
      db.exec("COMMIT");
      if (!removed) return reply.code(404).send({ error: "not_found" });
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return reply.code(200).send({ security_clearance: null });
  });
};
