import type { Database } from "../repo.ts";
import { latestAblation } from "../lifecycle/policy.ts";
import { canView, type Viewer } from "../visibility/index.ts";
import {
  ablationScore,
  artifactAblationReports,
  latestNonPurgedFilesJson,
  tokenCostFromFilesJson,
  tokenEfficiency,
  transferRate,
} from "../metrics/compute.ts";
import { usageSummary } from "../evidence/usage.ts";

export const MAX_SESSION_FACTS_BATCH = 1000;
export const MAX_SESSION_FACTS_BODY = 512 * 1024;
export const MAX_SESSION_FACTS_PER_DAY = 5000;
export const MAX_SOURCE_LEN = 64;
export const SESSION_KEY_RE = /^[0-9a-f]{32}$/;
export const VERIFICATIONS = new Set(["pass", "fail", "none"] as const);

export type Verification = "pass" | "fail" | "none";
/** How the skill got into the session: called, or preloaded to a subagent through `skills:`. */
export const FACT_BASES = new Set(["invoked", "preloaded"]);

export type SessionFactInput = {
  skill: string;
  session_key: string;
  used_at: string;
  verification: Verification;
  basis: string;
};

export type AcceptCounters = {
  accepted: number;
  duplicates: number;
  unknown: number;
  rejected: number;
};

export type AcceptResult =
  | { kind: "ok"; counters: AcceptCounters }
  | { kind: "rate_limited" }
  | { kind: "bad_request"; error: string };

function utcDayStart(now: Date): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

/** Keep only the fact fields; drop everything else. */
export function parseFactFields(raw: unknown): SessionFactInput | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.skill !== "string" || typeof o.session_key !== "string") return null;
  if (typeof o.used_at !== "string" || typeof o.verification !== "string") return null;
  return {
    skill: o.skill,
    session_key: o.session_key,
    used_at: o.used_at,
    verification: o.verification as Verification,
    basis: o.basis === undefined ? "invoked" : (o.basis as string),
  };
}

export function parseSkillName(skill: string): string | null {
  if (typeof skill !== "string" || skill.length === 0 || skill.length > 128) return null;
  if (skill.startsWith("skill/")) {
    const name = skill.slice("skill/".length);
    if (!name || name.includes("/")) return null;
    return name;
  }
  if (skill.includes("/")) return null;
  return skill;
}

export function validateFactShape(fact: SessionFactInput, now: Date): "ok" | "rejected" {
  if (!SESSION_KEY_RE.test(fact.session_key)) return "rejected";
  if (!VERIFICATIONS.has(fact.verification)) return "rejected";
  if (!FACT_BASES.has(fact.basis)) return "rejected";
  const t = Date.parse(fact.used_at);
  if (!Number.isFinite(t)) return "rejected";
  const maxFuture = now.getTime() + 86400000;
  const minPast = now.getTime() - 2 * 365.25 * 86400000;
  if (t > maxFuture) return "rejected";
  if (t < minPast) return "rejected";
  return "ok";
}

/** Newest published_at <= used_at, else earliest published version. */
export function resolveVersionForUsedAt(
  db: Database,
  artifactId: string,
  usedAt: string,
): string | null {
  const rows = db
    .prepare(
      "SELECT version, published_at FROM artifact_versions WHERE artifact_id = ? AND purged_at IS NULL ORDER BY published_at ASC",
    )
    .all(artifactId) as Array<{ version: string; published_at: string }>;
  if (rows.length === 0) return null;
  let best: { version: string; published_at: string } | null = null;
  for (const r of rows) {
    if (r.published_at <= usedAt) {
      if (!best || r.published_at >= best.published_at) best = r;
    }
  }
  if (best) return best.version;
  return rows[0]!.version;
}

export function skillAgeDays(db: Database, artifactId: string, now = new Date()): number {
  const row = db
    .prepare(
      "SELECT MIN(published_at) AS first_at FROM artifact_versions WHERE artifact_id = ? AND purged_at IS NULL",
    )
    .get(artifactId) as { first_at: string | null } | undefined;
  if (!row?.first_at) return 0;
  const first = Date.parse(row.first_at);
  if (!Number.isFinite(first)) return 0;
  const days = Math.floor((now.getTime() - first) / 86400000);
  return days < 0 ? 0 : days;
}

