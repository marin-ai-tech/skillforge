// Plugin review-assistant: independent review of artifact versions by external agents listed in the
// operator file `SKILLFORGE_REVIEWERS_FILE`, a judge (built-in or a command), reviewer decisions, version evidence.
// ES module without a build step; the platform contract is ctx (routes, events, migrations, registry, ui, process).
// Reviewers are started over the stdin/stdout protocol from ./runner.js by the platform runner ctx.process
// (process isolation lives in the core); the plugin does not import @skillforge/* and works from any directory.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTaskText, runReviewer, setSpawnIsolated, tryDecodeUtf8 } from "./runner.js";
import { judge } from "./judge.js";
import { LLM_PURPOSE, LLM_REVIEWER_ID, PROMPT_VERSION, runLlmReviewer } from "./llm-reviewer.js";
import { renderReviewTab } from "./tab.js";

const FILES_LIMIT = 512 * 1024; // total of text files in a task is at most 512 KiB
const MAX_NOTE = 500;
const DECISIONS = new Set(["fix", "verify", "defer", "reject"]);

function nowIso() {
  return new Date().toISOString();
}

function parseJson(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** The reviewers file is read at the start of every run (edit without a restart). */
function loadReviewersFile() {
  const path = process.env.SKILLFORGE_REVIEWERS_FILE;
  if (!path) return { missing: true };
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { missing: true };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { parseError: String(e?.message ?? e) };
  }
  const reviewers = Array.isArray(parsed.reviewers) ? parsed.reviewers : [];
  return { reviewers, judge: parsed.judge ?? null };
}

/** Task format: the `input` field, or the `--input json|prompt` flag in the command (fixture contract). */
function inputMode(reviewer) {
  if (reviewer.input === "json") return "json";
  if (reviewer.input === "prompt") return "prompt";
  const idx = Array.isArray(reviewer.command) ? reviewer.command.indexOf("--input") : -1;
  if (idx >= 0 && reviewer.command[idx + 1] === "json") return "json";
  if (idx >= 0 && reviewer.command[idx + 1] === "prompt") return "prompt";
  return "prompt";
}

/** Text files of a version from blobs; binary (non-UTF-8) ones are skipped; at most 512 KiB in total. */
function buildFiles(ctx, artifact, version) {
  const out = [];
  let total = 0;
  for (const f of version.files ?? []) {
    const bytes = ctx.registry.readFile(artifact.type, artifact.name, version.version, f.path);
    if (!bytes) continue;
    const text = tryDecodeUtf8(bytes);
    if (text === null) continue;
    let content = text;
    const remaining = FILES_LIMIT - total;
    if (remaining <= 0) break;
    if (content.length > remaining) content = content.slice(0, remaining) + "\n[truncated]";
    out.push({ path: f.path, content });
    total += content.length;
    if (total >= FILES_LIMIT) break;
  }
  return out;
}

function getRunRow(db, id) {
  return db.prepare("SELECT * FROM ext_review_assistant_runs WHERE id = ?").get(id);
}

function setRunStatus(db, id, status, error) {
  const run = getRunRow(db, id);
  if (!run) return;
  if (status === "running") {
    db.prepare(
      "UPDATE ext_review_assistant_runs SET status = 'running', started_at = ? WHERE id = ?",
    ).run(nowIso(), id);
  } else {
    db.prepare(
      "UPDATE ext_review_assistant_runs SET status = ?, error = ?, finished_at = ? WHERE id = ?",
    ).run(status, error ?? null, nowIso(), id);
  }
}

function serializeRun(row) {
  return {
    id: row.id,
    artifact: { type: row.artifact_type, name: row.artifact_name },
    version: row.version,
    status: row.status,
    trigger: row.trigger,
    requested_by: row.requested_by,
    reviewers: parseJson(row.reviewers, []),
    judge: row.judge ? parseJson(row.judge, null) : null,
    error: row.error,
    created_at: row.created_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
  };
}

