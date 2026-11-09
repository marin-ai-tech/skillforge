// Workflow definition DSL v1 validation.
const KEBAB_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_STEPS = 100;
const MAX_TIMEOUT_S = 600;
/** Reserved segment: collides with `GET/POST .../workflows/runs`. */
const RESERVED_IDS = new Set(["runs"]);
export const TERMINAL = new Set(["end", "fail"]);

export type WorkflowStep = {
  id: string;
  /** workflow gates: a gate waits for a person's decision; it has no argv. */
  kind: "command" | "gate";
  argv: string[];
  env: string[];
  timeout_s: number;
  on_success: string | null;
  on_failure: string | null;
  /** workflow gates: how many times the step may run; cycles must go through such a step. */
  max_visits: number | null;
  /** Where to go when max_visits is used up (default "fail"). */
  on_exhausted: string | null;
};

const MAX_VISITS = 10;

export type WorkflowDefinition = {
  version: 1;
  name: string | null;
  steps: WorkflowStep[];
};

export function isWorkflowId(id: string): boolean {
  return KEBAB_ID.test(id) && id.length <= 64 && !RESERVED_IDS.has(id);
}

function refTarget(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function validateEnv(st: Record<string, unknown>, where: string, errors: string[]): string[] {
  const env = Array.isArray(st.env) ? st.env.filter((x): x is string => typeof x === "string") : [];
  for (const e of env) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(e)) errors.push(`${where}.env: bad name "${e}"`);
    else if (e.startsWith("SKILLFORGE_")) {
      errors.push(`${where}.env: SKILLFORGE_* variables are not allowed`);
    }
  }
  return env;
}

function validateTimeout(st: Record<string, unknown>, where: string, errors: string[]): number {
  if (st.timeout_s === undefined) return 60;
  if (
    typeof st.timeout_s !== "number" ||
    !Number.isInteger(st.timeout_s) ||
    st.timeout_s < 1 ||
    st.timeout_s > MAX_TIMEOUT_S
  ) {
    errors.push(`${where}.timeout_s: integer 1..${MAX_TIMEOUT_S} required`);
    return 60;
  }
  return st.timeout_s;
}

function validateTransitions(st: Record<string, unknown>, where: string, errors: string[]): void {
  for (const key of ["on_success", "on_failure", "on_exhausted"] as const) {
    const t = refTarget(st[key]);
    if (t === null && st[key] !== undefined && st[key] !== null) {
      errors.push(`${where}.${key}: must be a step id, "end" or "fail"`);
    } else if (t !== null && !TERMINAL.has(t) && !KEBAB_ID.test(t)) {
      errors.push(`${where}.${key}: invalid target "${t}"`);
    }
  }
}

function validateStep(
  s: unknown,
  i: number,
  ids: Set<string>,
  errors: string[],
): WorkflowStep | null {
  const where = `steps[${i}]`;
  if (typeof s !== "object" || s === null || Array.isArray(s)) {
    errors.push(`${where}: must be an object`);
    return null;
  }
  const st = s as Record<string, unknown>;
  const id = typeof st.id === "string" ? st.id : "";
  if (!KEBAB_ID.test(id) || id.length > 64) {
    errors.push(`${where}.id: kebab-case id required (got ${JSON.stringify(st.id)})`);
    return null;
  }
  if (RESERVED_IDS.has(id)) errors.push(`${where}.id: "${id}" is reserved`);
  if (ids.has(id)) errors.push(`${where}.id: duplicate "${id}"`);
  ids.add(id);
  if (st.kind === "gate") return gateStep(st, id, where, errors);
  if (st.kind !== "command") {
    errors.push(`${where}.kind: "command" or "gate" required`);
    return null;
  }
  if (
    !Array.isArray(st.argv) ||
    st.argv.length === 0 ||
    !st.argv.every((x) => typeof x === "string" && x.length > 0)
  ) {
    errors.push(`${where}.argv: must be a non-empty array of strings`);
    return null;
  }
  const env = validateEnv(st, where, errors);
  const timeout_s = validateTimeout(st, where, errors);
  validateTransitions(st, where, errors);
  return {
    id,
    kind: "command",
    argv: st.argv as string[],
    env,
    timeout_s,
    on_success: refTarget(st.on_success),
    on_failure: refTarget(st.on_failure),
    max_visits: validateMaxVisits(st, where, errors),
    on_exhausted: refTarget(st.on_exhausted),
  };
}

function validateMaxVisits(
  st: Record<string, unknown>,
  where: string,
  errors: string[],
): number | null {
  if (st.max_visits === undefined || st.max_visits === null) return null;
  const v = st.max_visits;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > MAX_VISITS) {
    errors.push(`${where}.max_visits: integer 1..${MAX_VISITS} required`);
    return null;
  }
  return v;
}

