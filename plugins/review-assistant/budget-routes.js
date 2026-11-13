// Routes and event handling for runs paid from an Agent Space task budget (llm-budget-broker). The run machinery
// (insert, queue, execute) stays in index.js and comes in through `deps`.
import {
  MAX_BACKFILL_ITEMS,
  MAX_BINDINGS,
  budgetContext,
  endedWithInvalidOutput,
  previousRequest,
  scopedInput,
  wantsBudget,
} from "./budget.js";
import { LLM_REVIEWER_ID } from "./llm-reviewer.js";

const answer = (code, body) => ({ code, body });
const runAnswer = (deps, code, row) => answer(code, { run: deps.serializeRun(row) });

function parseJson(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** Insert a queued budget run and put it in the queue with its grant (kept only in this closure). */
function startRun(ctx, deps, input, requestedBy, trigger) {
  const id = deps.insertRun(ctx, { ...input, requestedBy, trigger });
  void deps.enqueue(() => deps.executeRun(ctx, id, input.grant));
  return id;
}

/**
 * `POST /runs` and `POST /validation/runs` with a budget context: idempotent by request id, model only, never a cached
 * result. Returns null when the body has no budget context (the caller goes on as before).
 */
export function budgetRun(ctx, deps, request, body, resolved, trigger) {
  if (!wantsBudget(body)) return null;
  const context = budgetContext(body);
  if (!context || resolved.artifact.type !== "skill")
    return answer(400, { error: "invalid_recovery_context" });
  const input = {
    type: "skill",
    name: resolved.artifact.name,
    version: resolved.version,
    ...context,
  };
  const username = request.user.username;
  const prior = previousRequest(ctx.db, input, username, trigger);
  if (prior === "conflict") return answer(409, { error: "request_conflict" });
  if (prior) return runAnswer(deps, 200, prior);
  if (!deps.llmActiveFor(ctx, "skill")) return answer(409, { error: "validation_inactive" });
  if (deps.findActiveRun(ctx.db, input.type, input.name, input.version))
    return answer(409, { error: "run_in_progress" });
  const id = startRun(ctx, deps, input, username, trigger);
  return runAnswer(deps, 202, deps.getRunRow(ctx.db, id));
}

/** Items of a backfill list, or null when the list breaks a limit or repeats a request, grant or version. */
function backfillItems(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_BACKFILL_ITEMS) return null;
  const items = raw.map(scopedInput);
  if (items.some((item) => !item)) return null;
  const distinct = (key) => new Set(items.map(key)).size === items.length;
  const ok =
    distinct((i) => i.requestId) &&
    distinct((i) => i.grantId) &&
    distinct((i) => `${i.name}/${i.version}`);
  return ok ? items : null;
}

/** Each item with its earlier run, or an answer that refuses the whole list. */
function planBackfill(ctx, deps, items, username) {
  const planned = [];
  for (const item of items) {
    const prior = previousRequest(ctx.db, item, username, "backfill");
    if (prior === "conflict") return answer(409, { error: "request_conflict" });
    const resolved = deps.resolveVersion(ctx, "skill", item.name, item.version);
    if (!resolved || resolved.artifact.status === "retired")
      return answer(404, { error: "not_found" });
    if (!prior && deps.findActiveRun(ctx.db, "skill", item.name, item.version))
      return answer(409, { error: "run_in_progress" });
    planned.push({ item, prior });
  }
  return planned;
}

/** `POST /validation/backfill` with `items`: all or nothing, in one transaction. Null without `items`. */
export function budgetBackfill(ctx, deps, request, status) {
  const body = request.body ?? {};
  if (!Object.hasOwn(body, "items"))
    return wantsBudget(body) ? answer(400, { error: "invalid_backfill_items" }) : null;
  const items = backfillItems(body.items);
  if (!items) return answer(400, { error: "invalid_backfill_items" });
  const username = request.user.username;
  const planned = planBackfill(ctx, deps, items, username);
  if (!Array.isArray(planned)) return planned;
  const fresh = planned.filter((p) => !p.prior);
  if (status.remaining_today !== null && fresh.length > status.remaining_today)
    return answer(429, { error: "llm_budget_exhausted" });
  ctx.db.exec("BEGIN");
  try {
    for (const p of planned)
      p.id =
        p.prior?.id ??
        deps.insertRun(ctx, { ...p.item, requestedBy: username, trigger: "backfill" });
    ctx.db.exec("COMMIT");
  } catch (error) {
    ctx.db.exec("ROLLBACK");
    throw error;
  }
  for (const p of fresh) void deps.enqueue(() => deps.executeRun(ctx, p.id, p.item.grant));
  const runs = planned.map((p) => deps.serializeRun(deps.getRunRow(ctx.db, p.id)));
  return answer(200, { queued: fresh.length, skipped: 0, runs });
}

/** A resume that changes nothing: the run already finished or already runs with this grant id. */
function settledResume(row, grantId) {
  if (row.status === "done") return true;
  const sameGrant = row.budget_grant_id === grantId;
  if (row.status === "failed" && sameGrant)
    return endedWithInvalidOutput(parseJson(row.reviewers, []), LLM_REVIEWER_ID);
  return sameGrant && (row.status === "queued" || row.status === "running");
}

