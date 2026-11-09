import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.ts";
import { requireRole, requireUser } from "../auth/guard.ts";
import type { Database } from "../db.ts";
import { getLifecycleBoard } from "../lifecycle/board.ts";
import { computeOverhang, listOverhang } from "../lifecycle/overhang.ts";
import { canView } from "../visibility/index.ts";
import { runAgingSweep } from "../lifecycle/sweep.ts";
import { transitionArtifact, validateVersion } from "../lifecycle/transitions.ts";
import { collectSignals, policyFromConfig, wouldTransition } from "../lifecycle/policy.ts";
import { deleteHold, getActiveHold, parseHoldBody, upsertHold } from "../lifecycle/holds.ts";
import { appendAudit, getArtifactByTypeName } from "../repo.ts";
import { isArtifactType, type ArtifactType } from "@skillforge/core";

function isKnownType(type: string): type is ArtifactType {
  return isArtifactType(type);
}

const transitionBodySchema = z.object({
  to: z.string().min(1),
  reason: z.string().max(500).optional().nullable(),
});

const batchTransitionBodySchema = z.object({
  items: z
    .array(
      z.object({
        type: z.string().min(1),
        name: z.string().min(1),
        to: z.string().min(1),
        reason: z.string().max(500).optional().nullable(),
      }),
    )
    .min(1)
    .max(100),
  reason: z.string().max(500).optional().nullable(),
});

const validateBodySchema = z.object({
  model_compat: z.array(z.string()).optional(),
  note: z.string().max(500).optional().nullable(),
});

const sweepBodySchema = z.object({
  dry_run: z.boolean().optional(),
});

export type LifecyclePluginOpts = {
  db: Database;
  config: AppConfig;
};

