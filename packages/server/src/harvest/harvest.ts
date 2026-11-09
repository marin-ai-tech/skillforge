import { harvestRules, type HarvestItem, type HarvestRule } from "@skillforge/core";
import { expectOk, type GitHub } from "../rollout/github.ts";

/** Recurring rules from pull request review comments (skill-harvest); the GitHub connection is the one of pr-rollout. */
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const MAX_PAGES = 10;

export type HarvestRequest = { source: "github"; repo: string; days: number };

export class HarvestInputError extends Error {}

export function parseHarvestRequest(body: unknown): HarvestRequest {
  const o = (body ?? {}) as Record<string, unknown>;
  if (o.source !== "github") throw new HarvestInputError("source must be github");
  if (typeof o.repo !== "string" || !REPO_RE.test(o.repo))
    throw new HarvestInputError("repo must be owner/name");
  const days = o.days === undefined ? 30 : Number(o.days);
  if (!Number.isInteger(days) || days < 1 || days > 365)
    throw new HarvestInputError("days must be 1..365");
  return { source: "github", repo: o.repo, days };
}

type ReviewComment = { body?: string; html_url?: string; pull_request_url?: string };

export async function harvestFromGitHub(gh: GitHub, req: HarvestRequest): Promise<HarvestRule[]> {
  const since = new Date(Date.now() - req.days * 86_400_000).toISOString();
  const items: HarvestItem[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await expectOk<ReviewComment[]>(
      gh,
      "GET",
      `/repos/${req.repo}/pulls/comments?since=${encodeURIComponent(since)}&per_page=100&page=${page}`,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const c of batch) {
      if (typeof c.body !== "string" || typeof c.html_url !== "string") continue;
      items.push({ text: c.body, source: c.pull_request_url ?? c.html_url, ref: c.html_url });
    }
    if (batch.length < 100) break;
  }
  return harvestRules(items);
}
