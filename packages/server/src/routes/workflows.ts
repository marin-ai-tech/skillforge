import type { FastifyPluginAsync } from "fastify";
import { isArtifactType } from "@skillforge/core";
import type { Database } from "../db.ts";
import { requireRole, requireUser } from "../auth/guard.ts";
import { actorFromRequest } from "../actor.ts";
import { appendAudit, getArtifactByTypeName } from "../repo.ts";
import { canView } from "../visibility/index.ts";
import { canManageEvals } from "../evals/suite.ts";
import {
  deleteWorkflow,
  getRun,
  getWorkflow,
  listRuns,
  listSteps,
  listWorkflows,
  runToView,
  upsertWorkflow,
} from "../workflows/model.ts";
import { isWorkflowId, validateDefinition } from "../workflows/validate.ts";
import {
  cancelWaiting,
  decideGate,
  enqueueRun,
  replayRun,
  requestCancel,
  resumeRun,
} from "../workflows/engine.ts";
import { TEMPLATES, TemplateError, definitionFromTemplate } from "../workflows/templates.ts";

/** Max queued+running runs per artifact — anti-pileup backpressure. */
const MAX_ACTIVE_RUNS = 10;

export type WorkflowsPluginOpts = {
  db: Database;
  dataDir: string;
  /** Operator switch (SKILLFORGE_ORCHESTRATION_ENABLED): off → all routes 403 feature_disabled. */
  enabled: boolean;
};

