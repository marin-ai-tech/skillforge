// news: reading the feed by the reader's rights now. One SQL predicate (rightsClause) serves the page, the pinned
// posts, unread_count and the newest visible item, so a page is never short and a count never leaks.
import type { Database } from "../db.ts";
import { canView, type Viewer } from "../visibility/index.ts";
import { visibleClause } from "../visibility/sql.ts";
import type { NewsKind } from "./rules.ts";

type Clause = { sql: string; params: Array<string | number> };

export type FeedQuery = {
  cursor: { at: string; id: number } | null;
  limit: number;
  kinds: NewsKind[] | null;
  type: string | null;
  team: string | null;
  mine: boolean;
  drafts: boolean;
  /** news-delivery: only items with `at` later than this ISO time. */
  since?: string | null;
  /** news-delivery: only unread items (newer than `seenAt`, without the reader's own actions). */
  unread?: boolean;
  seenAt?: string | null;
};

export type NewsRow = {
  id: number;
  kind: string;
  at: string;
  actor: string;
  artifact_id: string | null;
  version: string | null;
  from_status: string | null;
  to_status: string | null;
  title: string | null;
  body: string | null;
  team: string | null;
  pinned: number;
  important: number;
  draft: number;
  publish_at: string | null;
  expires_at: string | null;
  author: string | null;
  a_type: string | null;
  a_name: string | null;
  a_replaced_by: string | null;
  editable: number;
};

export type PostView = {
  title: string;
  body: string;
  team: string | null;
  pinned: boolean;
  important: boolean;
  publish_at: string | null;
  expires_at: string | null;
  draft: boolean;
  scheduled: boolean;
  author: string;
  can_edit: boolean;
};

export type NewsItemView = {
  id: string;
  kind: string;
  at: string;
  actor: string;
  artifact: { type: string; name: string } | null;
  version: string | null;
  from: string | null;
  to: string | null;
  replacement: { type: string; name: string } | null;
  post: PostView | null;
};

const MEMBER_OF_POST_TEAM =
  "EXISTS (SELECT 1 FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE t.name = n.team AND tm.username = ?";

/** Who may see a published post: everyone for no team; members of the team and admin otherwise. */
function audienceClause(viewer: Viewer): Clause {
  if (!viewer) return { sql: "n.team IS NULL", params: [] };
  if (viewer.role === "admin") return { sql: "1 = 1", params: [] };
  return { sql: `(n.team IS NULL OR ${MEMBER_OF_POST_TEAM}))`, params: [viewer.username] };
}

/** Who may edit a post (and so see its draft, scheduled or expired state): admin, the lead of its team. */
export function editableClause(viewer: Viewer): Clause {
  if (!viewer) return { sql: "0", params: [] };
  if (viewer.role === "admin") return { sql: "1", params: [] };
  return {
    sql: `(n.team IS NOT NULL AND ${MEMBER_OF_POST_TEAM} AND tm.role = 'lead'))`,
    params: [viewer.username],
  };
}

const PUBLISHED = "(n.draft = 0 AND n.at <= ? AND (n.expires_at IS NULL OR n.expires_at > ?))";

/** The rights filter: automatic items by the artifact's visibility now, posts by audience and state. */
export function rightsClause(viewer: Viewer, now: string, drafts: boolean): Clause {
  const vis = visibleClause(viewer, "a");
  const audience = audienceClause(viewer);
  const auto = `(n.kind <> 'post' AND a.id IS NOT NULL AND ${vis.sql})`;
  let post = `(n.kind = 'post' AND ${audience.sql} AND ${PUBLISHED})`;
  const params: Array<string | number> = [...vis.params, ...audience.params, now, now];
  if (drafts) {
    const edit = editableClause(viewer);
    post = `(${post} OR (n.kind = 'post' AND ${edit.sql}))`;
    params.push(...edit.params);
  }
  return { sql: `(${auto} OR ${post})`, params };
}

function mineClause(viewer: Viewer): Clause {
  if (!viewer) return { sql: "0", params: [] };
  const u = viewer.username;
  return {
    sql: `(n.kind <> 'post' AND (a.owner = ? OR EXISTS (SELECT 1 FROM artifact_maintainers am WHERE am.artifact_id = a.id AND am.username = ?) OR EXISTS (SELECT 1 FROM artifact_watchers aw WHERE aw.artifact_id = a.id AND aw.username = ?)))`,
    params: [u, u, u],
  };
}

