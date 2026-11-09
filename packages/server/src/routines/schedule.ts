// Routine definition DSL v1 + schedule math.
const KEBAB_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_TIMEOUT_S = 600;
const MAX_EVERY_S = 31 * 86400;
const RESERVED_IDS = new Set(["runs"]);

export type ScheduleDef = { kind: "every"; seconds: number } | { kind: "cron"; expr: string };

export type RoutineCommand = {
  argv: string[];
  env: string[];
  timeout_s: number;
};

export type RoutineBudgets = {
  max_runs_per_day: number | null;
  max_consecutive_failures: number | null;
};

export type RoutineDefinition = {
  version: 1;
  name: string | null;
  enabled: boolean;
  schedule: ScheduleDef;
  command: RoutineCommand;
  budgets: RoutineBudgets;
};

export function isRoutineId(id: string): boolean {
  return KEBAB_ID.test(id) && id.length <= 64 && !RESERVED_IDS.has(id);
}

const CRON_RANGES = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
] as const;

function cronFieldOk(field: string, min: number, max: number): boolean {
  for (const part of field.split(",")) {
    const m = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(part);
    if (!m) return false;
    const lo = m[1] === "*" ? min : Number(m[1]);
    const hi = m[2] === undefined ? (m[1] === "*" ? max : lo) : Number(m[2]);
    if (m[3] !== undefined && Number(m[3]) < 1) return false;
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
      return false;
    }
  }
  return true;
}

export function cronExprOk(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return fields.every((f, i) => cronFieldOk(f, CRON_RANGES[i]![0], CRON_RANGES[i]![1]));
}

function cronFieldMatches(field: string, value: number, min: number, max: number): boolean {
  for (const part of field.split(",")) {
    const m = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(part)!;
    const lo = m[1] === "*" ? min : Number(m[1]);
    // `N/S` means N..max step S (POSIX/Vixie), not the single value N.
    const hi = m[2] === undefined ? (m[1] === "*" || m[3] !== undefined ? max : lo) : Number(m[2]);
    const stepN = m[3] === undefined ? 1 : Number(m[3]);
    if (value >= lo && value <= hi && (value - lo) % stepN === 0) return true;
  }
  return false;
}

/** Expand a cron field to its allowed value set. */
function cronFieldValues(field: string, min: number, max: number): number[] {
  const out: number[] = [];
  for (let v = min; v <= max; v++) {
    if (cronFieldMatches(field, v, min, max)) out.push(v);
  }
  return out;
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * True when the expression can fire at least once (≤ 4-year horizon).
 * Only the dom/mon combination can be impossible (e.g. Feb 31); a restricted
 * dow always fires (dow OR dom when both restricted).
 */
export function cronPossible(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  const [dom, mon, dow] = [fields[2]!, fields[3]!, fields[4]!];
  if (dow !== "*") return true;
  const months =
    mon === "*" ? [...DAYS_IN_MONTH.keys()].map((i) => i + 1) : cronFieldValues(mon, 1, 12);
  if (dom === "*") return months.length > 0;
  const days = cronFieldValues(dom, 1, 31);
  return months.some((m) => days.some((d) => d <= DAYS_IN_MONTH[m - 1]!));
}

function cronMatches(expr: string, d: Date): boolean {
  const fields = expr.trim().split(/\s+/);
  const baseOk =
    cronFieldMatches(fields[0]!, d.getUTCMinutes(), 0, 59) &&
    cronFieldMatches(fields[1]!, d.getUTCHours(), 0, 23) &&
    cronFieldMatches(fields[3]!, d.getUTCMonth() + 1, 1, 12);
  if (!baseOk) return false;
  // dom|dow: OR when both restricted, else the restricted field alone (star matches all).
  const domOk = cronFieldMatches(fields[2]!, d.getUTCDate(), 1, 31);
  const dowOk = cronFieldMatches(fields[4]!, d.getUTCDay(), 0, 6);
  return fields[2] !== "*" && fields[4] !== "*" ? domOk || dowOk : domOk && dowOk;
}

/** Next fire time after `from`; null when the schedule never fires within a year. */
export function nextRunAt(schedule: ScheduleDef, from: Date): string | null {
  if (schedule.kind === "every") {
    return new Date(from.getTime() + schedule.seconds * 1000).toISOString();
  }
  if (!cronPossible(schedule.expr)) return null;
  const start = new Date(Math.ceil((from.getTime() + 1) / 60000) * 60000);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    const t = new Date(start.getTime() + i * 60000);
    if (cronMatches(schedule.expr, t)) return t.toISOString();
  }
  return null;
}

