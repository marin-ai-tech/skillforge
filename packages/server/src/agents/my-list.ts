import type { Database } from "../db.ts";
import type { Viewer } from "../visibility/index.ts";
import { cachedAgentSummary } from "./summary-cache.ts";
import { agentPublicView, countAgentItems, listAgents } from "./store.ts";

/** Shared list builder for GET /api/v1/me/agents and cabinet overview (summary cached). */
export function buildMyAgentsList(db: Database, ownerId: string, viewer: Viewer = null) {
  const agents = listAgents(db, ownerId);
  return agents.map((a) => ({
    ...agentPublicView(a),
    item_count: countAgentItems(db, a.id),
    summary: cachedAgentSummary(db, a, viewer),
  }));
}
