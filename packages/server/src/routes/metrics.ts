import type { FastifyPluginAsync } from "fastify";
import { requireRole, requireUser } from "../auth/guard.ts";
import { executiveReport, parseReportDays } from "../metrics/report.ts";
import type { Database } from "../repo.ts";
import type { Viewer } from "../visibility/index.ts";
import { exportFilename, metricsToCsv, metricsToJsonExport } from "../metrics/csv.ts";
import { metricsOverview, parseMetricsQuery } from "../metrics/overview.ts";

export type MetricsPluginOpts = { db: Database };

function viewerOf(request: {
  user: { username: string; role: import("../auth/users.ts").Role } | null;
}): Viewer {
  return request.user ? { username: request.user.username, role: request.user.role } : null;
}

function queryRecord(q: unknown): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  if (!q || typeof q !== "object") return out;
  for (const [k, v] of Object.entries(q as Record<string, unknown>)) {
    if (v === undefined || v === null) out[k] = undefined;
    else out[k] = String(v);
  }
  return out;
}

export const metricsRoutes: FastifyPluginAsync<MetricsPluginOpts> = async (app, opts) => {
  const { db } = opts;

  app.get("/api/v1/metrics/overview", async (request, reply) => {
    const parsed = parseMetricsQuery(queryRecord(request.query));
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.error });
    }
    const result = metricsOverview(db, viewerOf(request), parsed.query);
    return reply.send(result);
  });

  // executive-report: usage by consuming team and artifact, trend, unused artifacts (admin only).
  app.get("/api/v1/admin/report", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    const days = parseReportDays((request.query as Record<string, unknown> | undefined)?.days);
    if (days === null) {
      return reply
        .code(400)
        .send({ error: "bad_request", message: "days must be an integer 1..365" });
    }
    return reply.send(executiveReport(db, { days }));
  });

  app.get("/api/v1/metrics/export", async (request, reply) => {
    if (!requireUser(request, reply)) return;

    const q = queryRecord(request.query);
    const format = q.format;
    if (format !== "csv" && format !== "json") {
      return reply.code(400).send({ error: "format_invalid" });
    }

    const parsed = parseMetricsQuery(q, { exportAll: true });
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.error });
    }

    const result = metricsOverview(db, viewerOf(request), parsed.query);
    const truncated = result.totals.artifacts > result.items.length;
    const now = new Date();
    const filename = exportFilename(format, now);

    if (format === "json") {
      const body = metricsToJsonExport(result.items, truncated, now);
      return reply
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .header("Cache-Control", "no-store")
        .type("application/json; charset=utf-8")
        .send(body);
    }

    const csv = metricsToCsv(result.items);
    if (truncated) reply.header("X-Truncated", "true");
    return reply
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .header("Cache-Control", "no-store")
      .type("text/csv; charset=utf-8")
      .send(csv);
  });
};
