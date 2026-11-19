// news-delivery: news leaves the web page. (1) Announcing: every item goes to plugins as `news.published` exactly
// once — automatic items and posts right after their COMMIT (announce-trigger.ts), scheduled posts when their time
// comes. The pass marks `announced_at` in its own transaction BEFORE the events go out, so a restart, a racing tick or
// a second trigger never repeats an item; a draft or a deleted post is never picked. (2) Summaries: for each reader
// whose daily or weekly period has passed, the items of that period they may see (the feed's rights, without their own
// actions) become one `news_summary` notification and one `news.summary` event; `news_summary_sent` keeps it to one
// per period. An empty period writes nothing. One tick (SKILLFORGE_NEWS_TICK_MS, default a minute) serves both.
import type { Database } from "../db.ts";
import type { Role } from "../auth/users.ts";
import { emitPluginEvent, type NewsPublishedItem } from "../plugins/events.ts";
import {
  emitNotifications,
  insertNotification,
  type CreatedNotification,
} from "../notifications/notify.ts";
import { readPeriod, toItemView } from "./read.ts";
import { setAnnouncer } from "./announce-trigger.ts";
import { newsItemUrl } from "./links.ts";

const DEFAULT_TICK_MS = 60_000;
const MIN_TICK_MS = 50;
const DAY_MS = 86_400_000;
const SUMMARY_HOUR = 9;
const ANNOUNCE_BATCH = 500;

export const SUMMARY_PERIODS = ["off", "daily", "weekly"] as const;
export type SummaryPeriod = (typeof SUMMARY_PERIODS)[number];
export const DEFAULT_SUMMARY_PERIOD: SummaryPeriod = "weekly";

export function isSummaryPeriod(v: unknown): v is SummaryPeriod {
  return typeof v === "string" && (SUMMARY_PERIODS as readonly string[]).includes(v);
}

/** SKILLFORGE_NEWS_TICK_MS: a positive integer (at least 50 ms); anything else is the default minute. */
export function newsTickMs(raw: string | undefined): number {
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= MIN_TICK_MS ? n : DEFAULT_TICK_MS;
}

// ---------------------------------------------------------------------------------------------------------------
// Announcing

type DueRow = {
  id: number;
  kind: string;
  at: string;
  version: string | null;
  from_status: string | null;
  to_status: string | null;
  title: string | null;
  team: string | null;
  important: number;
  a_type: string | null;
  a_name: string | null;
  a_visibility: string | null;
  a_team: string | null;
};

/** Due: not announced, not a draft, its time has come; a post also not expired. Deleted posts are gone. */
const DUE_SQL = `SELECT n.id, n.kind, n.at, n.version, n.from_status, n.to_status, n.title, n.team, n.important,
    a.type AS a_type, a.name AS a_name, a.visibility AS a_visibility, a.owner_team AS a_team
  FROM news_items n LEFT JOIN artifacts a ON a.id = n.artifact_id
  WHERE n.announced_at IS NULL AND n.draft = 0 AND n.at <= ?
    AND (n.kind <> 'post' OR n.expires_at IS NULL OR n.expires_at > ?)
  ORDER BY n.at, n.id LIMIT ?`;

function publishedItem(r: DueRow): NewsPublishedItem {
  const isPost = r.kind === "post";
  return {
    id: String(r.id),
    kind: r.kind,
    artifact:
      !isPost && r.a_type && r.a_name
        ? { type: r.a_type, name: r.a_name, visibility: r.a_visibility ?? "org", team: r.a_team }
        : null,
    version: r.version,
    from: r.from_status,
    to: r.to_status,
    post: isPost ? { title: r.title ?? "", team: r.team, important: r.important === 1 } : null,
  };
}