function serializeFinding(row) {
  return {
    id: row.id,
    severity: row.severity,
    category: row.category,
    file: row.file,
    line: row.line,
    summary: row.summary,
    suggestion: row.suggestion,
    reviewers: parseJson(row.reviewers, []),
    agreed: row.agreed,
    of: row.of,
    decision: row.decision,
    decision_note: row.decision_note,
    decided_by: row.decided_by,
    decided_at: row.decided_at,
  };
}

function findActiveRun(db, type, name, version) {
  return db
    .prepare(
      "SELECT * FROM ext_review_assistant_runs WHERE artifact_type = ? AND artifact_name = ? AND version = ? AND status IN ('queued','running')",
    )
    .get(type, name, version);
}

function insertRun(ctx, { type, name, version, requestedBy, trigger }) {
  const res = ctx.db
    .prepare(
      "INSERT INTO ext_review_assistant_runs (artifact_type, artifact_name, version, status, requested_by, trigger, reviewers, judge, error, created_at) VALUES (?, ?, ?, 'queued', ?, ?, '[]', NULL, NULL, ?)",
    )
    .run(type, name, version, requestedBy ?? null, trigger, nowIso());
  return Number(res.lastInsertRowid);
}

function resolveVersion(ctx, type, name, version) {
  const artifact = ctx.registry.getArtifact(type, name);
  if (!artifact) return null;
  const ver = version ?? artifact.latest_version;
  if (!ver) return null;
  const detail = ctx.registry.getVersion(type, name, ver);
  return detail ? { artifact, version: ver, detail } : null;
}

// undefined = the reviewers file is usable; otherwise the run's failure reason.
function reviewersFileError(lf) {
  if (lf.missing || (Array.isArray(lf.reviewers) && lf.reviewers.length === 0)) {
    return lf.parseError ?? "reviewers_not_configured";
  }
  return lf.parseError ? lf.parseError : undefined;
}

function pickReviewers(lf, config) {
  const wanted =
    Array.isArray(config.reviewers) && config.reviewers.length > 0 ? config.reviewers : null;
  return lf.reviewers.filter((r) => !wanted || wanted.includes(r.id));
}

/** Skills only, and only when the check is enabled: otherwise no content leaves. */
function llmActiveFor(ctx, type) {
  return type === "skill" && ctx.llm.status(LLM_PURPOSE).active;
}

/** Run composition: a `validation` run uses the model only; other runs use external reviewers and the model if enabled. */
function planReviewers(ctx, row) {
  const useLlm = llmActiveFor(ctx, row.artifact_type);
  const llm = { id: LLM_REVIEWER_ID, kind: "llm" };
  if (row.trigger === "validation") {
    return useLlm ? { reviewers: [llm], judgeConfig: null } : { error: "llm_not_active" };
  }
  const lf = loadReviewersFile();
  const fileError = reviewersFileError(lf);
  if (fileError !== undefined && (lf.parseError || !useLlm)) return { error: fileError };
  const external = fileError === undefined ? pickReviewers(lf, ctx.config.get()) : [];
  const reviewers = useLlm ? [...external, llm] : external;
  if (reviewers.length === 0) return { error: "reviewers_not_configured" };
  return { reviewers, judgeConfig: lf.judge ?? null };
}

function runAllReviewers(ctx, reviewers, artifact, detail, files, maxFindings) {
  const checklist = CHECKLIST;
  return Promise.all(
    reviewers.map(async (r) => {
      if (r.kind === "llm") {
        const res = await runLlmReviewer(ctx.llm, artifact, detail, files, maxFindings);
        return { id: r.id, ...res };
      }
      const stdinText = buildTaskText(
        inputMode(r),
        artifact,
        detail,
        files,
        checklist,
        detail.quality ?? null,
      );
      const res = await runReviewer(r, stdinText, maxFindings, files);
      return { id: r.id, ...res };
    }),
  );
}

