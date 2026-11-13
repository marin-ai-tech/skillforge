import { toPublishFiles } from "../publish/files.ts";
import type { FastifyPluginAsync } from "fastify";
import { draftRuleMarkdown, draftSkillMarkdown, type HarvestRule } from "@skillforge/core";
import { requireRole } from "../auth/guard.ts";
import { appendSystemEvent } from "../audit/journal.ts";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db.ts";
import { HarvestInputError, harvestFromGitHub, parseHarvestRequest } from "../harvest/harvest.ts";
import { prepareArtifactPublish } from "../publish/artifact.ts";
import { commitPublish } from "../publish/commit.ts";
import { getArtifactByTypeName } from "../repo.ts";
import { GitHubError, gitHubClient } from "../rollout/github.ts";

type HarvestRow = {
  id: number;
  created_by: string;
  created_at: string;
  request: string;
  rules: string;
};

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** rule-artifacts: a draft is a rule by default; `type: "skill"` keeps the earlier skill draft. */
type DraftType = "rule" | "skill";

function draftType(raw: unknown): DraftType | null {
  if (raw === undefined) return "rule";
  return raw === "rule" || raw === "skill" ? raw : null;
}

function draftFile(type: DraftType, name: string, rules: HarvestRule[], origin: string) {
  return type === "rule"
    ? { path: `rules/${name}.md`, content: draftRuleMarkdown(name, rules, origin) }
    : { path: `${name}/SKILL.md`, content: draftSkillMarkdown(name, rules, origin) };
}

function view(r: HarvestRow) {
  return {
    id: r.id,
    created_by: r.created_by,
    created_at: r.created_at,
    request: JSON.parse(r.request) as { source: string; repo: string; days: number },
    rules: JSON.parse(r.rules) as HarvestRule[],
  };
}

/** Rule (or skill) drafts from recurring review rules (skill-harvest, rule-artifacts); admin only. */
export const harvestRoutes: FastifyPluginAsync<{ db: Database; config: AppConfig }> = async (
  app,
  opts,
) => {
  const { db, config } = opts;
  const byId = (id: number) =>
    db.prepare("SELECT * FROM harvests WHERE id = ?").get(id) as HarvestRow | undefined;

  app.post("/api/v1/harvests", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    let req;
    try {
      req = parseHarvestRequest(request.body);
    } catch (e) {
      if (e instanceof HarvestInputError)
        return reply.code(400).send({ error: "bad_request", message: e.message });
      throw e;
    }
    if (!config.githubToken) return reply.code(503).send({ error: "github_not_configured" });
    let rules;
    try {
      rules = await harvestFromGitHub(gitHubClient(config.githubApiUrl, config.githubToken), req);
    } catch (e) {
      if (e instanceof GitHubError)
        return reply.code(502).send({ error: "github_failed", message: e.message });
      throw e;
    }
    const id = Number(
      db
        .prepare(
          "INSERT INTO harvests (created_by, created_at, request, rules) VALUES (?, ?, ?, ?)",
        )
        .run(
          request.user.username,
          new Date().toISOString(),
          JSON.stringify(req),
          JSON.stringify(rules),
        ).lastInsertRowid,
    );
    appendSystemEvent(db, {
      actor: request.user.username,
      action: "harvest_create",
      target: String(id),
      meta: { ...req, rules: rules.length },
    });
    return reply.code(201).send({ harvest: view(byId(id)!) });
  });

  app.get("/api/v1/harvests", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    const rows = db
      .prepare("SELECT * FROM harvests ORDER BY id DESC LIMIT 100")
      .all() as HarvestRow[];
    return reply.send({ items: rows.map(view) });
  });

  app.post<{ Params: { id: string }; Body: { name?: unknown; type?: unknown } }>(
    "/api/v1/harvests/:id/draft",
    async (request, reply) => {
      if (!requireRole(request, reply, "admin")) return;
      const row = byId(Number(request.params.id));
      if (!row) return reply.code(404).send({ error: "not_found" });
      const name = request.body?.name;
      if (typeof name !== "string" || !NAME_RE.test(name)) {
        return reply.code(400).send({ error: "bad_request", message: "name must be kebab-case" });
      }
      const type = draftType(request.body?.type);
      if (!type) {
        return reply
          .code(400)
          .send({ error: "bad_request", message: "type must be rule or skill" });
      }
      const h = view(row);
      if (h.rules.length === 0) return reply.code(422).send({ error: "no_rules" });
      if (getArtifactByTypeName(db, type, name))
        return reply.code(409).send({ error: "name_taken" });
      const file = draftFile(type, name, h.rules, `reviews of ${h.request.repo}`);
      const ctx = {
        db,
        dataDir: config.dataDir,
        actor: request.user.username,
        role: request.user.role,
      };
      const stage = prepareArtifactPublish(ctx, {
        type,
        files: toPublishFiles([file]),
        provenance: { source: "harvest", ref: `harvest:${h.id}` },
      });
      if (stage.kind !== "ready") return reply.code(422).send({ error: stage.kind, detail: stage });
      const result = commitPublish(ctx, {
        ...stage.prepared,
        provenance: stage.provenance,
      } as never);
      if (result.kind !== "created") return reply.code(422).send({ error: result.kind });
      return reply.code(201).send({ artifact: result.artifact, version: result.version.version });
    },
  );
};