export const lifecycleRoutes: FastifyPluginAsync<LifecyclePluginOpts> = async (app, opts) => {
  const { db, config } = opts;
  const policy = () => policyFromConfig(config);

  app.post<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/transitions",
    async (request, reply) => {
      if (!requireRole(request, reply, "reviewer")) return;
      const { type, name } = request.params;
      if (!isKnownType(type)) {
        return reply.code(404).send({ error: "not_found" });
      }
      const parsed = transitionBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        if (issue?.path[0] === "reason") {
          return reply
            .code(400)
            .send({ error: "bad_request", message: "reason must be at most 500 characters" });
        }
        return reply.code(400).send({ error: "bad_request" });
      }
      const result = transitionArtifact(db, {
        type,
        name,
        to: parsed.data.to,
        reason: parsed.data.reason,
        actor: request.user.username,
        actorRole: request.user.role,
        localMode: config.authMode === "local",
      });
      if (!result.ok) {
        return reply.code(result.status).send(result.body);
      }
      return reply.code(200).send({ artifact: result.artifact, event: result.event });
    },
  );

  app.post("/api/v1/lifecycle/batch-transitions", async (request, reply) => {
    if (!requireRole(request, reply, "reviewer")) return;
    const parsed = batchTransitionBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      if (issue?.path.includes("reason")) {
        return reply
          .code(400)
          .send({ error: "bad_request", message: "reason must be at most 500 characters" });
      }
      return reply.code(400).send({ error: "bad_request" });
    }
    const batchReason = parsed.data.reason;
    const results: Array<{ type: string; name: string; ok: boolean; error?: string }> = [];
    for (const item of parsed.data.items) {
      if (!isKnownType(item.type)) {
        results.push({ type: item.type, name: item.name, ok: false, error: "not_found" });
        continue;
      }
      const result = transitionArtifact(db, {
        type: item.type,
        name: item.name,
        to: item.to,
        reason: item.reason ?? batchReason,
        actor: request.user.username,
        actorRole: request.user.role,
        localMode: config.authMode === "local",
      });
      if (!result.ok) {
        const err = typeof result.body.error === "string" ? result.body.error : "transition_failed";
        results.push({ type: item.type, name: item.name, ok: false, error: err });
      } else {
        results.push({ type: item.type, name: item.name, ok: true });
      }
    }
    return reply.code(200).send({ results });
  });

  app.post<{ Params: { type: string; name: string; version: string } }>(
    "/api/v1/artifacts/:type/:name/versions/:version/validate",
    async (request, reply) => {
      if (!requireRole(request, reply, "reviewer")) return;
      const { type, name, version } = request.params;
      if (!isKnownType(type)) {
        return reply.code(404).send({ error: "not_found" });
      }
      const parsed = validateBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request" });
      }
      const result = validateVersion(db, {
        type,
        name,
        version,
        model_compat: parsed.data.model_compat,
        note: parsed.data.note,
        actor: request.user.username,
      });
      if (!result.ok) {
        return reply.code(result.status).send(result.body);
      }
      return reply.code(200).send(result.detail);
    },
  );

  app.get("/api/v1/lifecycle/overhang", async (request, reply) => {
    if (!requireRole(request, reply, "reviewer")) return;
    const viewer = request.user
      ? { username: request.user.username, role: request.user.role }
      : null;
    return reply.code(200).send({ items: listOverhang(db, viewer, policy(), Date.now()) });
  });

  app.get<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/overhang",
    async (request, reply) => {
      const { type, name } = request.params;
      if (!isKnownType(type)) return reply.code(404).send({ error: "not_found" });
      const row = getArtifactByTypeName(db, type, name);
      if (!row || row.purged_at) return reply.code(404).send({ error: "not_found" });
      const viewer = request.user
        ? { username: request.user.username, role: request.user.role }
        : null;
      if (!canView(db, viewer, row)) return reply.code(404).send({ error: "not_found" });
      if (!requireUser(request, reply)) return;
      if (!requireRole(request, reply, "reviewer")) return;
      return reply.code(200).send(computeOverhang(db, row, policy(), Date.now()));
    },
  );

  app.get("/api/v1/lifecycle/board", async (request, reply) => {
    const viewer = request.user
      ? { username: request.user.username, role: request.user.role }
      : null;
    return reply.code(200).send(getLifecycleBoard(db, config.candidateTtlDays, viewer, policy()));
  });

  app.get("/api/v1/admin/lifecycle/policy", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    const p = policy();
    return reply.code(200).send({
      enabled: p.dataLifecycleEnabled,
      aging_days: p.agingDays,
      zombie_idle_days: p.zombieIdleDays,
      zombie_window_days: p.zombieWindowDays,
      zombie_min_uses: p.zombieMinUses,
      zombie_min_reporters: p.zombieMinReporters,
      zombie_transfer_rate: p.zombieTransferRate,
      zombie_retire_days: p.zombieRetireDays,
      ablation_min_tasks: p.ablationMinTasks,
      revive_window_days: p.reviveWindowDays,
      revive_min_events: p.reviveMinEvents,
      max_per_sweep: p.maxPerSweep,
    });
  });

  app.post("/api/v1/admin/lifecycle/sweep", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    const parsed = sweepBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request" });
    }
    const result = runAgingSweep(db, policy(), { dry_run: parsed.data.dry_run === true });
    return reply.code(200).send(result);
  });

  app.get<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/lifecycle",
    async (request, reply) => {
      const { type, name } = request.params;
      if (!isKnownType(type)) return reply.code(404).send({ error: "not_found" });
      const row = getArtifactByTypeName(db, type, name);
      if (!row) return reply.code(404).send({ error: "not_found" });
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const p = policy();
      const signals = collectSignals(db, row.id, row.latest_version, p, nowMs);
      const decision = wouldTransition(db, row, p, nowMs);
      const hold = getActiveHold(db, row.id, nowIso);
      return reply.code(200).send({
        status: row.status,
        hold: hold
          ? {
              until: hold.until,
              reason: hold.reason,
              set_by: hold.set_by,
              set_at: hold.set_at,
            }
          : null,
        signals,
        would_transition: decision
          ? { to: decision.to, rule: decision.rule, metrics: decision.metrics }
          : null,
      });
    },
  );

  app.put<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/lifecycle-hold",
    async (request, reply) => {
      if (!requireRole(request, reply, "reviewer")) return;
      const { type, name } = request.params;
      if (!isKnownType(type)) return reply.code(404).send({ error: "not_found" });

      const nowMs = Date.now();
      const parsed = parseHoldBody(request.body, nowMs);
      if (!parsed.ok) return reply.code(400).send({ error: parsed.error });

      db.exec("BEGIN IMMEDIATE");
      try {
        const row = getArtifactByTypeName(db, type, name);
        if (!row) {
          db.exec("ROLLBACK");
          return reply.code(404).send({ error: "not_found" });
        }
        if (row.owner === request.user.username) {
          db.exec("ROLLBACK");
          return reply.code(403).send({ error: "forbidden" });
        }
        const nowIso = new Date(nowMs).toISOString();
        upsertHold(db, row.id, {
          until: parsed.until,
          reason: parsed.reason,
          set_by: request.user.username,
          set_at: nowIso,
        });
        appendAudit(db, {
          ts: nowIso,
          actor: request.user.username,
          artifact_id: row.id,
          version: null,
          action: "lifecycle_hold",
          meta: { until: parsed.until, reason: parsed.reason, op: "set" },
        });
        db.exec("COMMIT");
        return reply.code(200).send({
          hold: {
            until: parsed.until,
            reason: parsed.reason,
            set_by: request.user.username,
            set_at: nowIso,
          },
        });
      } catch (e) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* ignore */
        }
        throw e;
      }
    },
  );

  app.delete<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/lifecycle-hold",
    async (request, reply) => {
      if (!requireRole(request, reply, "reviewer")) return;
      const { type, name } = request.params;
      if (!isKnownType(type)) return reply.code(404).send({ error: "not_found" });

      db.exec("BEGIN IMMEDIATE");
      try {
        const row = getArtifactByTypeName(db, type, name);
        if (!row) {
          db.exec("ROLLBACK");
          return reply.code(404).send({ error: "not_found" });
        }
        if (row.owner === request.user.username) {
          db.exec("ROLLBACK");
          return reply.code(403).send({ error: "forbidden" });
        }
        const nowIso = new Date().toISOString();
        deleteHold(db, row.id);
        appendAudit(db, {
          ts: nowIso,
          actor: request.user.username,
          artifact_id: row.id,
          version: null,
          action: "lifecycle_hold",
          meta: { op: "clear" },
        });
        db.exec("COMMIT");
        return reply.code(200).send({ hold: null });
      } catch (e) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* ignore */
        }
        throw e;
      }
    },
  );
};
