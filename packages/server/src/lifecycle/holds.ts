import type { Database } from "../db.ts";

export type LifecycleHold = {
  until: string;
  reason: string;
  set_by: string;
  set_at: string;
};

export function getHold(db: Database, artifactId: string): LifecycleHold | null {
  const row = db
    .prepare("SELECT until, reason, set_by, set_at FROM lifecycle_holds WHERE artifact_id = ?")
    .get(artifactId) as LifecycleHold | undefined;
  return row ?? null;
}

/** Active hold if present and until is strictly in the future relative to nowIso. */
export function getActiveHold(
  db: Database,
  artifactId: string,
  nowIso: string,
): LifecycleHold | null {
  const hold = getHold(db, artifactId);
  if (!hold) return null;
  if (hold.until <= nowIso) return null;
  return hold;
}

export function upsertHold(
  db: Database,
  artifactId: string,
  input: { until: string; reason: string; set_by: string; set_at: string },
): void {
  db.prepare(
    `INSERT INTO lifecycle_holds (artifact_id, until, reason, set_by, set_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(artifact_id) DO UPDATE SET
       until = excluded.until,
       reason = excluded.reason,
       set_by = excluded.set_by,
       set_at = excluded.set_at`,
  ).run(artifactId, input.until, input.reason, input.set_by, input.set_at);
}

export function deleteHold(db: Database, artifactId: string): boolean {
  const r = db.prepare("DELETE FROM lifecycle_holds WHERE artifact_id = ?").run(artifactId);
  return Number(r.changes) > 0;
}

export type HoldParse =
  { ok: true; until: string; reason: string } | { ok: false; error: "hold_invalid" };

const MAX_HOLD_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

export function parseHoldBody(body: unknown, nowMs: number): HoldParse {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "hold_invalid" };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.until !== "string" || typeof b.reason !== "string") {
    return { ok: false, error: "hold_invalid" };
  }
  const reason = b.reason;
  if (reason.length < 5) return { ok: false, error: "hold_invalid" };
  const untilMs = Date.parse(b.until);
  if (!Number.isFinite(untilMs)) return { ok: false, error: "hold_invalid" };
  // Must be a full ISO-ish parseable date; reject if re-serialize drifts wildly.
  if (untilMs <= nowMs) return { ok: false, error: "hold_invalid" };
  if (untilMs > nowMs + MAX_HOLD_DAYS * DAY_MS) return { ok: false, error: "hold_invalid" };
  return { ok: true, until: new Date(untilMs).toISOString(), reason };
}