/** Newer than the reader's mark, without the reader's own actions: the set `unread_count` counts. */
function unreadClause(viewer: Viewer, seenAt: string | null): Clause {
  if (!viewer) return { sql: "0", params: [] };
  return {
    sql: "(n.at > ? AND n.actor <> ? COLLATE NOCASE)",
    params: [seenAt ?? "", viewer.username],
  };
}

function filterClauses(viewer: Viewer, q: FeedQuery): Clause[] {
  const out: Clause[] = [];
  if (q.since) out.push({ sql: "n.at > ?", params: [q.since] });
  if (q.unread) out.push(unreadClause(viewer, q.seenAt ?? null));
  if (q.kinds && q.kinds.length > 0) {
    out.push({ sql: `n.kind IN (${q.kinds.map(() => "?").join(", ")})`, params: [...q.kinds] });
  }
  if (q.type) out.push({ sql: "(n.kind <> 'post' AND a.type = ?)", params: [q.type] });
  if (q.team) {
    out.push({
      sql: "((n.kind = 'post' AND n.team = ?) OR (n.kind <> 'post' AND a.owner_team = ?))",
      params: [q.team, q.team],
    });
  }
  if (q.mine) out.push(mineClause(viewer));
  if (q.cursor) {
    out.push({
      sql: "(n.at < ? OR (n.at = ? AND n.id < ?))",
      params: [q.cursor.at, q.cursor.at, q.cursor.id],
    });
  }
  return out;
}

function selectSql(viewer: Viewer): Clause {
  const edit = editableClause(viewer);
  return {
    sql: `SELECT n.*, a.type AS a_type, a.name AS a_name, a.replaced_by AS a_replaced_by, ${edit.sql} AS editable
     FROM news_items n LEFT JOIN artifacts a ON a.id = n.artifact_id`,
    params: edit.params,
  };
}

function where(clauses: Clause[]): Clause {
  return {
    sql: clauses.map((c) => c.sql).join(" AND "),
    params: clauses.flatMap((c) => c.params),
  };
}

const FROM = "FROM news_items n LEFT JOIN artifacts a ON a.id = n.artifact_id";

/** One page, newest first (`at`, then `id` for equal times); one row more tells whether there is a next page. */
export function readFeedPage(
  db: Database,
  viewer: Viewer,
  q: FeedQuery,
  now: string,
): { rows: NewsRow[]; hasMore: boolean } {
  const head = selectSql(viewer);
  const w = where([rightsClause(viewer, now, q.drafts), ...filterClauses(viewer, q)]);
  const rows = db
    .prepare(`${head.sql} WHERE ${w.sql} ORDER BY n.at DESC, n.id DESC LIMIT ?`)
    .all(...head.params, ...w.params, q.limit + 1) as NewsRow[];
  return { rows: rows.slice(0, q.limit), hasMore: rows.length > q.limit };
}

/** Visible, published, unexpired pinned posts (first page only). */
export function readPinned(db: Database, viewer: Viewer, now: string): NewsRow[] {
  const head = selectSql(viewer);
  const w = where([
    rightsClause(viewer, now, false),
    { sql: "n.kind = 'post' AND n.pinned = 1", params: [] },
  ]);
  return db
    .prepare(`${head.sql} WHERE ${w.sql} ORDER BY n.at DESC, n.id DESC LIMIT 50`)
    .all(...head.params, ...w.params) as NewsRow[];
}

/** Visible items newer than the reader's mark, without the reader's own actions. */
export function unreadCount(db: Database, viewer: Viewer, now: string): number {
  if (!viewer) return 0;
  const w = where([
    rightsClause(viewer, now, false),
    unreadClause(viewer, getSeenAt(db, viewer.username)),
  ]);
  const row = db.prepare(`SELECT COUNT(*) AS c ${FROM} WHERE ${w.sql}`).get(...w.params) as {
    c: number;
  };
  return Number(row.c);
}

/**
 * news-delivery: the items of a summary period `[from, to)` the reader may see, published posts only, without the
 * reader's own actions; newest first.
 */
export function readPeriod(
  db: Database,
  viewer: NonNullable<Viewer>,
  period: { from: string; to: string },
  now: string,
  limit = 200,
): NewsRow[] {
  const head = selectSql(viewer);
  const w = where([
    rightsClause(viewer, now, false),
    {
      sql: "n.at >= ? AND n.at < ? AND n.actor <> ? COLLATE NOCASE",
      params: [period.from, period.to, viewer.username],
    },
  ]);
  return db
    .prepare(`${head.sql} WHERE ${w.sql} ORDER BY n.at DESC, n.id DESC LIMIT ?`)
    .all(...head.params, ...w.params, limit) as NewsRow[];
}

