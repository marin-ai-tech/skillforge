import type { FastifyPluginAsync } from "fastify";
import { requireUser } from "../auth/guard.ts";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db.ts";
import { isMaintainer } from "../ownership.ts";
import { getArtifactByTypeName } from "../repo.ts";
import { canView } from "../visibility/index.ts";
import { cardOf, versionDescriptor } from "../mcp-registry/descriptor.ts";
import { mcpUsage } from "../mcp-registry/usage.ts";
import { cardRelease, checkRelease, mcpReleaseSettings } from "../mcp-registry/release-check.ts";
import { mcpPolicyVerdict } from "../mcp-policy/policy.ts";

/**
 * The MCP part of an mcp-server card (mcp-server-card): descriptor without values, the current policy's verdict and
 * usage counts from the inventory. Visibility comes from the global :type/:name gate in app.ts.
 */
export const mcpServerCardRoutes: FastifyPluginAsync<{ db: Database; config: AppConfig }> = async (
  app,
  opts,
) => {
  const { db, config } = opts;

  app.get<{ Params: { type: string; name: string }; Querystring: { version?: string } }>(
    "/api/v1/artifacts/:type/:name/mcp",
    async (request, reply) => {
      const { type, name } = request.params;
      if (type !== "mcp-server") return reply.code(404).send({ error: "not_found" });
      const row = getArtifactByTypeName(db, type, name);
      const version =
        typeof request.query.version === "string" ? request.query.version : row?.latest_version;
      if (!row || row.purged_at || !version) return reply.code(404).send({ error: "not_found" });
      const d = versionDescriptor(db, config.dataDir, row.id, version);
      if (!d) return reply.code(404).send({ error: "not_found" });
      const card = cardOf(d.obj);
      return reply.send({
        version,
        ...card,
        policy: mcpPolicyVerdict(db, { canonical: [{ path: "server.json", content: d.raw }] }),
        usage: mcpUsage(db, card),
        release: cardRelease(db, row.id, card),
      });
    },
  );

  app.post<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/mcp/release-check",
    async (request, reply) => {
      if (!requireUser(request, reply)) return;
      const { type, name } = request.params;
      if (type !== "mcp-server") return reply.code(404).send({ error: "not_found" });
      const row = getArtifactByTypeName(db, type, name);
      if (!row || row.purged_at || !canView(db, request.user ?? null, row)) {
        return reply.code(404).send({ error: "not_found" });
      }
      const user = request.user!;
      if (
        user.username !== row.owner &&
        !isMaintainer(db, row.id, user.username) &&
        user.role !== "admin"
      ) {
        return reply.code(403).send({ error: "forbidden" });
      }
      if (!mcpReleaseSettings(config).enabled) {
        return reply.code(409).send({ error: "release_check_disabled" });
      }
      const release = await checkRelease(db, config, row.id);
      return reply.send({ release });
    },
  );
};