export type ArtifactMetrics = {
  sessions_count: number;
  /** Sessions where the skill was only preloaded, never called. */
  preloaded_sessions_count: number;
  users_count: number;
  last_used_at: string | null;
  verification: { pass: number; fail: number; none: number; pass_rate: number | null };
  skill_age_days: number;
  versions: Array<{ version: string; sessions_count: number }>;
  ablation: {
    tasks: number;
    passed_with: number;
    passed_without: number;
    uplift: number;
    at: string | null;
    by: string | null;
  } | null;
  uses: number;
  helped: number;
  transfer_rate: number | null;
  ablation_score: number | null;
  token_cost: number;
  token_efficiency: number | null;
  token_cost_estimated: true;
};

export function artifactMetrics(
  db: Database,
  artifactId: string,
  now = new Date(),
): ArtifactMetrics {
  const sessions = db
    .prepare("SELECT COUNT(DISTINCT session_key) AS n FROM session_facts WHERE artifact_id = ?")
    .get(artifactId) as { n: number | bigint };
  const preloaded = db
    .prepare(
      `SELECT COUNT(*) AS n FROM (SELECT session_key FROM session_facts WHERE artifact_id = ?
         GROUP BY session_key HAVING SUM(basis = 'invoked') = 0)`,
    )
    .get(artifactId) as { n: number | bigint };
  const users = db
    .prepare("SELECT COUNT(DISTINCT reporter) AS n FROM session_facts WHERE artifact_id = ?")
    .get(artifactId) as { n: number | bigint };
  const last = db
    .prepare("SELECT MAX(used_at) AS t FROM session_facts WHERE artifact_id = ?")
    .get(artifactId) as { t: string | null };
  const counts = db
    .prepare(
      `SELECT verification, COUNT(*) AS n FROM session_facts
       WHERE artifact_id = ? GROUP BY verification`,
    )
    .all(artifactId) as Array<{ verification: string; n: number | bigint }>;
  let pass = 0;
  let fail = 0;
  let none = 0;
  for (const c of counts) {
    const n = Number(c.n);
    if (c.verification === "pass") pass = n;
    else if (c.verification === "fail") fail = n;
    else if (c.verification === "none") none = n;
  }
  const denom = pass + fail;
  const pass_rate = denom === 0 ? null : Math.round((pass / denom) * 1000) / 1000;
  const versionRows = db
    .prepare(
      `SELECT version, COUNT(DISTINCT session_key) AS n FROM session_facts
       WHERE artifact_id = ? GROUP BY version ORDER BY version ASC`,
    )
    .all(artifactId) as Array<{ version: string; n: number | bigint }>;
  const usage = usageSummary(db, artifactId).total;
  const filesJson = latestNonPurgedFilesJson(db, artifactId);
  const token_cost = filesJson ? tokenCostFromFilesJson(filesJson) : 0;
  const transfer_rate = transferRate(usage.uses, usage.helped);
  const ablation_score = ablationScore(artifactAblationReports(db, artifactId));
  return {
    sessions_count: Number(sessions.n),
    preloaded_sessions_count: Number(preloaded.n),
    users_count: Number(users.n),
    last_used_at: last.t ?? null,
    verification: { pass, fail, none, pass_rate },
    skill_age_days: skillAgeDays(db, artifactId, now),
    versions: versionRows.map((r) => ({ version: r.version, sessions_count: Number(r.n) })),
    ablation: latestAblation(db, artifactId),
    uses: usage.uses,
    helped: usage.helped,
    transfer_rate,
    ablation_score,
    token_cost,
    token_efficiency: tokenEfficiency(transfer_rate, token_cost),
    token_cost_estimated: true as const,
  };
}

export type UserSessionsSummary = {
  facts: number;
  skills: Array<{ name: string; count: number }>;
};