function toReviewerRows(results) {
  return results.map((r) => ({
    id: r.id,
    status: r.status,
    error: r.error ?? null,
    duration_ms: r.duration_ms ?? null,
    findings_count: (r.findings ?? []).length,
    ...(r.id === LLM_REVIEWER_ID
      ? {
          model: r.model,
          prompt_version: r.prompt_version,
          truncated: r.truncated,
          dropped_findings: r.dropped_findings,
        }
      : {}),
  }));
}

function insertFindings(db, runId, findings) {
  const insertFinding = db.prepare(
    "INSERT INTO ext_review_assistant_findings (run_id, severity, category, file, line, summary, suggestion, reviewers, agreed, of) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const f of findings) {
    insertFinding.run(
      runId,
      f.severity,
      f.category,
      f.file,
      f.line,
      f.summary,
      f.suggestion ?? null,
      JSON.stringify(f.reviewers ?? []),
      f.agreed,
      f.of,
    );
  }
}

/**
 * Translated badge labels: `locales/<lang>.json` next to the plugin (optional), e.g.
 * `{ "clean": "…", "findings": { "one": "… {n} …", "other": "… {n} …" } }`; plural categories follow Intl.PluralRules.
 */
function loadLocales() {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "locales");
  let names = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return {};
  }
  const out = {};
  for (const n of names) {
    try {
      out[n.slice(0, -5)] = JSON.parse(readFileSync(join(dir, n), "utf8"));
    } catch {
      // A broken locale file only loses its labels.
    }
  }
  return out;
}

const LOCALES = loadLocales();

function localLabels(count) {
  const labels = {};
  for (const [lang, t] of Object.entries(LOCALES)) {
    if (count === 0) {
      if (typeof t.clean === "string") labels[lang] = t.clean;
      continue;
    }
    const category = new Intl.PluralRules(lang).select(count);
    const template = t.findings?.[category] ?? t.findings?.other;
    if (typeof template === "string") labels[lang] = template.replace("{n}", String(count));
  }
  return labels;
}

/** The outcome on the artifact card (plugin-artifact-badges): reviewers see findings without opening it. */
function reviewBadge(ctx, artifact, count) {
  try {
    ctx.registry.setBadge(artifact.type, artifact.name, {
      id: "review",
      label: count > 0 ? `Review: ${count} finding${count === 1 ? "" : "s"}` : "Review: clean",
      labels: localLabels(count),
      tone: count > 0 ? "warn" : "ok",
    });
  } catch (e) {
    ctx.logger.warn?.(`review badge not set: ${String(e?.message ?? e)}`);
  }
}

// Returns false when the transaction failed (the run is then marked failed).
function persistRunResults(db, runId, judged, status, reviewerRows) {
  db.exec("BEGIN");
  try {
    insertFindings(db, runId, judged.findings);
    db.prepare(
      "UPDATE ext_review_assistant_runs SET status = ?, reviewers = ?, judge = ?, error = NULL, finished_at = ? WHERE id = ?",
    ).run(status, JSON.stringify(reviewerRows), JSON.stringify(judged), nowIso(), runId);
    db.exec("COMMIT");
    return true;
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    setRunStatus(db, runId, "failed", String(e?.message ?? e));
    return false;
  }
}

/** A previous successful run of the same version by this model and this prompt version. */
function currentCheck(db, type, name, version, model) {
  const rows = db
    .prepare(
      "SELECT * FROM ext_review_assistant_runs WHERE artifact_type = ? AND artifact_name = ? AND version = ? ORDER BY id DESC",
    )
    .all(type, name, version);
  return rows.find((row) =>
    parseJson(row.reviewers, []).some(
      (r) =>
        r.id === LLM_REVIEWER_ID &&
        r.status === "ok" &&
        r.model === model &&
        r.prompt_version === PROMPT_VERSION,
    ),
  );
}

/** Which run to start on publish; null means none. */
function publishTrigger(ctx, type) {
  if (ctx.config.get().auto_on_publish) {
    const lf = loadReviewersFile();
    if (reviewersFileError(lf) === undefined) return "publish";
  }
  return llmActiveFor(ctx, type) ? "validation" : null;
}