/** `at` of the newest item the viewer can see, or null. */
export function newestVisibleAt(db: Database, viewer: Viewer, now: string): string | null {
  const w = rightsClause(viewer, now, false);
  const row = db.prepare(`SELECT MAX(n.at) AS m ${FROM} WHERE ${w.sql}`).get(...w.params) as {
    m: string | null;
  };
  return row.m ?? null;
}

export function getSeenAt(db: Database, username: string): string | null {
  const row = db.prepare("SELECT seen_at FROM news_seen WHERE username = ?").get(username) as
    { seen_at: string } | undefined;
  return row?.seen_at ?? null;
}

/** The mark only grows and never passes the newest visible item. Returns the mark now in force. */
export function markSeen(
  db: Database,
  viewer: NonNullable<Viewer>,
  requested: string | null,
  now: string,
): string | null {
  const newest = newestVisibleAt(db, viewer, now);
  const current = getSeenAt(db, viewer.username);
  if (!newest) return current;
  const wanted = requested && requested < newest ? requested : newest;
  if (current && current >= wanted) return current;
  db.prepare(
    `INSERT INTO news_seen (username, seen_at) VALUES (?, ?)
     ON CONFLICT (username) DO UPDATE SET seen_at = excluded.seen_at`,
  ).run(viewer.username, wanted);
  return wanted;
}

function parseKey(value: string | null): { type: string; name: string } | null {
  const m = value ? /^([a-z]+)\/([a-z0-9][a-z0-9-]*)$/.exec(value) : null;
  return m ? { type: m[1]!, name: m[2]! } : null;
}

/** The successor of a retired artifact, read now, and only when the reader can see it. */
function replacementOf(
  db: Database,
  viewer: Viewer,
  row: NewsRow,
): { type: string; name: string } | null {
  if (row.kind !== "status_change" || row.to_status !== "retired") return null;
  const key = parseKey(row.a_replaced_by);
  if (!key) return null;
  const target = db
    .prepare(
      "SELECT id, visibility, owner_team, owner, purged_at FROM artifacts WHERE type = ? AND name = ?",
    )
    .get(key.type, key.name) as Parameters<typeof canView>[2] | undefined;
  return target && canView(db, viewer, target) ? key : null;
}

function postView(row: NewsRow, now: string): PostView | null {
  if (row.kind !== "post") return null;
  return {
    title: row.title ?? "",
    body: row.body ?? "",
    team: row.team,
    pinned: row.pinned === 1,
    important: row.important === 1,
    publish_at: row.publish_at,
    expires_at: row.expires_at,
    draft: row.draft === 1,
    scheduled: row.publish_at !== null && row.publish_at > now,
    author: row.author ?? row.actor,
    can_edit: Number(row.editable) === 1,
  };
}

/** Fields, not text: the web builds the sentence in the reader's language. */
export function toItemView(db: Database, viewer: Viewer, row: NewsRow, now: string): NewsItemView {
  return {
    id: String(row.id),
    kind: row.kind,
    at: row.at,
    actor: row.actor,
    artifact: row.a_type && row.a_name ? { type: row.a_type, name: row.a_name } : null,
    version: row.version,
    from: row.from_status,
    to: row.to_status,
    replacement: replacementOf(db, viewer, row),
    post: postView(row, now),
  };
}

/** One post as the viewer may see it: published for its audience, or any state for those who may edit it. */
export function readPostRow(
  db: Database,
  viewer: Viewer,
  id: number,
  now: string,
): NewsRow | undefined {
  const head = selectSql(viewer);
  const w = rightsClause(viewer, now, true);
  return db
    .prepare(`${head.sql} WHERE n.id = ? AND n.kind = 'post' AND ${w.sql}`)
    .get(...head.params, id, ...w.params) as NewsRow | undefined;
}

export function encodeCursor(row: { at: string; id: number }): string {
  return Buffer.from(`${row.at}|${row.id}`).toString("base64url");
}

export function decodeCursor(raw: string): { at: string; id: number } | null {
  const [at, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
  const n = Number(id);
  if (!at || !Number.isFinite(Date.parse(at)) || !Number.isInteger(n) || n < 0) return null;
  return { at, id: n };
}