export function userSessionsSummary(db: Database, reporter: string): UserSessionsSummary {
  const total = db
    .prepare("SELECT COUNT(*) AS n FROM session_facts WHERE reporter = ?")
    .get(reporter) as { n: number | bigint };
  const skills = db
    .prepare(
      `SELECT a.name AS name, COUNT(*) AS count
       FROM session_facts sf
       JOIN artifacts a ON a.id = sf.artifact_id
       WHERE sf.reporter = ?
       GROUP BY a.name
       ORDER BY count DESC, a.name ASC
       LIMIT 10`,
    )
    .all(reporter) as Array<{ name: string; count: number | bigint }>;
  return {
    facts: Number(total.n),
    skills: skills.map((s) => ({ name: s.name, count: Number(s.count) })),
  };
}

export function parseAcceptBody(
  body: unknown,
): { ok: true; source: string; facts: unknown[] } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "invalid_body" };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.source !== "string" || b.source.length === 0 || b.source.length > MAX_SOURCE_LEN) {
    return { ok: false, error: "invalid_source" };
  }
  if (!Array.isArray(b.facts)) return { ok: false, error: "invalid_facts" };
  return { ok: true, source: b.source, facts: b.facts };
}

/**
 * Accept a batch of session facts in one BEGIN IMMEDIATE transaction.
 * Rate limit is checked inside the transaction for NEW inserts only.
 */
export function acceptSessionFacts(
  db: Database,
  input: { reporter: string; source: string; facts: unknown[]; now?: Date; viewer?: Viewer },
): AcceptResult {
  if (input.facts.length > MAX_SESSION_FACTS_BATCH) {
    return { kind: "bad_request", error: "batch_too_large" };
  }
  const now = input.now ?? new Date();
  const dayStart = utcDayStart(now);
  const createdAt = now.toISOString();
  const counters: AcceptCounters = { accepted: 0, duplicates: 0, unknown: 0, rejected: 0 };

  db.exec("BEGIN IMMEDIATE");
  try {
    const todayRow = db
      .prepare(
        `SELECT COUNT(*) AS n FROM session_facts
         WHERE reporter = ? AND created_at >= ?`,
      )
      .get(input.reporter, dayStart) as { n: number | bigint };
    let todayNew = Number(todayRow.n);

    for (const raw of input.facts) {
      const parsed = parseFactFields(raw);
      if (!parsed) {
        counters.rejected++;
        continue;
      }
      const skillName = parseSkillName(parsed.skill);
      if (!skillName) {
        counters.rejected++;
        continue;
      }
      if (validateFactShape(parsed, now) === "rejected") {
        counters.rejected++;
        continue;
      }

      const artifact = db
        .prepare(
          "SELECT id, visibility, owner_team, owner FROM artifacts WHERE type = 'skill' AND name = ?",
        )
        .get(skillName) as
        { id: string; visibility: string; owner_team: string | null; owner: string } | undefined;
      if (!artifact || !canView(db, input.viewer ?? null, artifact)) {
        counters.unknown++;
        continue;
      }

      const existing = db
        .prepare(
          `SELECT id FROM session_facts
           WHERE reporter = ? AND artifact_id = ? AND session_key = ? AND used_at = ?`,
        )
        .get(input.reporter, artifact.id, parsed.session_key, parsed.used_at) as
        { id: number } | undefined;
      if (existing) {
        counters.duplicates++;
        continue;
      }

      if (todayNew >= MAX_SESSION_FACTS_PER_DAY) {
        db.exec("ROLLBACK");
        return { kind: "rate_limited" };
      }

      const version = resolveVersionForUsedAt(db, artifact.id, parsed.used_at);
      if (!version) {
        counters.unknown++;
        continue;
      }

      db.prepare(
        `INSERT INTO session_facts
           (artifact_id, version, reporter, session_key, used_at, verification, source, created_at, basis)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        artifact.id,
        version,
        input.reporter,
        parsed.session_key,
        parsed.used_at,
        parsed.verification,
        input.source,
        createdAt,
        parsed.basis,
      );
      counters.accepted++;
      todayNew++;
    }

    db.exec("COMMIT");
    return { kind: "ok", counters };
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  }
}

export function deleteSessionFacts(db: Database, reporter: string, source?: string): number {
  if (source !== undefined && source !== "") {
    const r = db
      .prepare("DELETE FROM session_facts WHERE reporter = ? AND source = ?")
      .run(reporter, source);
    return Number(r.changes);
  }
  const r = db.prepare("DELETE FROM session_facts WHERE reporter = ?").run(reporter);
  return Number(r.changes);
}
