import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { isArtifactType } from "@skillforge/core";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db.ts";
import { actorFromRequest } from "../actor.ts";
import { requireUser } from "../auth/guard.ts";
import { getArtifactByTypeName } from "../repo.ts";
import { canView } from "../visibility/index.ts";
import { canManageEvals } from "../evals/suite.ts";
import { readRunOutputContent, type RunOutputRow } from "../runs/outputs.ts";

/**
 * Read-only run output API.
 * Invisible artifact -> 404 before the role check; reading needs canManageEvals
 * (owner/maintainer/admin, = canPublishVersion), otherwise 403. Content is never logged.
 */

export type RunOutputsPluginOpts = { db: Database; config: AppConfig };

type Params = { type: string; name: string };
type IdParams = Params & { id: string };
type ListQuery = { version?: string; run_id?: string; kind?: string; limit?: string };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const COLUMNS =
  "id, run_id, run_kind, version, stream, name, sha256, size, truncated, exit_code, timed_out, duration_ms, created_by, created_at, expires_at";

function toView(row: RunOutputRow) {
  return {
    id: row.id,
    run_id: row.run_id,
    run_kind: row.run_kind,
    version: row.version,
    stream: row.stream,
    name: row.name,
    sha256: row.sha256,
    size: row.size,
    truncated: row.truncated === 1,
    exit_code: row.exit_code,
    timed_out: row.timed_out === 1,
    duration_ms: row.duration_ms,
    created_by: row.created_by,
    created_at: row.created_at,
    expires_at: row.expires_at,
  };
}

function parseLimit(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) return null;
  return n;
}

export const runOutputsRoutes: FastifyPluginAsync<RunOutputsPluginOpts> = async (app, opts) => {
  const { db, config } = opts;

  /** Visibility (404) -> auth (401) -> MCP token (403) -> canManageEvals (403). */
  function gate(
    request: FastifyRequest,
    reply: FastifyReply,
    type: string,
    name: string,
  ): { artifactId: string } | null {
    const row = isArtifactType(type) ? getArtifactByTypeName(db, type, name) : undefined;
    const viewer = request.user
      ? { username: request.user.username, role: request.user.role }
      : null;
    if (!row || row.purged_at || !canView(db, viewer, row)) {
      void reply.code(404).send({ error: "not_found" });
      return null;
    }
    if (!requireUser(request, reply)) return null;
    const actor = actorFromRequest(request);
    if (!canManageEvals(db, actor, request.user!.role, { id: row.id, owner: row.owner })) {
      void reply.code(403).send({ error: "forbidden" });
      return null;
    }
    return { artifactId: row.id };
  }

  function findOutput(artifactId: string, rawId: string): RunOutputRow | undefined {
    if (!/^[1-9]\d{0,15}$/u.test(rawId)) return undefined;
    return db
      .prepare(`SELECT ${COLUMNS} FROM run_outputs WHERE id = ? AND artifact_id = ?`)
      .get(Number(rawId), artifactId) as RunOutputRow | undefined;
  }

  app.get<{ Params: Params; Querystring: ListQuery }>(
    "/api/v1/artifacts/:type/:name/run-outputs",
    async (request, reply) => {
      const access = gate(request, reply, request.params.type, request.params.name);
      if (!access) return;
      const q = request.query ?? {};
      const limit = parseLimit(q.limit);
      if (limit === null) return reply.code(400).send({ error: "bad_request" });
      const where = ["artifact_id = ?"];
      const args: Array<string | number> = [access.artifactId];
      if (q.version) {
        where.push("version = ?");
        args.push(q.version);
      }
      if (q.run_id) {
        where.push("run_id = ?");
        args.push(q.run_id);
      }
      if (q.kind) {
        where.push("run_kind = ?");
        args.push(q.kind);
      }
      const rows = db
        .prepare(
          `SELECT ${COLUMNS} FROM run_outputs WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .all(...args, limit) as RunOutputRow[];
      reply.header("Cache-Control", "no-store");
      return reply.send({ items: rows.map(toView) });
    },
  );

  app.get<{ Params: IdParams }>(
    "/api/v1/artifacts/:type/:name/run-outputs/:id",
    async (request, reply) => {
      const access = gate(request, reply, request.params.type, request.params.name);
      if (!access) return;
      const row = findOutput(access.artifactId, request.params.id);
      if (!row) return reply.code(404).send({ error: "not_found" });
      reply.header("Cache-Control", "no-store");
      return reply.send({ output: toView(row) });
    },
  );

  app.get<{ Params: IdParams }>(
    "/api/v1/artifacts/:type/:name/run-outputs/:id/content",
    async (request, reply) => {
      const access = gate(request, reply, request.params.type, request.params.name);
      if (!access) return;
      const row = findOutput(access.artifactId, request.params.id);
      if (!row) return reply.code(404).send({ error: "not_found" });
      const content = readRunOutputContent(config.dataDir, row.sha256);
      if (!content) return reply.code(410).send({ error: "output_gone" });
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Cache-Control", "no-store");
      if (row.stream === "file") {
        reply.header("Content-Type", "application/octet-stream");
        reply.header("Content-Disposition", `attachment; filename="run-output-${row.id}"`);
      } else {
        reply.header("Content-Type", "text/plain; charset=utf-8");
      }
      return reply.send(content);
    },
  );
};