/** Latest skill versions without an up-to-date check, within the budget. */
function backfillQueue(ctx, status) {
  const queue = [];
  let skipped = 0;
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const page = ctx.registry.listArtifacts({ type: "skill", limit: pageSize, offset });
    for (const a of page.items) {
      const version = a.latest_version;
      const busy = version && findActiveRun(ctx.db, a.type, a.name, version);
      const done = version && currentCheck(ctx.db, a.type, a.name, version, status.model);
      const full = status.remaining_today !== null && queue.length >= status.remaining_today;
      if (!version || a.status === "retired" || busy || done || full) skipped += 1;
      else queue.push({ type: a.type, name: a.name, version });
    }
    if (offset + pageSize >= page.total) return { queue, skipped };
  }
}

async function executeRun(ctx, runId) {
  const db = ctx.db;
  const row = getRunRow(db, runId);
  if (!row) return;

  const plan = planReviewers(ctx, row);
  if (plan.error) {
    setRunStatus(db, runId, "failed", plan.error);
    return;
  }
  const { reviewers, judgeConfig } = plan;
  const maxFindings = Number(ctx.config.get().max_findings) || 50;

  setRunStatus(db, runId, "running", null);

  const resolved = resolveVersion(ctx, row.artifact_type, row.artifact_name, row.version);
  if (!resolved) {
    setRunStatus(db, runId, "failed", "artifact or version not found");
    return;
  }
  const { artifact, detail } = resolved;

  const files = buildFiles(ctx, artifact, detail);
  const results = await runAllReviewers(ctx, reviewers, artifact, detail, files, maxFindings);

  const judged = await judge(
    results.map((r) => ({ id: r.id, status: r.status, findings: r.findings })),
    { type: artifact.type, name: artifact.name, version: detail.version },
    judgeConfig,
    judgeConfig?.timeout_s,
  );

  // A purge can remove the run while external reviewers are still working.
  if (!getRunRow(db, runId)) return;

  const okCount = results.filter((r) => r.status === "ok").length;
  const status = okCount > 0 ? "done" : "failed";

  if (!persistRunResults(db, runId, judged, status, toReviewerRows(results))) return;
  if (status === "done") reviewBadge(ctx, artifact, judged.findings.length);

  // A model check does not count as a review: only an external reviewer adds evidence.
  if (results.some((r) => r.status === "ok" && r.id !== LLM_REVIEWER_ID)) {
    ctx.registry.addEvidence(artifact.type, artifact.name, detail.version, {
      kind: "review",
      url: `/api/v1/ext/review-assistant/runs/${runId}`,
    });
  }
}