function validateSchedule(raw: unknown, errors: string[]): ScheduleDef | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    errors.push("schedule must be an object");
    return null;
  }
  const s = raw as Record<string, unknown>;
  if (s.kind === "every") {
    if (
      typeof s.seconds !== "number" ||
      !Number.isInteger(s.seconds) ||
      s.seconds < 1 ||
      s.seconds > MAX_EVERY_S
    ) {
      errors.push(`schedule.seconds: integer 1..${MAX_EVERY_S} required`);
      return null;
    }
    return { kind: "every", seconds: s.seconds };
  }
  if (s.kind === "cron") {
    if (typeof s.expr !== "string" || !cronExprOk(s.expr)) {
      errors.push('schedule.expr: 5-field cron "m h dom mon dow" (UTC) required');
      return null;
    }
    if (!cronPossible(s.expr)) {
      errors.push("schedule.expr: never fires (check day-of-month vs month, e.g. Feb 31)");
      return null;
    }
    return { kind: "cron", expr: s.expr.trim() };
  }
  errors.push('schedule.kind: "every" or "cron" required');
  return null;
}

function validateEnvList(c: Record<string, unknown>, errors: string[]): string[] {
  const env = Array.isArray(c.env) ? c.env.filter((x): x is string => typeof x === "string") : [];
  for (const e of env) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(e)) errors.push(`command.env: bad name "${e}"`);
    else if (e.startsWith("SKILLFORGE_")) {
      errors.push("command.env: SKILLFORGE_* variables are not allowed");
    }
  }
  return env;
}

function validateCommand(raw: unknown, errors: string[]): RoutineCommand | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    errors.push("command must be an object");
    return null;
  }
  const c = raw as Record<string, unknown>;
  if (
    !Array.isArray(c.argv) ||
    c.argv.length === 0 ||
    !c.argv.every((x) => typeof x === "string" && x.length > 0)
  ) {
    errors.push("command.argv: must be a non-empty array of strings");
    return null;
  }
  const env = validateEnvList(c, errors);
  let timeout_s = 60;
  if (c.timeout_s !== undefined) {
    if (
      typeof c.timeout_s !== "number" ||
      !Number.isInteger(c.timeout_s) ||
      c.timeout_s < 1 ||
      c.timeout_s > MAX_TIMEOUT_S
    ) {
      errors.push(`command.timeout_s: integer 1..${MAX_TIMEOUT_S} required`);
    } else timeout_s = c.timeout_s;
  }
  return { argv: c.argv as string[], env, timeout_s };
}

function validateBudgets(raw: unknown, errors: string[]): RoutineBudgets {
  if (raw === undefined) return { max_runs_per_day: null, max_consecutive_failures: 5 };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    errors.push("budgets must be an object");
    return { max_runs_per_day: null, max_consecutive_failures: 5 };
  }
  const b = raw as Record<string, unknown>;
  const intIn = (v: unknown, lo: number, hi: number): number | null | undefined =>
    v === undefined || v === null
      ? null
      : typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi
        ? v
        : undefined;
  const perDay = intIn(b.max_runs_per_day, 1, 10000);
  if (perDay === undefined) errors.push("budgets.max_runs_per_day: integer 1..10000 required");
  const failures = intIn(b.max_consecutive_failures, 1, 100);
  if (failures === undefined) {
    errors.push("budgets.max_consecutive_failures: integer 1..100 required");
  }
  return {
    max_runs_per_day: perDay ?? null,
    max_consecutive_failures: failures === undefined || failures === null ? 5 : failures,
  };
}

function headFields(
  o: Record<string, unknown>,
  errors: string[],
): { name: string | null; enabled: boolean } {
  if (o.version !== 1) errors.push("version must be 1");
  if (o.name !== undefined && o.name !== null && typeof o.name !== "string") {
    errors.push("name must be a string");
  }
  if (o.enabled !== undefined && typeof o.enabled !== "boolean") {
    errors.push("enabled must be a boolean");
  }
  const name =
    o.name === undefined || o.name === null ? null : typeof o.name === "string" ? o.name : null;
  const enabled = o.enabled === undefined ? true : o.enabled === true;
  return { name, enabled };
}

/** Validate a raw definition body; returns the normalized definition or the error list. */
export function validateRoutineDefinition(
  raw: unknown,
): { ok: true; definition: RoutineDefinition } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ["definition must be an object"] };
  }
  const o = raw as Record<string, unknown>;
  const { name, enabled } = headFields(o, errors);

  const schedule = validateSchedule(o.schedule, errors);
  const command = validateCommand(o.command, errors);
  const budgets = validateBudgets(o.budgets, errors);
  if (errors.length || !schedule || !command) return { ok: false, errors };
  return {
    ok: true,
    definition: { version: 1, name, enabled, schedule, command, budgets },
  };
}
