import { readBlob } from "../blobs.ts";
import { getArtifactByTypeName, getVersion, type Database } from "../repo.ts";
import { contentsPath, expectOk, GitHubError, type GitHub } from "./github.ts";

/**
 * Rollout through pull requests: for each repository a new branch from the default
 * one, the files of the latest versions where `skillforge install --into` would put them, the CLI lock merged with
 * the one already there, and a pull request. Repositories are independent: one failing does not stop the others.
 */
/**
 * The `--into` folder per type, as `skillforge install --into .claude` would use it: version paths already start
 * with skills/, commands/ or agents/, and the lock lives in the folder itself.
 */
export const ROLLOUT_DIRS: Record<string, string> = {
  skill: ".claude",
  command: ".claude",
  agent: ".claude",
};

const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,127}$/;

export type RolloutRequest = { repos: string[]; artifacts: Array<{ type: string; name: string }> };
export type RepoResult = {
  repo: string;
  status: "opened" | "failed";
  pr_url?: string;
  error?: string;
};

export class RolloutInputError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const bad = (message: string) => new RolloutInputError(400, "bad_request", message);

function parseArtifacts(v: unknown): RolloutRequest["artifacts"] {
  if (!Array.isArray(v) || v.length < 1 || v.length > 20)
    throw bad("artifacts must list 1..20 items");
  return v.map((a) => {
    const o = (a ?? {}) as Record<string, unknown>;
    if (typeof o.type !== "string" || !(o.type in ROLLOUT_DIRS)) {
      throw bad("artifact type must be skill, command or agent");
    }
    if (typeof o.name !== "string" || !NAME_RE.test(o.name)) throw bad("invalid artifact name");
    return { type: o.type, name: o.name };
  });
}

export function parseRolloutRequest(body: unknown): RolloutRequest {
  const o = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(o.repos) || o.repos.length < 1 || o.repos.length > 50) {
    throw bad("repos must list 1..50 repositories");
  }
  for (const r of o.repos) {
    if (typeof r !== "string" || !REPO_RE.test(r)) throw bad("repos must be owner/name");
  }
  return { repos: [...new Set(o.repos as string[])], artifacts: parseArtifacts(o.artifacts) };
}

type RolloutFile = { path: string; content: Buffer };
type LockEntry = {
  version: string;
  digest: string;
  files: Record<string, string>;
  installed_at: string;
};
type Planned = {
  files: RolloutFile[];
  locks: Map<string, Record<string, LockEntry>>;
  labels: string[];
};

/** Files and lock entries of the latest active versions; refuses unknown or not active artifacts. */
export function planRollout(db: Database, dataDir: string, req: RolloutRequest): Planned {
  const plan: Planned = { files: [], locks: new Map(), labels: [] };
  const now = new Date().toISOString();
  for (const a of req.artifacts) {
    const row = getArtifactByTypeName(db, a.type, a.name);
    if (!row || row.purged_at || !row.latest_version) {
      throw new RolloutInputError(
        422,
        "unknown_artifact",
        `${a.type}/${a.name} is not in the registry`,
      );
    }
    if (row.status !== "active") {
      throw new RolloutInputError(422, "not_active", `${a.type}/${a.name} is ${row.status}`);
    }
    const version = getVersion(db, row.id, row.latest_version)!;
    const dir = ROLLOUT_DIRS[a.type]!;
    const files: Record<string, string> = {};
    for (const f of version.files) {
      plan.files.push({
        path: `${dir}/${f.path}`,
        content: Buffer.from(readBlob(dataDir, f.sha256)),
      });
      files[f.path] = f.sha256;
    }
    const lock = plan.locks.get(dir) ?? {};
    lock[`${a.type}/${a.name}`] = {
      version: version.version,
      digest: version.digest,
      files,
      installed_at: now,
    };
    plan.locks.set(dir, lock);
    plan.labels.push(`${a.type}/${a.name}@${version.version}`);
  }
  return plan;
}

