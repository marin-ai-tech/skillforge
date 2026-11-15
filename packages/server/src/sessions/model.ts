import type { Database } from "../repo.ts";

/**
 * session-fact-model: the model that called a skill, as sent in a session fact. The value comes from the client, so it
 * is parsed here once: lower case, a short id of letters, digits and `._:-`; anything else is dropped (the fact still
 * counts — the model is an addition, not the reason the fact exists).
 */
const MODEL_RE = /^[a-z0-9][a-z0-9._:-]{0,63}$/;

/** A model id the server keeps, or null. */
export function parseModel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const model = raw.toLowerCase();
  return MODEL_RE.test(model) ? model : null;
}

/** A repeated fact fills in a model the stored fact lacks; it never overwrites one. */
export function fillMissingModel(db: Database, factId: number, model: string | null): void {
  if (model === null) return;
  db.prepare("UPDATE session_facts SET model = ? WHERE id = ? AND model IS NULL").run(
    model,
    factId,
  );
}

/** Models at least two different people reported anywhere in the registry: only these are shown by name. */
export function sharedModels(db: Database): Set<string> {
  const rows = db
    .prepare(
      `SELECT model FROM session_facts WHERE model IS NOT NULL
       GROUP BY model HAVING COUNT(DISTINCT reporter) >= 2`,
    )
    .all() as Array<{ model: string }>;
  return new Set(rows.map((r) => r.model));
}
