import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../auth/guard.ts";
import { CursorError, readJournal, type JournalQuery } from "../audit/journal.ts";
import type { Database } from "../db.ts";

const PAGE_MAX = 1000;
const EXPORT_MAX = 100_000;

type Query = {
  after?: string;
  action?: string;
  actor?: string;
  since?: string;
  limit?: string;
  format?: string;
};

function pageLimit(q: Query): number {
  if (q.format === "ndjson") return EXPORT_MAX;
  const asked = Number(q.limit ?? 100);
  return Number.isInteger(asked) && asked > 0 ? Math.min(asked, PAGE_MAX) : 100;
}

/** Only the filters that were given; `since` is normalised to ISO so it compares with stored timestamps. */
function journalQuery(q: Query): JournalQuery {
  return {
    limit: pageLimit(q),
    ...(q.after ? { after: q.after } : {}),
    ...(q.action ? { action: q.action } : {}),
    ...(q.actor ? { actor: q.actor } : {}),
    ...(q.since ? { since: new Date(q.since).toISOString() } : {}),
  };
}

function toNdjson(items: readonly unknown[]): string {
  return items
    .map(
      (e) => `${JSON.stringify(e)}
`,
    )
    .join("");
}

/** The audit journal for admins and SIEM pulls (audit-export): JSON pages with a cursor, or NDJSON export. */
export const adminAuditRoutes: FastifyPluginAsync<{ db: Database }> = async (app, opts) => {
  const { db } = opts;
  app.get<{ Querystring: Query }>("/api/v1/admin/audit", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    const q = request.query ?? {};
    if (q.since !== undefined && !Number.isFinite(Date.parse(q.since))) {
      return reply.code(400).send({ error: "bad_request", message: "since must be a date" });
    }
    let page;
    try {
      page = readJournal(db, journalQuery(q));
    } catch (e) {
      if (e instanceof CursorError) {
        return reply.code(400).send({ error: "bad_request", message: e.message });
      }
      throw e;
    }
    if (q.format !== "ndjson") return reply.send(page);
    return reply
      .type("application/x-ndjson; charset=utf-8")
      .header("content-disposition", 'attachment; filename="skillforge-audit.ndjson"')
      .send(toNdjson(page.items));
  });
};
