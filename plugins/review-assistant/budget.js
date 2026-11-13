// Runs paid from an Agent Space task budget (llm-budget-broker). A budget context is
// { budget_grant, request_id, budget_grant_id }: the grant is a bearer secret kept only in memory (the run queue and the
// publication bindings below); the two ids are stored on the run for idempotency and recovery. The model call carries
// `<grant>.<budget_grant_id>`, which the broker checks against the grant.

const GRANT_RE = /^as_sf_[A-Za-z0-9_-]{43}$/;
const REQUEST_RE = /^bg-[a-f0-9]{64}$/;
const GRANT_ID_RE = /^[a-f0-9-]{36}$/;
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/;
const CONTEXT_KEYS = ["budget_grant", "request_id", "budget_grant_id"];

export const BINDING_TTL_MS = 600_000;
export const MAX_BINDINGS = 200;
export const MAX_BACKFILL_ITEMS = 20;

export function validGrant(grant) {
  return typeof grant === "string" && GRANT_RE.test(grant);
}

/** True when the body carries any part of a budget context (then all of it must be valid). */
export function wantsBudget(body) {
  return CONTEXT_KEYS.some((key) => Object.hasOwn(body ?? {}, key));
}

/** The context of a body, or null when it is incomplete or malformed. */
export function budgetContext(body) {
  const { budget_grant: grant, request_id: requestId, budget_grant_id: grantId } = body ?? {};
  if (!validGrant(grant)) return null;
  if (typeof requestId !== "string" || !REQUEST_RE.test(requestId)) return null;
  if (typeof grantId !== "string" || !GRANT_ID_RE.test(grantId)) return null;
  return { grant, requestId, grantId };
}

/** True when the body starts a budget context but does not complete it correctly. */
export function budgetContextError(body) {
  return wantsBudget(body) && !budgetContext(body);
}

/** A skill version named in the body plus a valid context (publication bindings and backfill items). */
export function scopedInput(body) {
  const { name, version } = body ?? {};
  if (typeof name !== "string" || !NAME_RE.test(name)) return null;
  if (typeof version !== "string" || version.length > 128 || !VERSION_RE.test(version)) return null;
  const context = budgetContext(body);
  return context ? { type: "skill", name, version, ...context } : null;
}

/** The model call's grant: `<grant>.<grant id>` for runs that have a grant id. */
export function modelGrant(row, grant) {
  return row.budget_grant_id ? `${grant}.${row.budget_grant_id}` : grant;
}

/** An earlier run with this request id: the run, "conflict" when it is about something else, or null. */
export function previousRequest(db, input, username, trigger) {
  const prior = db
    .prepare("SELECT * FROM ext_review_assistant_runs WHERE request_id = ?")
    .get(input.requestId);
  if (!prior) return null;
  const same =
    prior.trigger === trigger &&
    prior.artifact_type === input.type &&
    prior.artifact_name === input.name &&
    prior.version === input.version &&
    prior.requested_by === username &&
    prior.budget_grant_id === input.grantId;
  return same ? prior : "conflict";
}

/** Grants of runs bound to a coming publication: in memory only, for at most BINDING_TTL_MS, at most MAX_BINDINGS. */
export class PublicationGrants {
  #items = new Map();

  get size() {
    return this.#items.size;
  }

  has(runId) {
    return this.#items.has(runId);
  }

  remember(runId, grant) {
    const old = this.#items.get(runId);
    if (old) clearTimeout(old.timer);
    const timer = setTimeout(() => this.#items.delete(runId), BINDING_TTL_MS);
    timer.unref?.();
    this.#items.set(runId, { grant, timer });
  }

  take(runId) {
    const item = this.#items.get(runId);
    if (!item) return null;
    clearTimeout(item.timer);
    this.#items.delete(runId);
    return item.grant;
  }
}

/** Is this stored reviewer list the terminal "the model answered something invalid" result? */
export function endedWithInvalidOutput(reviewers, llmReviewerId) {
  return reviewers.some((r) => r.id === llmReviewerId && r.status === "invalid_output");
}
