import { costMatrix } from "../evals/cost.ts";
import type { FastifyPluginAsync } from "fastify";
import semver from "semver";
import { isArtifactType } from "@skillforge/core";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db.ts";
import { requireUser } from "../auth/guard.ts";
import { actorFromRequest } from "../actor.ts";
import { getArtifactByTypeName } from "../repo.ts";
import { canView } from "../visibility/index.ts";
import {
  canManageEvals,
  getSuiteGate,
  listSuiteCases,
  parseSuiteBody,
  replaceSuite,
} from "../evals/suite.ts";
import { enqueueRun, getRun, listRuns } from "../evals/runs.ts";
import { batchChildren, createBatch, getBatch, listBatches, toBatchView } from "../evals/batch.ts";
import { getEvalJournal } from "../evals/journal.ts";
import { loadRunnersFile } from "../evals/runner.ts";

export type EvalsPluginOpts = {
  db: Database;
  config: AppConfig;
};

function batchShapeOk(body: unknown): body is Record<string, unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return false;
  const b = body as Record<string, unknown>;
  const kindOk = b.kind === "trigger" || b.kind === "compare" || b.kind === "ablation";
  const versionOk =
    typeof b.version === "string" && !!b.version && semver.valid(b.version) === b.version;
  const scopeOk = b.scope === undefined || b.scope === "all" || b.scope === "holdout";
  return kindOk && versionOk && scopeOk;
}