/** A gate waits for a decision: approve follows on_success, reject follows on_failure. */
function gateStep(
  st: Record<string, unknown>,
  id: string,
  where: string,
  errors: string[],
): WorkflowStep {
  // The stored, normalized definition carries argv: [] for a gate; a command there is a mistake.
  if (st.argv !== undefined && !(Array.isArray(st.argv) && st.argv.length === 0))
    errors.push(`${where}.argv: a gate runs no command`);
  validateTransitions(st, where, errors);
  return {
    id,
    kind: "gate",
    argv: [],
    env: [],
    timeout_s: 60,
    on_success: refTarget(st.on_success),
    on_failure: refTarget(st.on_failure),
    max_visits: null,
    on_exhausted: null,
  };
}

// Default routing: on_success -> next step in declaration order (or "end").
function nextOnSuccess(steps: WorkflowStep[], s: WorkflowStep): string {
  if (s.on_success !== null) return s.on_success;
  const i = steps.indexOf(s);
  return i >= 0 && i + 1 < steps.length ? steps[i + 1]!.id : "end";
}

function edges(steps: WorkflowStep[], s: WorkflowStep): string[] {
  const out = [nextOnSuccess(steps, s), s.on_failure ?? "fail"];
  if (s.max_visits !== null) out.push(s.on_exhausted ?? "fail");
  return out.filter((t) => !TERMINAL.has(t));
}

/** References resolve to declared steps or terminals. */
function checkReferences(steps: WorkflowStep[], errors: string[]): void {
  const declared = new Set(steps.map((s) => s.id));
  for (const s of steps) {
    for (const [key, t] of [
      ["on_success", s.on_success],
      ["on_failure", s.on_failure],
      ["on_exhausted", s.on_exhausted],
    ] as const) {
      if (t !== null && !TERMINAL.has(t) && !declared.has(t)) {
        errors.push(`step "${s.id}".${key}: unknown step "${t}"`);
      }
    }
  }
}

/** Reachability from steps[0] and acyclicity on the resolved graph. */
function checkGraph(steps: WorkflowStep[], errors: string[]): void {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const reachable = new Set<string>();
  const stack = [steps[0]!.id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (reachable.has(cur)) continue;
    reachable.add(cur);
    for (const t of edges(steps, byId.get(cur)!)) stack.push(t);
  }
  for (const s of steps) {
    if (!reachable.has(s.id)) errors.push(`step "${s.id}": unreachable`);
  }
  // DFS cycle check over resolved edges, without bounded steps: every cycle must pass through a max_visits step.
  const bounded = new Set(steps.filter((s) => s.max_visits !== null).map((s) => s.id));
  const state = new Map<string, number>();
  const dfs = (id: string): boolean => {
    state.set(id, 1);
    for (const t of edges(steps, byId.get(id)!).filter((x) => !bounded.has(x))) {
      const st = state.get(t) ?? 0;
      if (st === 1) return true;
      if (st === 0 && dfs(t)) return true;
    }
    state.set(id, 2);
    return false;
  };
  for (const s of steps) {
    if (bounded.has(s.id)) continue;
    if ((state.get(s.id) ?? 0) === 0 && dfs(s.id)) {
      errors.push("steps contain a cycle without a max_visits step");
      break;
    }
  }
}

function header(
  o: Record<string, unknown>,
  errors: string[],
): { name: string | null; steps: unknown[] } | null {
  if (o.version !== 1) errors.push("version must be 1");
  if (o.name !== undefined && o.name !== null && typeof o.name !== "string") {
    errors.push("name must be a string");
  }
  const name =
    o.name === undefined || o.name === null ? null : typeof o.name === "string" ? o.name : null;
  if (!Array.isArray(o.steps) || o.steps.length === 0) {
    errors.push("steps must be a non-empty array");
    return null;
  }
  if (o.steps.length > MAX_STEPS) errors.push(`steps exceeds limit ${MAX_STEPS}`);
  return { name, steps: o.steps };
}

/** Validate a raw definition body; returns the normalized definition or the error list. */
export function validateDefinition(
  raw: unknown,
): { ok: true; definition: WorkflowDefinition } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ["definition must be an object"] };
  }
  const o = raw as Record<string, unknown>;
  const head = header(o, errors);
  if (!head) return { ok: false, errors };

  const ids = new Set<string>();
  const steps: WorkflowStep[] = [];
  for (const [i, s] of head.steps.entries()) {
    const step = validateStep(s, i, ids, errors);
    if (step) steps.push(step);
  }
  if (errors.length) return { ok: false, errors };

  checkReferences(steps, errors);
  if (errors.length) return { ok: false, errors };
  checkGraph(steps, errors);
  if (errors.length) return { ok: false, errors };
  return { ok: true, definition: { version: 1, name: head.name, steps } };
}
