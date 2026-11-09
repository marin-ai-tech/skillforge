// Eval suite parse + persist (skill-evals part A).
import type { Database } from "../db.ts";
import { canPublishVersion } from "../ownership.ts";
import { roleAtLeast, type Role } from "../auth/users.ts";
import { appendAudit } from "../repo.ts";

export type EvalGate = "off" | "required";
export type CheckType = "contains" | "not_contains" | "equals";
export type EvalCheck = { type: CheckType; value: string; ci?: boolean };
export type EvalCase = {
  id: string;
  kind: "trigger" | "task";
  prompt: string;
  holdout: boolean;
  expect_trigger?: boolean;
  checks?: EvalCheck[];
};

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_CASES = 100;
const MAX_BODY = 256 * 1024;
const MAX_PROMPT = 4000;
const MAX_CHECK_VALUE = 500;
const MAX_CHECKS = 10;
const MAX_CASE_ID = 40;

export function canManageEvals(
  db: Database,
  actor: string,
  role: Role,
  artifact: { id: string; owner: string },
): boolean {
  return canPublishVersion(db, actor, role, artifact).allowed;
}

export function canDisableGate(role: Role): boolean {
  return roleAtLeast(role, "reviewer");
}

export type SuiteParse =
  | { ok: true; gate: EvalGate | null; cases: EvalCase[] }
  | { ok: false; error: "suite_invalid" | "gate_needs_holdout"; detail?: string };

function detail(msg: string, caseId?: string): string {
  return caseId ? `case ${caseId}: ${msg}` : msg;
}

type SuiteFail = { ok: false; error: "suite_invalid"; detail: string };

function invalid(msg: string, caseId?: string): SuiteFail {
  return { ok: false, error: "suite_invalid", detail: detail(msg, caseId) };
}

