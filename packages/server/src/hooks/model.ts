// Hook runtime storage.
// hook_subscriptions pins a published hook-artifact version as an active org
// hook; hook_decisions is the append-only audit of every evaluated handler.
import type { Database } from "../db.ts";

export type HookSubscription = {
  id: number;
  artifact_id: string;
  artifact_type: string;
  artifact_name: string;
  version: string;
  enabled: number;
  created_by: string;
  created_at: string;
};

export type HookDecisionRow = {
  id: number;
  subscription_id: number;
  event: string;
  matcher: string | null;
  entry_idx: number | null;
  verdict: string;
  exit_code: number | null;
  duration_ms: number | null;
  detail: string | null;
  actor: string;
  context: string | null;
  created_at: string;
};

export type NewDecision = Omit<HookDecisionRow, "id" | "created_at">;

export function listSubscriptions(db: Database): HookSubscription[] {
  return db
    .prepare("SELECT * FROM hook_subscriptions ORDER BY id")
    .all() as unknown as HookSubscription[];
}

export function listEnabledSubscriptions(db: Database): HookSubscription[] {
  return db
    .prepare("SELECT * FROM hook_subscriptions WHERE enabled = 1 ORDER BY id")
    .all() as unknown as HookSubscription[];
}

export function getSubscription(db: Database, id: number): HookSubscription | undefined {
  return db.prepare("SELECT * FROM hook_subscriptions WHERE id = ?").get(id) as
    HookSubscription | undefined;
}

export function findSubscription(
  db: Database,
  artifactId: string,
  version: string,
): HookSubscription | undefined {
  return db
    .prepare("SELECT * FROM hook_subscriptions WHERE artifact_id = ? AND version = ?")
    .get(artifactId, version) as HookSubscription | undefined;
}

export function createSubscription(
  db: Database,
  input: {
    artifact_id: string;
    artifact_type: string;
    artifact_name: string;
    version: string;
    created_by: string;
  },
): HookSubscription {
  const res = db
    .prepare(
      `INSERT INTO hook_subscriptions
        (artifact_id, artifact_type, artifact_name, version, enabled, created_by, created_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(
      input.artifact_id,
      input.artifact_type,
      input.artifact_name,
      input.version,
      input.created_by,
      new Date().toISOString(),
    );
  return getSubscription(db, Number(res.lastInsertRowid))!;
}

export function setSubscriptionEnabled(db: Database, id: number, enabled: boolean): void {
  db.prepare("UPDATE hook_subscriptions SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
}

export function deleteSubscription(db: Database, id: number): void {
  db.prepare("DELETE FROM hook_subscriptions WHERE id = ?").run(id);
}

export function countDecisions(db: Database, subscriptionId: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM hook_decisions WHERE subscription_id = ?")
    .get(subscriptionId) as { n: number | bigint };
  return Number(row.n);
}

export function recordDecision(db: Database, d: NewDecision): void {
  db.prepare(
    `INSERT INTO hook_decisions
      (subscription_id, event, matcher, entry_idx, verdict, exit_code, duration_ms,
       detail, actor, context, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    d.subscription_id,
    d.event,
    d.matcher,
    d.entry_idx,
    d.verdict,
    d.exit_code,
    d.duration_ms,
    d.detail,
    d.actor,
    d.context,
    new Date().toISOString(),
  );
}

export function listDecisions(db: Database, limit = 200): HookDecisionRow[] {
  return db
    .prepare(
      `SELECT d.*, s.artifact_type, s.artifact_name, s.version
       FROM hook_decisions d
       JOIN hook_subscriptions s ON s.id = d.subscription_id
       ORDER BY d.id DESC LIMIT ?`,
    )
    .all(limit) as unknown as HookDecisionRow[];
}