/** Opens its own transaction; null when one is already open (the caller retries later). */
function pickDue(db: Database, now: string): DueRow[] | null {
  try {
    db.exec("BEGIN IMMEDIATE");
  } catch {
    return null;
  }
  try {
    const rows = db.prepare(DUE_SQL).all(now, now, ANNOUNCE_BATCH) as DueRow[];
    const mark = db.prepare(
      "UPDATE news_items SET announced_at = ? WHERE id = ? AND announced_at IS NULL",
    );
    for (const r of rows) mark.run(now, r.id);
    db.exec("COMMIT");
    return rows;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Announce every due item once. Returns the number announced, or -1 when the database was busy. */
export function announceDue(db: Database, base: string, now = new Date()): number {
  const rows = pickDue(db, now.toISOString());
  if (!rows) return -1;
  for (const r of rows) {
    const item = publishedItem(r);
    emitPluginEvent({ type: "news.published", at: r.at, item, url: newsItemUrl(base, item) });
  }
  return rows.length;
}

// ---------------------------------------------------------------------------------------------------------------
// Summaries

/** The last passed boundary (09:00 server time; weekly — Monday) and the day or week before it. */
export function summaryPeriod(now: Date, period: "daily" | "weekly"): { from: Date; to: Date } {
  const to = new Date(now);
  to.setHours(SUMMARY_HOUR, 0, 0, 0);
  if (period === "weekly") to.setDate(to.getDate() - ((to.getDay() + 6) % 7));
  const step = period === "weekly" ? 7 : 1;
  if (to > now) to.setDate(to.getDate() - step);
  return { from: new Date(to.getTime() - step * DAY_MS), to };
}

type Reader = { id: string; username: string; role: Role; period: "daily" | "weekly" };

function readers(db: Database): Reader[] {
  return db
    .prepare(
      `SELECT u.id, u.username, u.role, COALESCE(p.period, ?) AS period
       FROM users u LEFT JOIN news_summary_prefs p ON p.username = u.username
       WHERE u.disabled = 0 AND COALESCE(p.period, ?) IN ('daily', 'weekly')`,
    )
    .all(DEFAULT_SUMMARY_PERIOD, DEFAULT_SUMMARY_PERIOD) as Reader[];
}

function alreadySent(db: Database, username: string, periodStart: string): boolean {
  return (
    db
      .prepare("SELECT 1 AS n FROM news_summary_sent WHERE username = ? AND period_start = ?")
      .get(username, periodStart) !== undefined
  );
}

function emailOf(db: Database, userId: string): string | null {
  const row = db
    .prepare(
      `SELECT email FROM user_identities WHERE user_id = ? AND email IS NOT NULL AND email <> ''
       ORDER BY last_login_at DESC LIMIT 1`,
    )
    .get(userId) as { email: string } | undefined;
  return row?.email ?? null;
}

/** Writes the period row and the notification in one transaction; false if busy or already sent. */
function recordSummary(
  db: Database,
  reader: Reader,
  period: { from: string; to: string },
  count: number,
  now: string,
): { notifications: CreatedNotification[] } | null {
  try {
    db.exec("BEGIN IMMEDIATE");
  } catch {
    return null;
  }
  try {
    const ins = db
      .prepare(
        `INSERT OR IGNORE INTO news_summary_sent (username, period_start, period_end, items, sent_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(reader.username, period.from, period.to, count, now);
    if (Number(ins.changes) === 0) {
      db.exec("ROLLBACK");
      return null;
    }
    // The period is the only control of the summary (UX audit, finding 2): no notification preference is consulted;
    // `off` readers never get here, `daily`/`weekly` get both the notification and the event.
    const notifications = [
      insertNotification(db, {
        username: reader.username,
        kind: "news_summary",
        title: `News summary: ${count} ${count === 1 ? "item" : "items"}`,
        url: "/news",
        meta: { period: reader.period, from: period.from, to: period.to, items: count },
      }),
    ];
    db.exec("COMMIT");
    return { notifications };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** One reader's due summary, if any. Returns true when one was sent. */
function summarize(db: Database, reader: Reader, now: Date): boolean {
  const range = summaryPeriod(now, reader.period);
  const period = { from: range.from.toISOString(), to: range.to.toISOString() };
  if (alreadySent(db, reader.username, period.from)) return false;
  const nowIso = now.toISOString();
  const viewer = { username: reader.username, role: reader.role };
  const rows = readPeriod(db, viewer, period, nowIso);
  if (rows.length === 0) return false;
  const done = recordSummary(db, reader, period, rows.length, nowIso);
  if (!done) return false;
  emitNotifications(done.notifications);
  emitPluginEvent({
    type: "news.summary",
    at: nowIso,
    username: reader.username,
    email: emailOf(db, reader.id),
    period,
    items: rows.map((r) => toItemView(db, viewer, r, nowIso)),
  });
  return true;
}

/** Send every due, non-empty summary. Returns how many were sent. */
export function sendDueSummaries(db: Database, now = new Date()): number {
  let sent = 0;
  for (const reader of readers(db)) {
    if (summarize(db, reader, now)) sent++;
  }
  return sent;
}

export function getSummaryPeriod(db: Database, username: string): SummaryPeriod {
  const row = db
    .prepare("SELECT period FROM news_summary_prefs WHERE username = ?")
    .get(username) as { period: string } | undefined;
  const period = row?.period;
  return isSummaryPeriod(period) ? period : DEFAULT_SUMMARY_PERIOD;
}

export function setSummaryPeriod(db: Database, username: string, period: SummaryPeriod): void {
  db.prepare(
    `INSERT INTO news_summary_prefs (username, period, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (username) DO UPDATE SET period = excluded.period, updated_at = excluded.updated_at`,
  ).run(username, period, new Date().toISOString());
}

// ---------------------------------------------------------------------------------------------------------------
// The tick

export type NewsDelivery = { stop: () => void };

/**
 * Start delivery for one app: the after-COMMIT announcer, a pass now (what was missed while the server was down) and
 * a pass every `tickMs`. A pass never overlaps the previous one; the timer does not keep the process alive.
 */
export function startNewsDelivery(
  db: Database,
  opts: {
    base: string;
    tickMs: number;
    log: (msg: string, fields?: Record<string, unknown>) => void;
  },
): NewsDelivery {
  let running = false;
  let stopped = false;
  const announce = (): boolean => {
    if (stopped) return true;
    try {
      return announceDue(db, opts.base) >= 0;
    } catch (e) {
      opts.log("news_announce_failed", { message: e instanceof Error ? e.message : String(e) });
      return true;
    }
  };
  const pass = (): void => {
    if (running || stopped) return;
    running = true;
    try {
      announce();
      sendDueSummaries(db);
    } catch (e) {
      opts.log("news_tick_failed", { message: e instanceof Error ? e.message : String(e) });
    } finally {
      running = false;
    }
  };
  const removeAnnouncer = setAnnouncer(announce);
  pass();
  const timer = setInterval(pass, opts.tickMs);
  timer.unref?.();
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
      removeAnnouncer();
    },
  };
}
