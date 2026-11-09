import type { Database } from "../db.ts";
import { getRegistryEpoch } from "../registry-epoch.ts";
import type { Viewer } from "../visibility/index.ts";
import { compareAgent, type CompareSummary } from "./compare.ts";
import type { AgentRow } from "./store.ts";

/**
 * Cache of agent comparison summaries for the agents list and the cabinet overview.
 *
 * Key: agent (id, owner), its snapshot (`scanned_at`, `updated_at`) and the viewer (username and role,
 * since team visibility differs per user). The whole cache of a database is dropped as soon as the
 * registry epoch changes (`registry-epoch.ts`): publication, status transitions, purge, metadata,
 * channels, team membership, maintainers, owner, scope, agent snapshot or deletion. Only the default
 * comparison (`registryStatus: "active"`) is cached. Entries are frozen and callers get a copy.
 */
export const AGENT_SUMMARY_CACHE_MAX_ENTRIES = 5000;

type DbCache = { epoch: number; entries: Map<string, Readonly<CompareSummary>> };

const caches = new WeakMap<Database, DbCache>();

function cacheKey(agent: AgentRow, viewer: Viewer): string {
  return JSON.stringify([
    agent.id,
    agent.owner_id,
    agent.scanned_at,
    agent.updated_at,
    viewer ? viewer.username : null,
    viewer ? viewer.role : null,
  ]);
}

function currentCache(db: Database, epoch: number): DbCache {
  let cache = caches.get(db);
  if (!cache || cache.epoch !== epoch) {
    cache = { epoch, entries: new Map() };
    caches.set(db, cache);
  }
  return cache;
}

/** Comparison summary of one agent for `viewer`, served from the cache when still valid. */
export function cachedAgentSummary(db: Database, agent: AgentRow, viewer: Viewer): CompareSummary {
  const epoch = getRegistryEpoch();
  const cache = currentCache(db, epoch);
  const key = cacheKey(agent, viewer);
  const hit = cache.entries.get(key);
  if (hit) {
    // LRU: move the entry to the end of the insertion order.
    cache.entries.delete(key);
    cache.entries.set(key, hit);
    return { ...hit };
  }
  const summary: Readonly<CompareSummary> = Object.freeze({
    ...compareAgent(db, agent, { viewer }).summary,
  });
  // Store only when nothing changed the registry while comparing.
  if (getRegistryEpoch() === epoch) {
    cache.entries.set(key, summary);
    while (cache.entries.size > AGENT_SUMMARY_CACHE_MAX_ENTRIES) {
      const oldest = cache.entries.keys().next().value;
      if (oldest === undefined) break;
      cache.entries.delete(oldest);
    }
  }
  return { ...summary };
}

/** Number of live entries for `db` (diagnostics and tests). */
export function agentSummaryCacheSize(db: Database): number {
  const cache = caches.get(db);
  return cache && cache.epoch === getRegistryEpoch() ? cache.entries.size : 0;
}