type Existing = { sha: string; content: string } | null;

async function existingFile(
  gh: GitHub,
  repo: string,
  path: string,
  branch: string,
): Promise<Existing> {
  const r = await gh.request<{ sha?: string; content?: string }>(
    "GET",
    `${contentsPath(repo, path)}?ref=${encodeURIComponent(branch)}`,
  );
  if (r.status === 404) return null;
  if (r.status !== 200 || !r.data?.sha) throw new GitHubError(r.status, `GET ${path}: ${r.status}`);
  return { sha: r.data.sha, content: Buffer.from(r.data.content ?? "", "base64").toString("utf8") };
}

function mergedLock(
  existing: Existing,
  registry: string,
  entries: Record<string, LockEntry>,
): string {
  let artifacts: Record<string, unknown> = {};
  try {
    const parsed = existing ? (JSON.parse(existing.content) as { artifacts?: unknown }) : null;
    if (parsed?.artifacts && typeof parsed.artifacts === "object") {
      artifacts = parsed.artifacts as Record<string, unknown>;
    }
  } catch {
    /* an unreadable lock is replaced */
  }
  return `${JSON.stringify({ registry, artifacts: { ...artifacts, ...entries } }, null, 2)}\n`;
}

async function putFile(
  gh: GitHub,
  repo: string,
  branch: string,
  path: string,
  content: Buffer,
  sha?: string,
) {
  await expectOk(gh, "PUT", contentsPath(repo, path), {
    message: `SkillForge: add ${path}`,
    branch,
    content: content.toString("base64"),
    ...(sha ? { sha } : {}),
  });
}

async function rolloutOne(
  gh: GitHub,
  repo: string,
  ctx: { id: number; registry: string; plan: Planned },
): Promise<RepoResult> {
  const info = await expectOk<{ default_branch: string }>(gh, "GET", `/repos/${repo}`);
  const base = info.default_branch;
  const head = await expectOk<{ object: { sha: string } }>(
    gh,
    "GET",
    `/repos/${repo}/git/ref/heads/${encodeURIComponent(base)}`,
  );
  const branch = `skillforge/rollout-${ctx.id}`;
  await expectOk(gh, "POST", `/repos/${repo}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha: head.object.sha,
  });
  for (const f of ctx.plan.files) {
    const existing = await existingFile(gh, repo, f.path, branch);
    await putFile(gh, repo, branch, f.path, f.content, existing?.sha);
  }
  for (const [dir, entries] of ctx.plan.locks) {
    const path = `${dir}/.skillforge-lock.json`;
    const existing = await existingFile(gh, repo, path, branch);
    const body = Buffer.from(mergedLock(existing, ctx.registry, entries));
    await putFile(gh, repo, branch, path, body, existing?.sha);
  }
  const pr = await expectOk<{ html_url: string }>(gh, "POST", `/repos/${repo}/pulls`, {
    title: `SkillForge: ${ctx.plan.labels.join(", ")}`,
    head: branch,
    base,
    body: `Artifacts from the SkillForge registry ${ctx.registry}:\n\n${ctx.plan.labels.map((l) => `- ${l}`).join("\n")}\n\nKeep them up to date with \`skillforge sync --into <dir>\`.`,
  });
  return { repo, status: "opened", pr_url: pr.html_url };
}

export async function runRollout(
  gh: GitHub,
  repos: string[],
  ctx: { id: number; registry: string; plan: Planned },
): Promise<RepoResult[]> {
  const results: RepoResult[] = [];
  for (const repo of repos) {
    try {
      results.push(await rolloutOne(gh, repo, ctx));
    } catch (e) {
      const error =
        e instanceof GitHubError ? e.message : String((e as Error).message ?? e).slice(0, 200);
      results.push({ repo, status: "failed", error });
    }
  }
  return results;
}