export async function register(ctx) {
  setSpawnIsolated(ctx.process.spawnIsolated);
  ctx.llm.registerConsumer(LLM_PURPOSE);

  ctx.db.migrate([
    {
      id: "0001_runs",
      sql: `CREATE TABLE IF NOT EXISTS ext_review_assistant_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        artifact_type TEXT NOT NULL,
        artifact_name TEXT NOT NULL,
        version TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        requested_by TEXT,
        trigger TEXT NOT NULL,
        reviewers TEXT NOT NULL DEFAULT '[]',
        judge TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      )`,
    },
    {
      id: "0002_findings",
      sql: `CREATE TABLE IF NOT EXISTS ext_review_assistant_findings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL,
        severity TEXT NOT NULL,
        category TEXT NOT NULL,
        file TEXT,
        line INTEGER,
        summary TEXT NOT NULL,
        suggestion TEXT,
        reviewers TEXT NOT NULL DEFAULT '[]',
        agreed INTEGER NOT NULL,
        of INTEGER NOT NULL,
        decision TEXT,
        decision_note TEXT,
        decided_by TEXT,
        decided_at TEXT
      )`,
    },
    {
      id: "0003_findings_index",
      sql: "CREATE INDEX IF NOT EXISTS ext_review_assistant_findings_run ON ext_review_assistant_findings (run_id)",
    },
  ]);

  CHECKLIST = readChecklist(ctx.dir);

  let queueTail = Promise.resolve();
  const enqueue = (task) => {
    const p = queueTail.then(task, task);
    queueTail = p.catch(() => {});
    return p;
  };

  ctx.routes.register((app) => {
    app.post("/runs", async (request, reply) => {
      if (!ctx.auth.requireRole(request, reply, "reviewer")) return;
      const body = request.body ?? {};
      const { type, name, version } = body;
      if (typeof type !== "string" || typeof name !== "string") {
        return reply.code(404).send({ error: "not_found" });
      }
      const resolved = resolveVersion(ctx, type, name, version);
      if (!resolved) {
        return reply.code(404).send({ error: "not_found" });
      }

      const lf = loadReviewersFile();
      const noFile = lf.missing || (Array.isArray(lf.reviewers) && lf.reviewers.length === 0);
      if (noFile && !llmActiveFor(ctx, type)) {
        return reply.code(503).send({ error: "reviewers_not_configured" });
      }

      if (findActiveRun(ctx.db, type, name, resolved.version)) {
        return reply.code(409).send({ error: "run_in_progress" });
      }

      const id = insertRun(ctx, {
        type,
        name,
        version: resolved.version,
        requestedBy: request.user.username,
        trigger: "manual",
      });
      void enqueue(() => executeRun(ctx, id));
      return reply.code(202).send({ run: serializeRun(getRunRow(ctx.db, id)) });
    });

    app.post("/validation/runs", async (request, reply) => {
      if (!ctx.auth.requireRole(request, reply, "reviewer")) return;
      const { type, name, version } = request.body ?? {};
      if (typeof type !== "string" || typeof name !== "string") {
        return reply.code(404).send({ error: "not_found" });
      }
      const resolved = resolveVersion(ctx, type, name, version);
      if (!resolved) return reply.code(404).send({ error: "not_found" });
      if (type !== "skill") return reply.code(422).send({ error: "not_a_skill" });
      const status = ctx.llm.status(LLM_PURPOSE);
      if (!status.active) {
        return reply.code(409).send({ error: "validation_inactive", reason: status.reason });
      }
      const existing = currentCheck(ctx.db, type, name, resolved.version, status.model);
      if (existing) return reply.code(200).send({ run: serializeRun(existing) });
      if (findActiveRun(ctx.db, type, name, resolved.version)) {
        return reply.code(409).send({ error: "run_in_progress" });
      }
      const id = insertRun(ctx, {
        type,
        name,
        version: resolved.version,
        requestedBy: request.user.username,
        trigger: "validation",
      });
      void enqueue(() => executeRun(ctx, id));
      return reply.code(202).send({ run: serializeRun(getRunRow(ctx.db, id)) });
    });

    app.post("/validation/backfill", async (request, reply) => {
      if (!ctx.auth.requireRole(request, reply, "admin")) return;
      const status = ctx.llm.status(LLM_PURPOSE);
      if (!status.active) {
        return reply.code(409).send({ error: "validation_inactive", reason: status.reason });
      }
      const { queue, skipped } = backfillQueue(ctx, status);
      for (const item of queue) {
        const id = insertRun(ctx, {
          ...item,
          requestedBy: request.user.username,
          trigger: "validation",
        });
        void enqueue(() => executeRun(ctx, id));
      }
      return reply.code(200).send({ queued: queue.length, skipped });
    });

    app.get("/runs/:id", async (request, reply) => {
      const id = Number(request.params.id);
      const row = getRunRow(ctx.db, id);
      if (!row) return reply.code(404).send({ error: "not_found" });
      const run = serializeRun(row);
      run.findings = ctx.db
        .prepare("SELECT * FROM ext_review_assistant_findings WHERE run_id = ? ORDER BY id")
        .all(id)
        .map(serializeFinding);
      return reply.code(200).send({ run });
    });

    app.get("/artifacts/:type/:name/runs", async (request, reply) => {
      const { type, name } = request.params;
      const items = ctx.db
        .prepare(
          "SELECT * FROM ext_review_assistant_runs WHERE artifact_type = ? AND artifact_name = ? ORDER BY created_at DESC, id DESC",
        )
        .all(type, name)
        .map(serializeRun);
      return reply.code(200).send({ items });
    });

    app.post("/findings/:id/decision", async (request, reply) => {
      if (!ctx.auth.requireRole(request, reply, "reviewer")) return;
      const id = Number(request.params.id);
      const finding = ctx.db
        .prepare("SELECT * FROM ext_review_assistant_findings WHERE id = ?")
        .get(id);
      if (!finding) return reply.code(404).send({ error: "not_found" });
      const { decision, note } = request.body ?? {};
      if (!DECISIONS.has(decision)) {
        return reply.code(422).send({ error: "invalid_decision" });
      }
      if (
        note !== undefined &&
        note !== null &&
        (typeof note !== "string" || note.length > MAX_NOTE)
      ) {
        return reply.code(422).send({ error: "invalid_note" });
      }
      ctx.db
        .prepare(
          "UPDATE ext_review_assistant_findings SET decision = ?, decision_note = ?, decided_by = ?, decided_at = ? WHERE id = ?",
        )
        .run(decision, note ?? null, request.user.username, nowIso(), id);
      const updated = ctx.db
        .prepare("SELECT * FROM ext_review_assistant_findings WHERE id = ?")
        .get(id);
      const run = getRunRow(ctx.db, finding.run_id);
      if (run) {
        const version = ctx.registry.getVersion(run.artifact_type, run.artifact_name, run.version);
        const notification = decisionNotification({
          run,
          author: version?.published_by,
          actor: request.user.username,
          decision,
          note,
        });
        if (notification) ctx.notifications.send(notification);
      }
      return reply.code(200).send({ finding: serializeFinding(updated) });
    });
  });

  ctx.events.on("artifact.published", (evt) => {
    const { type, name } = evt.artifact;
    const trigger = publishTrigger(ctx, type);
    if (!trigger) return;
    const version = evt.version.version;
    if (findActiveRun(ctx.db, type, name, version)) return;
    const id = insertRun(ctx, {
      type,
      name,
      version,
      requestedBy: evt.actor?.username ?? null,
      trigger,
    });
    void enqueue(() => executeRun(ctx, id));
  });

  ctx.events.on("artifact.purged", (evt) => purgeReviewData(ctx.db, evt));

  ctx.events.on("server.started", () => {
    ctx.db
      .prepare(
        "UPDATE ext_review_assistant_runs SET status = 'failed', error = 'interrupted by restart', finished_at = ? WHERE status IN ('queued','running')",
      )
      .run(nowIso());
  });

  ctx.ui.artifactTab({ id: "review", label: "Review" }, ({ artifact, version, user }) => {
    return renderReviewTab(ctx, artifact, version, user, ctx.llm.status(LLM_PURPOSE).active);
  });
}

export function decisionNotification({ run, author, actor, decision, note }) {
  if (!author || author === actor) return null;
  return {
    users: [author],
    title: `Review decision: ${decision}`,
    text: note ?? undefined,
    url: `/artifacts/${encodeURIComponent(run.artifact_type)}/${encodeURIComponent(run.artifact_name)}?version=${encodeURIComponent(run.version)}#review`,
    artifact: { type: run.artifact_type, name: run.artifact_name },
    version: run.version,
  };
}

export function purgeReviewData(db, evt) {
  const { type, name } = evt.artifact;
  const where =
    evt.version === null
      ? "artifact_type = ? AND artifact_name = ?"
      : "artifact_type = ? AND artifact_name = ? AND version = ?";
  const args = evt.version === null ? [type, name] : [type, name, evt.version];
  db.prepare(
    `DELETE FROM ext_review_assistant_findings WHERE run_id IN
    (SELECT id FROM ext_review_assistant_runs WHERE ${where})`,
  ).run(...args);
  db.prepare(`DELETE FROM ext_review_assistant_runs WHERE ${where}`).run(...args);
}

let CHECKLIST = [];

function readChecklist(dir) {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, "checklist.json"), "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
