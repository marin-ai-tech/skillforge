import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../auth/guard.ts";
import { appendSystemEvent } from "../audit/journal.ts";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db.ts";
import { gitHubClient } from "../rollout/github.ts";
import {
  RolloutInputError,
  parseRolloutRequest,
  planRollout,
  runRollout,
  type RepoResult,
  type RolloutRequest,
} from "../rollout/rollout.ts";

type RolloutRow = {
  id: number;
  created_by: string;
  created_at: string;
  request: string;
  results: string | null;
};

function view(r: RolloutRow) {
  return {
    id: r.id,
    created_by: r.created_by,
    created_at: r.created_at,
    request: JSON.parse(r.request) as RolloutRequest,
    results: r.results ? (JSON.parse(r.results) as RepoResult[]) : [],
  };
}

/** Rollout through pull requests (pr-rollout); admin only, GitHub token from the environment only. */
export const rolloutRoutes: FastifyPluginAsync<{
  db: Database;
  config: AppConfig;
  dataDir: string;
}> = async (app, opts) => {
  const { db, config, dataDir } = opts;

  app.post("/api/v1/rollouts", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    if (!config.githubToken) return reply.code(503).send({ error: "github_not_configured" });
    let req;
    let plan;
    try {
      req = parseRolloutRequest(request.body);
      plan = planRollout(db, dataDir, req);
    } catch (e) {
      if (e instanceof RolloutInputError) {
        return reply.code(e.status).send({ error: e.code, message: e.message });
      }
      throw e;
    }
    const id = Number(
      db
        .prepare("INSERT INTO rollouts (created_by, created_at, request) VALUES (?, ?, ?)")
        .run(request.user.username, new Date().toISOString(), JSON.stringify(req)).lastInsertRowid,
    );
    const registry = config.publicUrl ?? config.baseUrl;
    const gh = gitHubClient(config.githubApiUrl, config.githubToken);
    const results = await runRollout(gh, req.repos, { id, registry, plan });
    db.prepare("UPDATE rollouts SET results = ? WHERE id = ?").run(JSON.stringify(results), id);
    appendSystemEvent(db, {
      actor: request.user.username,
      action: "rollout_create",
      target: String(id),
      meta: { ...req, opened: results.filter((r) => r.status === "opened").length },
    });
    const row = db.prepare("SELECT * FROM rollouts WHERE id = ?").get(id) as RolloutRow;
    return reply.code(201).send({ rollout: view(row) });
  });

  app.get("/api/v1/rollouts", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    const rows = db
      .prepare("SELECT * FROM rollouts ORDER BY id DESC LIMIT 100")
      .all() as RolloutRow[];
    return reply.send({ items: rows.map(view), configured: Boolean(config.githubToken) });
  });
};
