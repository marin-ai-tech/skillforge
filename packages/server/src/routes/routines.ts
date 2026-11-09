import type { FastifyPluginAsync } from "fastify";
import { isArtifactType } from "@skillforge/core";
import type { Database } from "../db.ts";
import { requireRole, requireUser } from "../auth/guard.ts";
import { actorFromRequest } from "../actor.ts";
import { appendAudit, getArtifactByTypeName } from "../repo.ts";
import { canView } from "../visibility/index.ts";
import { canManageEvals } from "../evals/suite.ts";
import {
  deleteRoutine,
  getRoutine,
  getRun,
  listRoutines,
  listRuns,
  upsertRoutine,
  type RoutineRunRow,
} from "../routines/model.ts";
import { isRoutineId, nextRunAt, validateRoutineDefinition } from "../routines/schedule.ts";
import { enqueueRun } from "../routines/runner.ts";

export type RoutinesPluginOpts = {
  db: Database;
  dataDir: string;
  /** Operator switch (SKILLFORGE_ORCHESTRATION_ENABLED): off → all routes 403 feature_disabled. */
  enabled: boolean;
};

function runToView(row: RoutineRunRow) {
  const { artifact_id: _a, ...rest } = row;
  return rest;
}

export const routinesRoutes: FastifyPluginAsync<RoutinesPluginOpts> = async (app, opts) => {
  const { db, dataDir, enabled } = opts;

  if (!enabled) {
    app.addHook("onRequest", async (_request, reply) => {
      return reply.code(403).send({ error: "feature_disabled", feature: "orchestration" });
    });
  }

  // Team-invisible artifacts 404 before auth (same gate as evals).
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

  /** Visibility → auth → mcp ban → manage right. Returns artifact row or null (reply sent). */
  function gate(
    request: Parameters<typeof requireUser>[0],
    reply: Parameters<typeof requireUser>[1],
    type: string,
    name: string,
  ): { artifactId: string } | null {
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
    const actor = actorFromRequest(request);
    if (!canManageEvals(db, actor, request.user!.role, { id: row.id, owner: row.owner })) {
      void reply.code(403).send({ error: "forbidden" });
      return null;
    }
    return { artifactId: row.id };
  }

  app.get<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/routines",
    async (request, reply) => {
      const access = gate(request, reply, request.params.type, request.params.name);
      if (!access) return;
      const items = listRoutines(db, access.artifactId).map((r) => ({
        routine_id: r.routine_id,
        name: r.name,
        enabled: r.enabled,
        next_run_at: r.next_run_at,
        last_run_at: r.last_run_at,
        consecutive_failures: r.consecutive_failures,
        updated_at: r.updated_at,
        updated_by: r.updated_by,
      }));
      reply.header("Cache-Control", "no-store");
      return reply.send({ items });
    },
  );

  app.get<{ Params: { type: string; name: string; rt: string } }>(
    "/api/v1/artifacts/:type/:name/routines/:rt",
    async (request, reply) => {
      const access = gate(request, reply, request.params.type, request.params.name);
      if (!access) return;
      const row = getRoutine(db, access.artifactId, request.params.rt);
      if (!row) return reply.code(404).send({ error: "not_found" });
      reply.header("Cache-Control", "no-store");
      return reply.send({
        routine: {
          routine_id: row.routine_id,
          name: row.name,
          enabled: row.enabled,
          next_run_at: row.next_run_at,
          last_run_at: row.last_run_at,
          consecutive_failures: row.consecutive_failures,
          definition: JSON.parse(row.definition),
          created_at: row.created_at,
          updated_at: row.updated_at,
        },
      });
    },
  );

  app.put<{ Params: { type: string; name: string; rt: string }; Body: { definition?: unknown } }>(
    "/api/v1/artifacts/:type/:name/routines/:rt",
    async (request, reply) => {
      const access = gate(request, reply, request.params.type, request.params.name);
      if (!access) return;
      if (!isRoutineId(request.params.rt)) {
        return reply.code(422).send({ error: "invalid_routine_id", errors: ["routine_id"] });
      }
      const body = (request.body ?? {}) as { definition?: unknown };
      const parsed = validateRoutineDefinition(body.definition);
      if (!parsed.ok) {
        return reply.code(422).send({ error: "invalid_definition", errors: parsed.errors });
      }
      if (!requireRole(request, reply, "admin")) return;
      const actor = actorFromRequest(request);
      upsertRoutine(db, {
        artifactId: access.artifactId,
        routineId: request.params.rt,
        name: parsed.definition.name,
        definition: JSON.stringify(parsed.definition),
        enabled: parsed.definition.enabled ? 1 : 0,
        nextRunAt: parsed.definition.enabled
          ? nextRunAt(parsed.definition.schedule, new Date())
          : null,
        actor,
        now: new Date().toISOString(),
      });
      appendAudit(db, {
        ts: new Date().toISOString(),
        actor,
        artifact_id: access.artifactId,
        version: null,
        action: "routine_save",
        meta: { routine_id: request.params.rt },
      });
      return reply.send({ routine_id: request.params.rt, ok: true });
    },
  );

  app.delete<{ Params: { type: string; name: string; rt: string } }>(
    "/api/v1/artifacts/:type/:name/routines/:rt",
    async (request, reply) => {
      const access = gate(request, reply, request.params.type, request.params.name);
      if (!access) return;
      if (!getRoutine(db, access.artifactId, request.params.rt)) {
        return reply.code(404).send({ error: "not_found" });
      }
      if (!requireRole(request, reply, "admin")) return;
      if (!deleteRoutine(db, access.artifactId, request.params.rt)) {
        return reply.code(404).send({ error: "not_found" });
      }
      appendAudit(db, {
        ts: new Date().toISOString(),
        actor: actorFromRequest(request),
        artifact_id: access.artifactId,
        version: null,
        action: "routine_delete",
        meta: { routine_id: request.params.rt },
      });
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { type: string; name: string; rt: string } }>(
    "/api/v1/artifacts/:type/:name/routines/:rt/run",
    async (request, reply) => {
      const access = gate(request, reply, request.params.type, request.params.name);
      if (!access) return;
      const rt = getRoutine(db, access.artifactId, request.params.rt);
      if (!rt) return reply.code(404).send({ error: "not_found" });
      const parsed = validateRoutineDefinition(JSON.parse(rt.definition));
      const runId = enqueueRun(db, dataDir, {
        artifactId: access.artifactId,
        routineId: rt.routine_id,
        trigger: "manual",
        actor: actorFromRequest(request),
        maxPerDay: parsed.ok ? parsed.definition.budgets.max_runs_per_day : null,
      });
      if (runId === "budget") {
        return reply.code(429).send({ error: "budget_exhausted" });
      }
      const run = getRun(db, access.artifactId, runId)!;
      return reply.code(202).send({ run: runToView(run) });
    },
  );

  app.post<{ Params: { type: string; name: string; rt: string } }>(
    "/api/v1/artifacts/:type/:name/routines/:rt/disable",
    async (request, reply) => {
      const access = gate(request, reply, request.params.type, request.params.name);
      if (!access) return;
      const rt = getRoutine(db, access.artifactId, request.params.rt);
      if (!rt) return reply.code(404).send({ error: "not_found" });
      db.prepare(
        "UPDATE routines SET enabled = 0, next_run_at = NULL WHERE artifact_id = ? AND routine_id = ?",
      ).run(access.artifactId, rt.routine_id);
      appendAudit(db, {
        ts: new Date().toISOString(),
        actor: actorFromRequest(request),
        artifact_id: access.artifactId,
        version: null,
        action: "routine_disabled",
        meta: { routine_id: rt.routine_id },
      });
      return reply.send({ routine_id: rt.routine_id, enabled: 0 });
    },
  );

  app.post<{ Params: { type: string; name: string; rt: string } }>(
    "/api/v1/artifacts/:type/:name/routines/:rt/enable",
    async (request, reply) => {
      const access = gate(request, reply, request.params.type, request.params.name);
      if (!access) return;
      const rt = getRoutine(db, access.artifactId, request.params.rt);
      if (!rt) return reply.code(404).send({ error: "not_found" });
      if (!requireRole(request, reply, "admin")) return;
      const parsed = validateRoutineDefinition(JSON.parse(rt.definition));
      // Re-enabling starts a fresh failure budget.
      db.prepare(
        `UPDATE routines SET enabled = 1, consecutive_failures = 0, next_run_at = ?
         WHERE artifact_id = ? AND routine_id = ?`,
      ).run(
        parsed.ok ? nextRunAt(parsed.definition.schedule, new Date()) : null,
        access.artifactId,
        rt.routine_id,
      );
      appendAudit(db, {
        ts: new Date().toISOString(),
        actor: actorFromRequest(request),
        artifact_id: access.artifactId,
        version: null,
        action: "routine_enabled",
        meta: { routine_id: rt.routine_id },
      });
      return reply.send({ routine_id: rt.routine_id, enabled: 1 });
    },
  );

  app.get<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/routines/runs",
    async (request, reply) => {
      const access = gate(request, reply, request.params.type, request.params.name);
      if (!access) return;
      reply.header("Cache-Control", "no-store");
      return reply.send({ items: listRuns(db, access.artifactId).map(runToView) });
    },
  );

  app.get<{ Params: { type: string; name: string; id: string } }>(
    "/api/v1/artifacts/:type/:name/routines/runs/:id",
    async (request, reply) => {
      const access = gate(request, reply, request.params.type, request.params.name);
      if (!access) return;
      if (!/^[1-9]\d{0,15}$/u.test(request.params.id)) {
        return reply.code(404).send({ error: "not_found" });
      }
      const run = getRun(db, access.artifactId, Number(request.params.id));
      if (!run) return reply.code(404).send({ error: "not_found" });
      reply.header("Cache-Control", "no-store");
      return reply.send({ run: runToView(run) });
    },
  );
};