export const evalsRoutes: FastifyPluginAsync<EvalsPluginOpts> = async (app, opts) => {
  const { db, config } = opts;

  // Ensure team-invisible artifacts 404 before auth (incl. anon), in this plugin context.
  app.addHook("preHandler", async (request, reply) => {
    const params = request.params as Record<string, string> | undefined;
    if (!params?.type || !params?.name) return;
    const row = getArtifactByTypeName(db, params.type, params.name);
    if (!row || row.purged_at) return;
    const viewer = request.user
      ? { username: request.user.username, role: request.user.role }
      : null;
    if (!canView(db, viewer, row)) {
      return reply.code(404).type("application/json").send({ error: "not_found" });
    }
  });

  function viewerOf(request: Parameters<typeof requireUser>[0]) {
    return request.user ? { username: request.user.username, role: request.user.role } : null;
  }

  /** The artifact exists, is not purged and is hidden from the caller (answer 404, not 400). */
  function hiddenFromViewer(
    request: Parameters<typeof requireUser>[0],
    type: string,
    name: string,
  ): boolean {
    const row0 = getArtifactByTypeName(db, type, name);
    return !!row0 && !row0.purged_at && !canView(db, viewerOf(request), row0);
  }

  // type_not_supported after visibility/auth
  function rejectUnsupportedType(
    request: Parameters<typeof requireUser>[0],
    reply: Parameters<typeof requireUser>[1],
    type: string,
    name: string,
  ) {
    const row0 = getArtifactByTypeName(db, type, name);
    if (!row0 || row0.purged_at) return reply.code(404).send({ error: "not_found" });
    if (!canView(db, viewerOf(request), row0)) return reply.code(404).send({ error: "not_found" });
    if (!requireUser(request, reply)) return;
    return reply.code(422).send({ error: "type_not_supported" });
  }

  function gateAccess(
    request: Parameters<typeof requireUser>[0],
    reply: Parameters<typeof requireUser>[1],
    type: string,
    name: string,
  ): { row: NonNullable<ReturnType<typeof getArtifactByTypeName>> } | null {
    if (!isArtifactType(type)) {
      void reply.code(404).send({ error: "not_found" });
      return null;
    }
    const row = getArtifactByTypeName(db, type, name);
    if (!row || row.purged_at) {
      void reply.code(404).send({ error: "not_found" });
      return null;
    }
    const viewer = request.user
      ? { username: request.user.username, role: request.user.role }
      : null;
    if (!canView(db, viewer, row)) {
      void reply.code(404).send({ error: "not_found" });
      return null;
    }
    if (!requireUser(request, reply)) return null;
    return { row };
  }

  app.get<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/evals",
    async (request, reply) => {
      const access = gateAccess(request, reply, request.params.type, request.params.name);
      if (!access) return;
      const { row } = access;
      const actor = actorFromRequest(request);
      if (!canManageEvals(db, actor, request.user!.role, { id: row.id, owner: row.owner })) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const loaded = loadRunnersFile(config.evalRunnersFile);
      return reply.code(200).send({
        gate: getSuiteGate(db, row.id),
        cases: listSuiteCases(db, row.id),
        runners: loaded.runners.map((r) => ({ id: r.id, label: r.label })),
      });
    },
  );

  app.put<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/evals",
    async (request, reply) => {
      const { type, name } = request.params;
      if (!isArtifactType(type)) return reply.code(404).send({ error: "not_found" });
      if (type !== "skill") return rejectUnsupportedType(request, reply, type, name);
      const access = gateAccess(request, reply, type, name);
      if (!access) return;
      const { row } = access;
      const actor = actorFromRequest(request);
      const role = request.user!.role;
      if (!canManageEvals(db, actor, role, { id: row.id, owner: row.owner })) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const rawSize =
        typeof request.headers["content-length"] === "string"
          ? Number(request.headers["content-length"])
          : undefined;
      const parsed = parseSuiteBody(request.body, Number.isFinite(rawSize) ? rawSize : undefined);
      if (!parsed.ok) {
        if (parsed.error === "gate_needs_holdout") {
          return reply.code(422).send({ error: "gate_needs_holdout" });
        }
        return reply.code(422).send({ error: "suite_invalid", detail: parsed.detail ?? "invalid" });
      }
      const result = replaceSuite(db, {
        artifactId: row.id,
        actor,
        role,
        gate: parsed.gate,
        cases: parsed.cases,
      });
      if (!result.ok) {
        if (result.error === "forbidden") return reply.code(403).send({ error: "forbidden" });
        return reply.code(422).send({ error: result.error });
      }
      const loaded = loadRunnersFile(config.evalRunnersFile);
      return reply.code(200).send({
        gate: result.gate,
        cases: result.cases,
        runners: loaded.runners.map((r) => ({ id: r.id, label: r.label })),
      });
    },
  );

  app.post<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/evals/runs",
    async (request, reply) => {
      const { type, name } = request.params;
      const body = request.body;
      // Same shape rules as a batch: object body, kind, exact semver version, optional scope.
      if (!batchShapeOk(body)) {
        // Still need visibility 404 for anon on team before body errors? Spec order: body 400 first.
        // But visibility test expects 404 for anon on team for POST too.
        if (hiddenFromViewer(request, type, name)) {
          return reply.code(404).send({ error: "not_found" });
        }
        return reply.code(400).send({ error: "run_invalid" });
      }
      const access = gateAccess(request, reply, type, name);
      if (!access) return;
      const { row } = access;
      const actor = actorFromRequest(request);
      const role = request.user!.role;
      if (!canManageEvals(db, actor, role, { id: row.id, owner: row.owner })) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const result = enqueueRun(db, config, {
        artifactId: row.id,
        type,
        name,
        actor,
        body,
      });
      if (result.status === 202) return reply.code(202).send({ run: result.run });
      return reply.code(result.status).send({ error: result.error });
    },
  );

  app.get<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/evals/runs",
    async (request, reply) => {
      const access = gateAccess(request, reply, request.params.type, request.params.name);
      if (!access) return;
      const { row } = access;
      const actor = actorFromRequest(request);
      if (!canManageEvals(db, actor, request.user!.role, { id: row.id, owner: row.owner })) {
        return reply.code(403).send({ error: "forbidden" });
      }
      return reply.code(200).send({ items: listRuns(db, row.id) });
    },
  );

  app.get<{ Params: { type: string; name: string; id: string } }>(
    "/api/v1/artifacts/:type/:name/evals/runs/:id",
    async (request, reply) => {
      const access = gateAccess(request, reply, request.params.type, request.params.name);
      if (!access) return;
      const { row } = access;
      const actor = actorFromRequest(request);
      if (!canManageEvals(db, actor, request.user!.role, { id: row.id, owner: row.owner })) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const runId = Number(request.params.id);
      if (!Number.isInteger(runId) || runId < 1)
        return reply.code(404).send({ error: "not_found" });
      const run = getRun(db, row.id, runId);
      if (!run) return reply.code(404).send({ error: "not_found" });
      return reply.code(200).send({ run });
    },
  );

  // cost-per-solve: runner x side cells of the latest compare and ablation runs, same rights as the runs.
  app.get<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/evals/cost",
    async (request, reply) => {
      const access = gateAccess(request, reply, request.params.type, request.params.name);
      if (!access) return;
      const { row } = access;
      const actor = actorFromRequest(request);
      if (!canManageEvals(db, actor, request.user!.role, { id: row.id, owner: row.owner })) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const runners = loadRunnersFile(config.evalRunnersFile).runners;
      return reply.code(200).send({ items: costMatrix(db, row.id, runners) });
    },
  );

  app.get<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/evals/journal",
    async (request, reply) => {
      const access = gateAccess(request, reply, request.params.type, request.params.name);
      if (!access) return;
      const { row } = access;
      const actor = actorFromRequest(request);
      if (!canManageEvals(db, actor, request.user!.role, { id: row.id, owner: row.owner })) {
        return reply.code(403).send({ error: "forbidden" });
      }
      return reply.code(200).send({ items: getEvalJournal(db, row.id) });
    },
  );

  app.post<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/evals/batches",
    async (request, reply) => {
      const { type, name } = request.params;
      const body = request.body;
      // Same order as POST /evals/runs: shallow shape errors 400, but a
      // team-invisible artifact still 404s first.
      if (!batchShapeOk(body)) {
        const row0 = getArtifactByTypeName(db, type, name);
        if (row0 && !row0.purged_at) {
          const viewer = request.user
            ? { username: request.user.username, role: request.user.role }
            : null;
          if (!canView(db, viewer, row0)) return reply.code(404).send({ error: "not_found" });
        }
        return reply.code(400).send({ error: "batch_invalid" });
      }
      const access = gateAccess(request, reply, type, name);
      if (!access) return;
      const { row } = access;
      const actor = actorFromRequest(request);
      if (!canManageEvals(db, actor, request.user!.role, { id: row.id, owner: row.owner })) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const result = createBatch(db, config, {
        artifactId: row.id,
        type,
        name,
        actor,
        body,
      });
      if (result.status === 202) return reply.code(202).send({ batch: result.batch });
      return reply.code(result.status).send({ error: result.error });
    },
  );

  app.get<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/evals/batches",
    async (request, reply) => {
      const access = gateAccess(request, reply, request.params.type, request.params.name);
      if (!access) return;
      const { row } = access;
      const actor = actorFromRequest(request);
      if (!canManageEvals(db, actor, request.user!.role, { id: row.id, owner: row.owner })) {
        return reply.code(403).send({ error: "forbidden" });
      }
      return reply.code(200).send({ items: listBatches(db, row.id).map(toBatchView) });
    },
  );

  app.get<{ Params: { type: string; name: string; id: string } }>(
    "/api/v1/artifacts/:type/:name/evals/batches/:id",
    async (request, reply) => {
      const access = gateAccess(request, reply, request.params.type, request.params.name);
      if (!access) return;
      const { row } = access;
      const actor = actorFromRequest(request);
      if (!canManageEvals(db, actor, request.user!.role, { id: row.id, owner: row.owner })) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const batchId = Number(request.params.id);
      if (!Number.isInteger(batchId) || batchId < 1)
        return reply.code(404).send({ error: "not_found" });
      const batch = getBatch(db, row.id, batchId);
      if (!batch) return reply.code(404).send({ error: "not_found" });
      return reply.code(200).send({ batch: toBatchView(batch), runs: batchChildren(db, batch.id) });
    },
  );
};
