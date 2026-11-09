import type { Database } from "../repo.ts";

/**
 * Report for management: usage over a period by consuming team and by
 * artifact, the trend against the previous period of the same length, an estimate of context tokens (context-cost)
 * and active artifacts nobody used. Counts only: no prompts, paths or content.
 */
const DAY = 86_400_000;
const LIVE_STATUSES = ["active", "aging", "zombie"];

type Fact = { artifact_id: string; reporter: string; used_at: string };

type ArtifactRow = {
  id: string;
  type: string;
  name: string;
  status: string;
  owner_team: string | null;
  quality: string | null;
  first_published: string | null;
};

export type ReportQuery = { days: number; now?: Date };

/** `days` as an integer 1..365, default 30; null when invalid. */
export function parseReportDays(raw: unknown): number | null {
  if (raw === undefined || raw === "") return 30;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : null;
}

function facts(db: Database, fromIso: string, toIso: string | null): Fact[] {
  const upper = toIso ? "AND f.used_at < ?" : "";
  return db
    .prepare(
      `SELECT f.artifact_id, f.reporter, f.used_at FROM session_facts f
       JOIN artifacts a ON a.id = f.artifact_id
       WHERE a.purged_at IS NULL AND f.used_at >= ? ${upper}`,
    )
    .all(...(toIso ? [fromIso, toIso] : [fromIso])) as Fact[];
}

/** Tokens one session of the artifact costs at least: the description once and the body once. */
function sessionTokens(quality: string | null): number {
  if (!quality) return 0;
  const ctx = (JSON.parse(quality) as { context?: { every_turn: number; on_use: number } }).context;
  return ctx ? ctx.every_turn + ctx.on_use : 0;
}

function countBy<T>(items: readonly T[], key: (t: T) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const it of items) out.set(key(it), (out.get(key(it)) ?? 0) + 1);
  return out;
}

function artifactRows(db: Database): ArtifactRow[] {
  return db
    .prepare(
      `SELECT a.id, a.type, a.name, a.status, a.owner_team,
              (SELECT quality FROM artifact_versions v WHERE v.artifact_id = a.id AND v.version = a.latest_version) AS quality,
              (SELECT MIN(published_at) FROM artifact_versions v WHERE v.artifact_id = a.id) AS first_published
       FROM artifacts a WHERE a.purged_at IS NULL`,
    )
    .all() as ArtifactRow[];
}

/** username → team names; a member of two teams is counted in both. */
function teamsOf(db: Database): { names: string[]; byUser: Map<string, string[]> } {
  const names = (
    db.prepare("SELECT name FROM teams ORDER BY name").all() as { name: string }[]
  ).map((t) => t.name);
  const byUser = new Map<string, string[]>();
  const rows = db
    .prepare(
      "SELECT lower(m.username) AS username, t.name FROM team_members m JOIN teams t ON t.id = m.team_id",
    )
    .all() as { username: string; name: string }[];
  for (const r of rows) byUser.set(r.username, [...(byUser.get(r.username) ?? []), r.name]);
  return { names, byUser };
}

function teamRows(
  current: Fact[],
  previous: Fact[],
  tokensOf: (artifactId: string) => number,
  teams: ReturnType<typeof teamsOf>,
) {
  const keys = (f: Fact): Array<string | null> =>
    teams.byUser.get(f.reporter.toLowerCase()) ?? [null];
  const blank = () => ({ sessions: 0, previous_sessions: 0, users: new Set<string>(), tokens: 0 });
  const acc = new Map<string | null, ReturnType<typeof blank>>();
  for (const name of [...teams.names, null]) acc.set(name, blank());
  for (const f of current) {
    for (const k of keys(f)) {
      const t = acc.get(k)!;
      t.sessions++;
      t.users.add(f.reporter.toLowerCase());
      t.tokens += tokensOf(f.artifact_id);
    }
  }
  for (const f of previous) for (const k of keys(f)) acc.get(k)!.previous_sessions++;
  return [...acc].map(([team, t]) => ({
    team,
    sessions: t.sessions,
    previous_sessions: t.previous_sessions,
    users: t.users.size,
    est_context_tokens: t.tokens,
  }));
}

function trend(current: Fact[], from: number, days: number) {
  const buckets = Math.ceil(days / 7);
  const out = Array.from({ length: buckets }, (_, i) => ({
    start: new Date(from + i * 7 * DAY).toISOString(),
    sessions: 0,
  }));
  for (const f of current) {
    const i = Math.floor((Date.parse(f.used_at) - from) / (7 * DAY));
    out[Math.min(Math.max(i, 0), buckets - 1)]!.sessions++;
  }
  return out;
}

export function executiveReport(db: Database, q: ReportQuery) {
  const now = (q.now ?? new Date()).getTime();
  const from = now - q.days * DAY;
  const fromIso = new Date(from).toISOString();
  const current = facts(db, fromIso, null);
  const previous = facts(db, new Date(from - q.days * DAY).toISOString(), fromIso);
  const rows = artifactRows(db);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const tokens = new Map(rows.map((r) => [r.id, sessionTokens(r.quality)]));
  const tokensOf = (id: string) => tokens.get(id) ?? 0;
  const used = countBy(current, (f) => f.artifact_id);
  const before = countBy(previous, (f) => f.artifact_id);
  const live = rows.filter((r) => LIVE_STATUSES.includes(r.status));
  return {
    period: { days: q.days, from: fromIso, to: new Date(now).toISOString() },
    totals: {
      sessions: current.length,
      previous_sessions: previous.length,
      users: new Set(current.map((f) => f.reporter.toLowerCase())).size,
      active_artifacts: live.length,
    },
    trend: trend(current, from, q.days),
    teams: teamRows(current, previous, tokensOf, teamsOf(db)),
    artifacts: [...used]
      .map(([id, sessions]) => {
        const a = byId.get(id)!;
        return {
          type: a.type,
          name: a.name,
          status: a.status,
          owner_team: a.owner_team,
          sessions,
          previous_sessions: before.get(id) ?? 0,
          est_context_tokens: sessions * tokensOf(id),
        };
      })
      .sort((x, y) => y.sessions - x.sessions || x.name.localeCompare(y.name)),
    unused: live
      .filter((r) => !used.has(r.id))
      .map((r) => ({
        type: r.type,
        name: r.name,
        status: r.status,
        owner_team: r.owner_team,
        recent: r.first_published !== null && r.first_published >= fromIso,
      }))
      .sort((x, y) => x.name.localeCompare(y.name)),
  };
}