export const workflowsRoutes: FastifyPluginAsync<WorkflowsPluginOpts> = async (app, opts) => {
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
    "/api/v1/artifacts/:type/:name/workflows",
    async (request, reply) => {
      const access = gate(request, reply, request.params.type, request.params.name);
      if (!access) return;
      const items = listWorkflows(db, access.artifactId).map((w) => ({
        workflow_id: w.workflow_id,
        name: w.name,
        updated_at: w.updated_at,
        updated_by: w.updated_by,
      }));
      reply.header("Cache-Control", "no-store");
      return reply.send({ items });
    },
  );

  app.get<{ Params: { type: string; name: string; wf: string } }>(
    "/api/v1/artifacts/:type/:name/workflows/:wf",
    async (request, reply) => {
      const access = gate(request, reply, request.params.type, request.params.name);
      if (!access) return;
      const row = getWorkflow(db, access.artifactId, request.params.wf);
      if (!row) return reply.code(404).send({ error: "not_found" });
      reply.header("Cache-Control", "no-store");
      return reply.send({
        workflow: {
          workflow_id: row.workflow_id,
          name: row.name,
          definition: JSON.parse(row.definition),
          created_at: row.created_at,
          updated_at: row.updated_at,
        },
      });
    },
  );

  app.put<{ Params: { type: string; name: string; wf: string }; Body: { definition?: unknown } }>(
    "/api/v1/artifacts/:type/:name/workflows/:wf",
    async (request, reply) => {
      const access = gate(request, reply, request.params.type, request.params.name);
      if (!access) return;
      if (!isWorkflowId(request.params.wf)) {
        return reply.code(422).send({ error: "invalid_workflow_id", errors: ["workflow_id"] });
      }
      const body = (request.body ?? {}) as { definition?: unknown };
      const parsed = validateDefinition(body.definition);
      if (!parsed.ok) {
        return reply.code(422).send({ error: "invalid_definition", errors: parsed.errors });
      }
      if (!requireRole(request, reply, "admin")) return;
      const actor = actorFromRequest(request);
      upsertWorkflow(db, {
        artifactId: access.artifactId,
        workflowId: request.params.wf,
        name: parsed.definition.name,
        definition: JSON.stringify(parsed.definition),
        actor,
        now: new Date().toISOString(),
      });
      appendAudit(db, {
        ts: new Date().toISOString(),
        actor,
        artifact_id: access.artifactId,
        version: null,
        action: "workflow_save",
        meta: { workflow_id: request.params.wf },
      });
      return reply.send({ workflow_id: request.params.wf, ok: true });
    },
  );

  app.delete<{ Params: { type: string; name: string; wf: string } }>(
    "/api/v1/artifacts/:type/:name/workflows/:wf",
    async (request, reply) => {
      const access = gate(request, reply, request.params.type, request.params.name);
      if (!access) return;
      if (!getWorkflow(db, access.artifactId, request.params.wf)) {
        return reply.code(404).send({ error: "not_found" });
      }
      if (!requireRole(request, reply, "admin")) return;
      if (!deleteWorkflow(db, access.artifactId, request.params.wf)) {
        return reply.code(404).send({ error: "not_found" });
      }
      appendAudit(db, {
        ts: new Date().toISOString(),
        actor: actorFromRequest(request),
        artifact_id: access.artifactId,
        version: null,
        action: "workflow_delete",
        meta: { workflow_id: request.params.wf },
      });
      return reply.code(204).send();
    },
  );

  app.post<{
    Params: { type: string; name: string; wf: string };
    Body: { input?: unknown };
  }>("/api/v1/artifacts/:type/:name/workflows/:wf/runs", async (request, reply) => {
    const access = gate(request, reply, request.params.type, request.params.name);
    if (!access) return;
    const wf = getWorkflow(db, access.artifactId, request.params.wf);
    if (!wf) return reply.code(404).send({ error: "not_found" });
    const active = db
      .prepare(
        `SELECT COUNT(*) AS n FROM workflow_runs
         WHERE artifact_id = ? AND status IN ('queued', 'running')`,
      )
      .get(access.artifactId) as { n: number | bigint };
    if (Number(active.n) >= MAX_ACTIVE_RUNS) {
      return reply.code(429).send({ error: "queue_full" });
    }
    let inputJson: string | null = null;
    if ((request.body as { input?: unknown } | undefined)?.input !== undefined) {
      inputJson = JSON.stringify((request.body as { input: unknown }).input);
      if (inputJson.length > 64 * 1024) {
        return reply.code(422).send({ error: "input_too_large" });
      }
    }
    const runId = enqueueRun(db, dataDir, {
      artifactId: access.artifactId,
      workflowId: wf.workflow_id,
      defJson: wf.definition,
      inputJson,
      actor: actorFromRequest(request),
    });
    const run = getRun(db, access.artifactId, runId)!;
    return reply.code(202).send({ run: runToView(run) });
  });

  app.get<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/workflows/runs",
    async (request, reply) => {
      const access = gate(request, reply, request.params.type, request.params.name);
      if (!access) return;
      reply.header("Cache-Control", "no-store");
      return reply.send({ items: listRuns(db, access.artifactId).map((r) => runToView(r)) });
    },
  );

  app.get<{ Params: { type: string; name: string; id: string } }>(
    "/api/v1/artifacts/:type/:name/workflows/runs/:id",
    async (request, reply) => {
      const access = gate(request, reply, request.params.type, request.params.name);
      if (!access) return;
      if (!/^[1-9]\d{0,15}$/u.test(request.params.id)) {
        return reply.code(404).send({ error: "not_found" });
      }
      const run = getRun(db, access.artifactId, Number(request.params.id));
      if (!run) return reply.code(404).send({ error: "not_found" });
      reply.header("Cache-Control", "no-store");
      return reply.send({
        run: runToView(run, listSteps(db, run.id)),
      });
    },
  );

  app.post<{ Params: { type: string; name: string; id: string } }>(
    "/api/v1/artifacts/:type/:name/workflows/runs/:id/cancel",
    async (request, reply) => {
      const access = gate(request, reply, request.params.type, request.params.name);
      if (!access) return;
      const run = /^[1-9]\d{0,15}$/u.test(request.params.id)
        ? getRun(db, access.artifactId, Number(request.params.id))
        : undefined;
      if (!run) return reply.code(404).send({ error: "not_found" });
      if (run.status === "waiting") {
        cancelWaiting(db, dataDir, access.artifactId, run.id);
        return reply.send({ ok: true });
      }
      if (!["queued", "running"].includes(run.status)) {
        return reply.code(409).send({ error: "run_finished" });
      }
      requestCancel(db, access.artifactId, run.id);
      return reply.send({ ok: true });
    },
  );

  app.post<{ Params: { type: string; name: string; id: string } }>(
    "/api/v1/artifacts/:type/:name/workflows/runs/:id/replay",
    async (request, reply) => {
      const access = gate(request, reply, request.params.type, request.params.name);
      if (!access) return;
      const run = /^[1-9]\d{0,15}$/u.test(request.params.id)
        ? getRun(db, access.artifactId, Number(request.params.id))
        : undefined;
      if (!run) return reply.code(404).send({ error: "not_found" });
      const newId = replayRun(db, dataDir, access.artifactId, run.id, actorFromRequest(request));
      if (newId === null) return reply.code(404).send({ error: "not_found" });
      return reply.code(202).send({ run: runToView(getRun(db, access.artifactId, newId)!) });
    },
  );

  // workflow gates: templates, a definition from a template, the decision on a gate, resume.
  app.get("/api/v1/workflow-templates", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    return reply.send({ items: TEMPLATES });
  });

  app.post<{ Params: { type: string; name: string; wf: string } }>(
    "/api/v1/artifacts/:type/:name/workflows/:wf/from-template",
    async (request, reply) => {
      const access = gate(request, reply, request.params.type, request.params.name);
      if (!access) return;
      if (!requireRole(request, reply, "admin")) return;
      if (!isWorkflowId(request.params.wf)) {
        return reply.code(422).send({ error: "invalid_workflow_id", errors: ["workflow_id"] });
      }
      let raw;
      try {
        raw = definitionFromTemplate(request.body);
      } catch (e) {
        if (e instanceof TemplateError) {
          return reply.code(422).send({ error: "invalid_template", errors: [e.message] });
        }
        throw e;
      }
      const parsed = validateDefinition(raw);
      if (!parsed.ok) {
        return reply.code(422).send({ error: "invalid_definition", errors: parsed.errors });
      }
      const actor = actorFromRequest(request);
      const now = new Date().toISOString();
      upsertWorkflow(db, {
        artifactId: access.artifactId,
        workflowId: request.params.wf,
        name: parsed.definition.name,
        definition: JSON.stringify(parsed.definition),
        actor,
        now,
      });
      appendAudit(db, {
        ts: now,
        actor,
        artifact_id: access.artifactId,
        version: null,
        action: "workflow_save",
        meta: { workflow_id: request.params.wf, template: "epic-with-gates" },
      });
      return reply.send({
        workflow_id: request.params.wf,
        ok: true,
        definition: parsed.definition,
      });
    },
  );

  app.post<{
    Params: { type: string; name: string; id: string; step: string };
    Body: { decision?: unknown; reason?: unknown };
  }>("/api/v1/artifacts/:type/:name/workflows/runs/:id/gates/:step", async (request, reply) => {
    const access = gate(request, reply, request.params.type, request.params.name);
    if (!access) return;
    const run = /^[1-9]\d{0,15}$/u.test(request.params.id)
      ? getRun(db, access.artifactId, Number(request.params.id))
      : undefined;
    if (!run) return reply.code(404).send({ error: "not_found" });
    const { decision, reason } = request.body ?? {};
    if (decision !== "approve" && decision !== "reject") {
      return reply
        .code(400)
        .send({ error: "bad_request", message: "decision must be approve or reject" });
    }
    if (reason !== undefined && (typeof reason !== "string" || reason.length > 500)) {
      return reply
        .code(400)
        .send({ error: "bad_request", message: "reason must be up to 500 characters" });
    }
    const result = decideGate(db, dataDir, run, request.params.step, {
      decision,
      reason: typeof reason === "string" ? reason : null,
      actor: actorFromRequest(request),
    });
    if (result !== "ok") return reply.code(409).send({ error: "not_waiting" });
    return reply.send({ run: runToView(getRun(db, access.artifactId, run.id)!) });
  });

  app.post<{ Params: { type: string; name: string; id: string } }>(
    "/api/v1/artifacts/:type/:name/workflows/runs/:id/resume",
    async (request, reply) => {
      const access = gate(request, reply, request.params.type, request.params.name);
      if (!access) return;
      const run = /^[1-9]\d{0,15}$/u.test(request.params.id)
        ? getRun(db, access.artifactId, Number(request.params.id))
        : undefined;
      if (!run) return reply.code(404).send({ error: "not_found" });
      if (resumeRun(db, dataDir, run, actorFromRequest(request)) !== "ok") {
        return reply.code(409).send({ error: "not_stopped" });
      }
      return reply.code(202).send({ run: runToView(getRun(db, access.artifactId, run.id)!) });
    },
  );
};