function resume(ctx, deps, request) {
  const context = budgetContext(request.body);
  if (!context) return answer(400, { error: "invalid_recovery_context" });
  const id = Number(request.params.id);
  const row = deps.getRunRow(ctx.db, id);
  if (!row || row.request_id !== context.requestId || row.requested_by !== request.user.username)
    return answer(404, { error: "not_found" });
  if (settledResume(row, context.grantId)) return runAnswer(deps, 200, row);
  if (row.status !== "interrupted") return answer(409, { error: "run_not_interrupted" });
  const changed = ctx.db
    .prepare(
      "UPDATE ext_review_assistant_runs SET status = 'queued', budget_grant_id = ?, error = NULL, started_at = NULL, finished_at = NULL WHERE id = ? AND status = 'interrupted'",
    )
    .run(context.grantId, id);
  if (Number(changed.changes) !== 1) return answer(409, { error: "run_conflict" });
  void deps.enqueue(() => deps.executeRun(ctx, id, context.grant));
  return runAnswer(deps, 202, deps.getRunRow(ctx.db, id));
}

function pendingBinding(db, type, name, version, username) {
  return db
    .prepare(
      "SELECT id FROM ext_review_assistant_runs WHERE artifact_type = ? AND artifact_name = ? AND version = ? AND requested_by = ? AND status = 'awaiting_publication'",
    )
    .get(type, name, version, username);
}

/** Refusals of a publication binding before anything is stored; null when it may go ahead. */
function bindingRefusal(ctx, deps, input, prior, username) {
  if (!deps.llmActiveFor(ctx, "skill")) return answer(409, { error: "validation_inactive" });
  if (deps.bindings.size >= MAX_BINDINGS && !deps.bindings.has(prior?.id))
    return answer(429, { error: "publication_bindings_full" });
  if (!prior && deps.resolveVersion(ctx, "skill", input.name, input.version))
    return answer(409, { error: "version_already_published" });
  const pending = pendingBinding(ctx.db, "skill", input.name, input.version, username);
  if (pending && pending.id !== prior?.id) return answer(409, { error: "run_in_progress" });
  return null;
}

function bind(ctx, deps, request) {
  const input = scopedInput(request.body);
  if (!input) return answer(400, { error: "invalid_recovery_context" });
  const username = request.user.username;
  const prior = previousRequest(ctx.db, input, username, "publication_validation");
  if (prior === "conflict") return answer(409, { error: "request_conflict" });
  if (prior && prior.status !== "awaiting_publication") return runAnswer(deps, 200, prior);
  const refusal = bindingRefusal(ctx, deps, input, prior, username);
  if (refusal) return refusal;
  const id =
    prior?.id ??
    deps.insertRun(ctx, {
      ...input,
      requestedBy: username,
      trigger: "publication_validation",
      status: "awaiting_publication",
    });
  deps.bindings.remember(id, input.grant);
  return runAnswer(deps, prior ? 200 : 202, deps.getRunRow(ctx.db, id));
}

/** On publish: a check bound to this version by its publisher runs with the remembered grant. True when handled. */
export function bindingForPublish(ctx, deps, evt) {
  const { type, name } = evt.artifact;
  const pending = pendingBinding(
    ctx.db,
    type,
    name,
    evt.version.version,
    evt.actor?.username ?? null,
  );
  if (!pending) return false;
  const grant = deps.bindings.take(pending.id);
  if (!grant) {
    ctx.db
      .prepare(
        "UPDATE ext_review_assistant_runs SET status = 'interrupted', error = 'budget_grant_required' WHERE id = ?",
      )
      .run(pending.id);
    return true;
  }
  ctx.db
    .prepare("UPDATE ext_review_assistant_runs SET status = 'queued' WHERE id = ?")
    .run(pending.id);
  void deps.enqueue(() => deps.executeRun(ctx, pending.id, grant));
  return true;
}

export function registerBudgetRoutes(app, ctx, deps) {
  const send = (reply, result) => reply.code(result.code).send(result.body);

  app.get("/validation/by-request/:id", async (request, reply) => {
    if (!ctx.auth.requireRole(request, reply, "reviewer")) return;
    const row = ctx.db
      .prepare("SELECT * FROM ext_review_assistant_runs WHERE request_id = ? AND requested_by = ?")
      .get(request.params.id, request.user.username);
    return row
      ? send(reply, runAnswer(deps, 200, row))
      : reply.code(404).send({ error: "not_found" });
  });

  app.post("/validation/runs/:id/resume", async (request, reply) => {
    if (!ctx.auth.requireRole(request, reply, "reviewer")) return;
    return send(reply, resume(ctx, deps, request));
  });

  app.post("/validation/publication-bindings", async (request, reply) => {
    if (!ctx.auth.requireRole(request, reply, "reviewer")) return;
    return send(reply, bind(ctx, deps, request));
  });
}
