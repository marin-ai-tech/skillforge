import type { Database } from "../repo.ts";

/**
 * Import source policy: which git addresses may be imported, whether archives
 * may be uploaded, and how long a commit waits. A git address is untrusted input: it is parsed here once and
 * compared by host, port and path segments, never as a string, so `github.com.evil.example` is not `github.com`.
 */
export type ImportPolicy = {
  git_mode: "open" | "allowlist";
  allowed_sources: string[];
  allow_archives: boolean;
  min_release_age_days: number;
};

export const DEFAULT_IMPORT_POLICY: ImportPolicy = {
  git_mode: "open",
  allowed_sources: [],
  allow_archives: true,
  min_release_age_days: 0,
};

const LOCAL_RULE = "local";
const MAX_RULES = 200;
const MAX_AGE_DAYS = 365;
const HOST_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$/;
const SEGMENT_RE = /^[a-z0-9._-]+$/;

export class PolicyError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(message);
    this.field = field;
  }
}

/** `host[:port][/org[/repo]]` in lower case, or `local`; everything else is rejected, not guessed at. */
function parseRule(raw: unknown): string {
  const bad = () => new PolicyError("allowed_sources", `invalid source rule: ${String(raw)}`);
  if (typeof raw !== "string") throw bad();
  const value = raw.trim().toLowerCase().replace(/\/+$/, "");
  if (value === LOCAL_RULE) return value;
  const [host, ...segments] = value.split("/");
  if (!host || !HOST_RE.test(host) || segments.length > 2) throw bad();
  if (segments.some((s) => !SEGMENT_RE.test(s) || s === "." || s === "..")) throw bad();
  return value;
}

const PARSERS: { [K in keyof ImportPolicy]: (value: unknown) => ImportPolicy[K] } = {
  git_mode: (value) => {
    if (value !== "open" && value !== "allowlist") {
      throw new PolicyError("git_mode", "git_mode must be open or allowlist");
    }
    return value;
  },
  allowed_sources: (value) => {
    if (!Array.isArray(value) || value.length > MAX_RULES) {
      throw new PolicyError(
        "allowed_sources",
        `allowed_sources must be a list of up to ${MAX_RULES} rules`,
      );
    }
    return [...new Set(value.map(parseRule))];
  },
  allow_archives: (value) => {
    if (typeof value !== "boolean") {
      throw new PolicyError("allow_archives", "allow_archives must be a boolean");
    }
    return value;
  },
  min_release_age_days: (value) => {
    if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > MAX_AGE_DAYS) {
      throw new PolicyError(
        "min_release_age_days",
        `min_release_age_days must be an integer from 0 to ${MAX_AGE_DAYS}`,
      );
    }
    return value as number;
  },
};

export function applyPolicyPatch(current: ImportPolicy, body: unknown): ImportPolicy {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new PolicyError("body", "body must be an object");
  }
  const next: ImportPolicy = { ...current };
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (!Object.hasOwn(PARSERS, key)) throw new PolicyError(key, `unknown field ${key}`);
    const field = key as keyof ImportPolicy;
    (next as Record<string, unknown>)[field] = PARSERS[field](value);
  }
  return next;
}

/** A damaged row falls back to the defaults: the policy table is written only through applyPolicyPatch. */
export function loadImportPolicy(db: Database): ImportPolicy {
  const row = db.prepare("SELECT settings FROM import_policy WHERE id = 1").get() as
    { settings: string } | undefined;
  if (!row) return { ...DEFAULT_IMPORT_POLICY };
  try {
    return applyPolicyPatch(DEFAULT_IMPORT_POLICY, JSON.parse(row.settings));
  } catch {
    return { ...DEFAULT_IMPORT_POLICY };
  }
}

export function saveImportPolicy(db: Database, policy: ImportPolicy, actor: string): void {
  db.prepare(
    `INSERT INTO import_policy (id, settings, updated_by, updated_at) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET settings = excluded.settings, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).run(JSON.stringify(policy), actor, new Date().toISOString());
}

export type GitLocation =
  { local: true; key: string } | { local: false; host: string; segments: string[]; key: string };

function remote(host: string, rawPath: string): GitLocation | null {
  if (/%2f|%5c|\\/i.test(rawPath)) return null;
  const parts = rawPath.split("/").filter((s) => s !== "");
  if (parts.length === 0 || parts.some((s) => s === "." || s === "..")) return null;
  const segments = parts.map((s) => s.toLowerCase());
  segments[segments.length - 1] = segments[segments.length - 1]!.replace(/\.git$/, "");
  const lowered = host.toLowerCase();
  return { local: false, host: lowered, segments, key: `${lowered}/${segments.join("/")}` };
}

function isLocal(url: string): boolean {
  return url.startsWith("file:") || /^(\/|\.\.?\/|[A-Za-z]:[\\/])/.test(url);
}

/** The address as host and path segments; null when it cannot be read with certainty. */
export function parseGitLocation(rawUrl: string): GitLocation | null {
  const url = rawUrl.trim();
  if (isLocal(url)) return { local: true, key: `local:${url}` };
  const scp = /^git@([^:/\s@]+):(.+)$/.exec(url);
  if (scp) return remote(scp[1]!, scp[2]!);
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "ssh:") return null;
    // Before the URL parser resolves dots: `a/../b` is refused rather than interpreted.
    const raw = url.slice(url.indexOf("//") + 2);
    const rawPath = raw.slice(raw.indexOf("/") < 0 ? raw.length : raw.indexOf("/"));
    if (rawPath.split(/[/?#]/).includes("..")) return null;
    return remote(parsed.host, parsed.pathname);
  } catch {
    return null;
  }
}

function ruleCovers(rule: string, location: GitLocation): boolean {
  if (location.local) return rule === LOCAL_RULE;
  if (rule === LOCAL_RULE) return false;
  const [host, ...segments] = rule.split("/");
  return host === location.host && segments.every((s, i) => location.segments[i] === s);
}

export function isSourceAllowed(policy: ImportPolicy, rawUrl: string): boolean {
  if (policy.git_mode === "open") return true;
  const location = parseGitLocation(rawUrl);
  return location !== null && policy.allowed_sources.some((rule) => ruleCovers(rule, location));
}

export function archivesAllowed(policy: ImportPolicy, role: string | undefined): boolean {
  return policy.allow_archives || role === "admin";
}

/** When the registry first saw this commit at this address; the first call sets it, later ones never move it. */
export function recordCommitSeen(db: Database, locationKey: string, commit: string): string {
  db.prepare(
    `INSERT INTO import_commit_seen (location_key, commit_sha, first_seen_at) VALUES (?, ?, ?)
     ON CONFLICT(location_key, commit_sha) DO NOTHING`,
  ).run(locationKey, commit, new Date().toISOString());
  const row = db
    .prepare(
      "SELECT first_seen_at FROM import_commit_seen WHERE location_key = ? AND commit_sha = ?",
    )
    .get(locationKey, commit) as { first_seen_at: string };
  return row.first_seen_at;
}

export type Freshness = {
  required_days: number;
  first_seen_at: string;
  ready_at: string;
  ready: boolean;
};

export function freshnessOf(
  policy: ImportPolicy,
  firstSeenAt: string,
  now: Date = new Date(),
): Freshness {
  const readyAt = new Date(
    new Date(firstSeenAt).getTime() + policy.min_release_age_days * 86_400_000,
  );
  return {
    required_days: policy.min_release_age_days,
    first_seen_at: firstSeenAt,
    ready_at: readyAt.toISOString(),
    ready: now.getTime() >= readyAt.getTime(),
  };
}
