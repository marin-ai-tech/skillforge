import type { Database } from "../repo.ts";

/**
 * One audit journal for security teams: artifact events from `audit_events` and
 * system events (policies, users, LLM settings, mirrors) from `system_events`, ordered by time with a stable
 * cursor, so a SIEM can pull everything once and then only what is new.
 */
export function appendSystemEvent(
  db: Database,
  input: { actor: string; action: string; target?: string | null; meta?: Record<string, unknown> },
): void {
  db.prepare(
    "INSERT INTO system_events (ts, actor, action, target, meta) VALUES (?, ?, ?, ?, ?)",
  ).run(
    new Date().toISOString(),
    input.actor,
    input.action,
    input.target ?? null,
    input.meta ? JSON.stringify(input.meta) : null,
  );
}

export type JournalEvent = {
  cursor: string;
  ts: string;
  source: "artifact" | "system";
  actor: string;
  action: string;
  artifact: { type: string; name: string } | null;
  version: string | null;
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
  target: string | null;
  meta: Record<string, unknown> | null;
};

export type JournalQuery = {
  after?: string;
  action?: string;
  actor?: string;
  since?: string;
  limit: number;
};

export class CursorError extends Error {}

type Position = { ts: string; source: string; id: number };

function encode(p: Position): string {
  return Buffer.from(`${p.ts}|${p.source}|${p.id}`).toString("base64url");
}

function decode(cursor: string): Position {
  const [ts, source, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const n = Number(id);
  if (!ts || !Number.isFinite(Date.parse(ts)) || (source !== "artifact" && source !== "system")) {
    throw new CursorError("invalid cursor");
  }
  if (!Number.isInteger(n) || n < 0) throw new CursorError("invalid cursor");
  return { ts, source, id: n };
}

const UNION = `
  SELECT e.ts AS ts, 'artifact' AS source, e.id AS id, e.actor AS actor, e.action AS action,
         a.type AS a_type, a.name AS a_name, e.version AS version, e.from_status AS from_status,
         e.to_status AS to_status, e.reason AS reason, e.meta AS meta, NULL AS target
  FROM audit_events e JOIN artifacts a ON a.id = e.artifact_id
  UNION ALL
  SELECT s.ts, 'system', s.id, s.actor, s.action, NULL, NULL, NULL, NULL, NULL, NULL, s.meta, s.target
  FROM system_events s`;

type Row = {
  ts: string;
  source: "artifact" | "system";
  id: number;
  actor: string;
  action: string;
  a_type: string | null;
  a_name: string | null;
  version: string | null;
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
  meta: string | null;
  target: string | null;
};

function toEvent(r: Row): JournalEvent {
  return {
    cursor: encode(r),
    ts: r.ts,
    source: r.source,
    actor: r.actor,
    action: r.action,
    artifact: r.a_type && r.a_name ? { type: r.a_type, name: r.a_name } : null,
    version: r.version,
    from_status: r.from_status,
    to_status: r.to_status,
    reason: r.reason,
    target: r.target,
    meta: r.meta ? (JSON.parse(r.meta) as Record<string, unknown>) : null,
  };
}

/** One page in time order; `next` is the cursor to continue from, null when the page is the last. */
export function readJournal(db: Database, q: JournalQuery) {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (q.after !== undefined) {
    const p = decode(q.after);
    where.push("(ts, source, id) > (?, ?, ?)");
    params.push(p.ts, p.source, p.id);
  }
  if (q.action) {
    where.push("action = ?");
    params.push(q.action);
  }
  if (q.actor) {
    where.push("actor = ? COLLATE NOCASE");
    params.push(q.actor);
  }
  if (q.since) {
    where.push("ts >= ?");
    params.push(q.since);
  }
  const rows = db
    .prepare(
      `SELECT * FROM (${UNION}) ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY ts, source, id LIMIT ?`,
    )
    .all(...params, q.limit + 1) as Row[];
  const page = rows.slice(0, q.limit).map(toEvent);
  const next = rows.length > q.limit ? page[page.length - 1]!.cursor : null;
  return { items: page, next };
}