function isFail<T extends object>(v: T | SuiteFail): v is SuiteFail {
  return "ok" in v && v.ok === false;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseGate(raw: unknown): { gate: EvalGate | null } | SuiteFail {
  if (raw === undefined) return { gate: null };
  if (raw !== "off" && raw !== "required") return invalid("invalid gate");
  return { gate: raw };
}

function parseCasesList(b: Record<string, unknown>): { list: unknown[] } | SuiteFail {
  if (!("cases" in b)) return invalid("cases required");
  if (!Array.isArray(b.cases)) return invalid("cases must be an array");
  if (b.cases.length > MAX_CASES) return invalid("too many cases");
  return { list: b.cases };
}

function parseCheck(ch: unknown, id: string): EvalCheck | SuiteFail {
  if (!isPlainObject(ch)) return invalid("invalid check", id);
  if (ch.type !== "contains" && ch.type !== "not_contains" && ch.type !== "equals") {
    return invalid("invalid check type", id);
  }
  if (typeof ch.value !== "string" || ch.value.length < 1 || ch.value.length > MAX_CHECK_VALUE) {
    return invalid("invalid check value", id);
  }
  if (ch.ci !== undefined && typeof ch.ci !== "boolean") {
    return invalid("invalid check ci", id);
  }
  const item: EvalCheck = { type: ch.type, value: ch.value };
  if (ch.ci === true) item.ci = true;
  return item;
}

function parseTriggerCase(
  c: Record<string, unknown>,
  base: { id: string; prompt: string; holdout: boolean },
): EvalCase | SuiteFail {
  if (typeof c.expect_trigger !== "boolean") {
    return invalid("expect_trigger required", base.id);
  }
  if (c.checks !== undefined) {
    return invalid("trigger must not have checks", base.id);
  }
  return {
    id: base.id,
    kind: "trigger",
    prompt: base.prompt,
    holdout: base.holdout,
    expect_trigger: c.expect_trigger,
  };
}

function parseTaskCase(
  c: Record<string, unknown>,
  base: { id: string; prompt: string; holdout: boolean },
): EvalCase | SuiteFail {
  const id = base.id;
  if (c.expect_trigger !== undefined) {
    return invalid("task must not have expect_trigger", id);
  }
  if (!Array.isArray(c.checks) || c.checks.length < 1 || c.checks.length > MAX_CHECKS) {
    return invalid("checks required (1..10)", id);
  }
  const checks: EvalCheck[] = [];
  for (const ch of c.checks) {
    const item = parseCheck(ch, id);
    if (isFail(item)) return item;
    checks.push(item);
  }
  return { id, kind: "task", prompt: base.prompt, holdout: base.holdout, checks };
}

/** Case id: kebab-case, at most MAX_CASE_ID chars, unique within the suite (recorded in `seen`). */
function parseCaseId(c: Record<string, unknown>, seen: Set<string>): { id: string } | SuiteFail {
  const id = typeof c.id === "string" ? c.id : "";
  if (!id || id.length > MAX_CASE_ID || !KEBAB_CASE.test(id)) {
    return invalid("invalid id", id || undefined);
  }
  if (seen.has(id)) return invalid("duplicate id", id);
  seen.add(id);
  return { id };
}

function parseCase(raw: unknown, seen: Set<string>): EvalCase | SuiteFail {
  if (!isPlainObject(raw)) return invalid("case must be an object");
  const c = raw;
  const parsedId = parseCaseId(c, seen);
  if (isFail(parsedId)) return parsedId;
  const id = parsedId.id;
  if (c.kind !== "trigger" && c.kind !== "task") return invalid("invalid kind", id);
  if (typeof c.prompt !== "string" || c.prompt.length < 1 || c.prompt.length > MAX_PROMPT) {
    return invalid("invalid prompt", id);
  }
  const holdout = c.holdout === undefined ? false : c.holdout === true;
  if (c.holdout !== undefined && typeof c.holdout !== "boolean") {
    return invalid("invalid holdout", id);
  }
  const base = { id, prompt: c.prompt, holdout };
  return c.kind === "trigger" ? parseTriggerCase(c, base) : parseTaskCase(c, base);
}

export function parseSuiteBody(body: unknown, rawSize?: number): SuiteParse {
  if (rawSize !== undefined && rawSize > MAX_BODY) {
    return invalid("body too large");
  }
  if (!isPlainObject(body)) {
    return invalid("body must be an object");
  }
  const b = body;
  const parsedGate = parseGate(b.gate);
  if (isFail(parsedGate)) return parsedGate;
  const gate = parsedGate.gate;
  const parsedList = parseCasesList(b);
  if (isFail(parsedList)) return parsedList;
  const seen = new Set<string>();
  const cases: EvalCase[] = [];
  for (const raw of parsedList.list) {
    const parsedCase = parseCase(raw, seen);
    if (isFail(parsedCase)) return parsedCase;
    cases.push(parsedCase);
  }
  if (gate === "required") {
    const holdouts = cases.filter((c) => c.holdout).length;
    if (holdouts === 0) return { ok: false, error: "gate_needs_holdout" };
  }
  return { ok: true, gate, cases };
}

export function getSuiteGate(db: Database, artifactId: string): EvalGate {
  const row = db.prepare("SELECT gate FROM eval_suites WHERE artifact_id = ?").get(artifactId) as
    { gate: string } | undefined;
  return row?.gate === "required" ? "required" : "off";
}

export function getSuiteUpdatedAt(db: Database, artifactId: string): string | null {
  const row = db
    .prepare("SELECT updated_at FROM eval_suites WHERE artifact_id = ?")
    .get(artifactId) as { updated_at: string } | undefined;
  return row?.updated_at ?? null;
}

export function listSuiteCases(db: Database, artifactId: string): EvalCase[] {
  const rows = db
    .prepare(
      "SELECT case_id, kind, prompt, holdout, expect_trigger, checks FROM eval_cases WHERE artifact_id = ? ORDER BY position ASC",
    )
    .all(artifactId) as Array<{
    case_id: string;
    kind: string;
    prompt: string;
    holdout: number;
    expect_trigger: number | null;
    checks: string | null;
  }>;
  return rows.map((r) => {
    const base: EvalCase = {
      id: r.case_id,
      kind: r.kind as "trigger" | "task",
      prompt: r.prompt,
      holdout: r.holdout === 1,
    };
    if (r.kind === "trigger") base.expect_trigger = r.expect_trigger === 1;
    else base.checks = r.checks ? (JSON.parse(r.checks) as EvalCheck[]) : [];
    return base;
  });
}

export type ReplaceSuiteResult =
  | { ok: true; gate: EvalGate; cases: EvalCase[] }
  | { ok: false; error: "forbidden" | "gate_needs_holdout"; detail?: string };

export function replaceSuite(
  db: Database,
  opts: {
    artifactId: string;
    actor: string;
    role: Role;
    gate: EvalGate | null;
    cases: EvalCase[];
  },
): ReplaceSuiteResult {
  const currentGate = getSuiteGate(db, opts.artifactId);
  let nextGate = currentGate;
  if (opts.gate !== null) {
    if (opts.gate === "required") {
      if (opts.cases.filter((c) => c.holdout).length === 0) {
        return { ok: false, error: "gate_needs_holdout" };
      }
      nextGate = "required";
    } else {
      if (currentGate === "required" && opts.gate === "off" && !canDisableGate(opts.role)) {
        return { ok: false, error: "forbidden" };
      }
      nextGate = "off";
    }
  } else if (nextGate === "required" && opts.cases.filter((c) => c.holdout).length === 0) {
    return { ok: false, error: "gate_needs_holdout" };
  }
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO eval_suites (artifact_id, gate, updated_by, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(artifact_id) DO UPDATE SET gate = excluded.gate, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).run(opts.artifactId, nextGate, opts.actor, now);
    db.prepare("DELETE FROM eval_cases WHERE artifact_id = ?").run(opts.artifactId);
    const ins = db.prepare(
      `INSERT INTO eval_cases (artifact_id, case_id, position, kind, prompt, holdout, expect_trigger, checks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    opts.cases.forEach((c, i) => {
      ins.run(
        opts.artifactId,
        c.id,
        i,
        c.kind,
        c.prompt,
        c.holdout ? 1 : 0,
        c.kind === "trigger" ? (c.expect_trigger ? 1 : 0) : null,
        c.kind === "task" ? JSON.stringify(c.checks ?? []) : null,
      );
    });
    const meta: Record<string, unknown> = {
      cases: opts.cases.length,
      holdout: opts.cases.filter((c) => c.holdout).length,
      gate: nextGate,
    };
    if (opts.gate !== null && opts.gate !== currentGate) {
      meta.from = currentGate;
      meta.to = nextGate;
    }
    appendAudit(db, {
      ts: now,
      actor: opts.actor,
      artifact_id: opts.artifactId,
      version: null,
      action: "eval_suite_change",
      meta,
    });
    db.exec("COMMIT");
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  }
  return { ok: true, gate: nextGate, cases: opts.cases };
}

export function evaluateChecks(output: string, checks: EvalCheck[]): boolean {
  for (const ch of checks) {
    const hay = ch.ci ? output.toLowerCase() : output;
    const needle = ch.ci ? ch.value.toLowerCase() : ch.value;
    if (ch.type === "contains" && !hay.includes(needle)) return false;
    if (ch.type === "not_contains" && hay.includes(needle)) return false;
    if (ch.type === "equals" && hay !== needle) return false;
  }
  return true;
}
