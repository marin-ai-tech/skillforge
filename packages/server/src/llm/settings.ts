import type { AppConfig } from "../config.ts";
import type { Database } from "../db.ts";

/** LLM access settings edited by admin. The API key is not part of them. */
export type LlmSettings = {
  enabled: boolean;
  base_url: string;
  model: string;
  temperature: number;
  max_output_tokens: number;
  timeout_s: number;
  /** 0 = no limit. */
  daily_requests_per_user: number;
  context_topics: number;
  /** Skill validation (llm-skill-validation): null = not decided yet, content stays here until an admin decides. */
  validation_enabled: boolean | null;
  /** 0 = no limit. */
  validation_daily_requests: number;
  validation_max_output_tokens: number;
  validation_timeout_s: number;
};

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  enabled: false,
  base_url: "",
  model: "",
  temperature: 0.2,
  max_output_tokens: 1024,
  timeout_s: 60,
  daily_requests_per_user: 50,
  context_topics: 6,
  validation_enabled: null,
  validation_daily_requests: 200,
  validation_max_output_tokens: 2048,
  validation_timeout_s: 120,
};

type NumberField =
  | "temperature"
  | "max_output_tokens"
  | "timeout_s"
  | "daily_requests_per_user"
  | "context_topics"
  | "validation_daily_requests"
  | "validation_max_output_tokens"
  | "validation_timeout_s";

const NUMBER_RANGES: Record<NumberField, { min: number; max: number; int: boolean }> = {
  temperature: { min: 0, max: 2, int: false },
  max_output_tokens: { min: 64, max: 8192, int: true },
  timeout_s: { min: 5, max: 300, int: true },
  daily_requests_per_user: { min: 0, max: 100000, int: true },
  context_topics: { min: 1, max: 12, int: true },
  validation_daily_requests: { min: 0, max: 100000, int: true },
  validation_max_output_tokens: { min: 256, max: 8192, int: true },
  validation_timeout_s: { min: 5, max: 300, int: true },
};

export class SettingsError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(message);
    this.field = field;
  }
}

/** An http(s) URL without credentials; trailing slashes dropped. Empty string = not configured. */
export function parseBaseUrl(raw: unknown): string {
  if (typeof raw !== "string") throw new SettingsError("base_url", "base_url must be a string");
  const value = raw.trim().replace(/\/+$/, "");
  if (value === "") return "";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SettingsError("base_url", "base_url must be an http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SettingsError("base_url", "base_url must be an http(s) URL");
  }
  if (url.username || url.password)
    throw new SettingsError("base_url", "base_url must not contain credentials");
  return value;
}

function parseNumber(field: NumberField, raw: unknown): number {
  const range = NUMBER_RANGES[field];
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < range.min || raw > range.max) {
    throw new SettingsError(field, `${field} must be a number from ${range.min} to ${range.max}`);
  }
  if (range.int && !Number.isInteger(raw))
    throw new SettingsError(field, `${field} must be an integer`);
  return raw;
}

function parseModel(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 200 || /[\s]/.test(raw.trim())) {
    throw new SettingsError(
      "model",
      "model must be a non-empty name without spaces (up to 200 characters)",
    );
  }
  return raw.trim();
}

/** Applies a PUT body (any subset of fields) to `current`; unknown fields and bad values are rejected. */
export function applySettingsPatch(current: LlmSettings, body: unknown): LlmSettings {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new SettingsError("body", "body must be an object");
  const next: LlmSettings = { ...current };
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (key === "enabled") {
      if (typeof value !== "boolean") throw new SettingsError(key, "enabled must be a boolean");
      next.enabled = value;
    } else if (key === "validation_enabled") {
      // null means "keep": the page sends its whole form, and "not decided" cannot be chosen again.
      if (value !== null && typeof value !== "boolean")
        throw new SettingsError(key, "validation_enabled must be a boolean");
      if (value !== null) next.validation_enabled = value;
    } else if (key === "base_url") next.base_url = parseBaseUrl(value);
    else if (key === "model") next.model = parseModel(value);
    else if (key in NUMBER_RANGES)
      next[key as NumberField] = parseNumber(key as NumberField, value);
    else throw new SettingsError(key, `unknown field ${key}`);
  }
  return next;
}

/** Stored settings over the defaults; a damaged row falls back to the defaults (assistant stays off). */
/**
 * A PUT from an admin. First configuration of the connection turns validation on unless the admin decided
 * otherwise; an install that was configured before validation existed stays undecided (customer's decision 1).
 */
export function applyAdminPatch(current: LlmSettings, body: unknown): LlmSettings {
  const next = applySettingsPatch(current, body);
  if (!isConfigured(current) && isConfigured(next) && next.validation_enabled === null) {
    next.validation_enabled = true;
  }
  return next;
}

export function loadSettings(db: Database): LlmSettings {
  const row = db.prepare("SELECT settings FROM llm_settings WHERE id = 1").get() as
    { settings: string } | undefined;
  if (!row) return { ...DEFAULT_LLM_SETTINGS };
  try {
    const stored = JSON.parse(row.settings) as Record<string, unknown>;
    // An empty model means "not configured yet": valid in storage, rejected only as an explicit PUT value.
    if (stored && stored.model === "") delete stored.model;
    return applySettingsPatch(DEFAULT_LLM_SETTINGS, stored);
  } catch {
    return { ...DEFAULT_LLM_SETTINGS };
  }
}

export function saveSettings(db: Database, settings: LlmSettings, actor: string): void {
  db.prepare(
    `INSERT INTO llm_settings (id, settings, updated_by, updated_at) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET settings = excluded.settings, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).run(JSON.stringify(settings), actor, new Date().toISOString());
}

/** Ready to call: enabled, with an address and a model. */
export function isConfigured(s: LlmSettings): boolean {
  return s.base_url !== "" && s.model !== "";
}

/** The key may go to `baseUrl` only when its origin is listed in SKILLFORGE_LLM_KEY_ORIGINS. */
export function keyAllowedFor(config: AppConfig, baseUrl: string): boolean {
  if (!config.llmApiKey || !baseUrl) return false;
  try {
    return config.llmKeyOrigins.includes(new URL(baseUrl).origin);
  } catch {
    return false;
  }
}

/** Authorization header for a call to `baseUrl`: the key only for an allowed origin. */
export function authHeaderFor(config: AppConfig, baseUrl: string): Record<string, string> {
  return keyAllowedFor(config, baseUrl) ? { authorization: `Bearer ${config.llmApiKey}` } : {};
}

export const today = (now = new Date()) => now.toISOString().slice(0, 10);

/**
 * Counts one request for the user before the model is called: returns false when the daily
 * limit is reached. One conditional upsert, so the check and the increment cannot be split by another request.
 */
export function reserveRequest(db: Database, userId: string, limit: number): boolean {
  if (limit <= 0) {
    db.prepare(
      `INSERT INTO llm_usage (user_id, day, requests) VALUES (?, ?, 1)
       ON CONFLICT(user_id, day) DO UPDATE SET requests = requests + 1`,
    ).run(userId, today());
    return true;
  }
  const res = db
    .prepare(
      `INSERT INTO llm_usage (user_id, day, requests) VALUES (?, ?, 1)
       ON CONFLICT(user_id, day) DO UPDATE SET requests = requests + 1 WHERE requests < ?`,
    )
    .run(userId, today(), limit);
  return Number(res.changes) > 0;
}

export function addTokens(db: Database, userId: string, input: number, output: number): void {
  db.prepare(
    "UPDATE llm_usage SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ? WHERE user_id = ? AND day = ?",
  ).run(Math.max(0, input), Math.max(0, output), userId, today());
}

export function requestsToday(db: Database, userId: string): number {
  const row = db
    .prepare("SELECT requests FROM llm_usage WHERE user_id = ? AND day = ?")
    .get(userId, today()) as { requests: number } | undefined;
  return row?.requests ?? 0;
}

/** Spends one request of a task's daily budget before the model is called; false when it is used up. */
export function reserveTaskRequest(db: Database, purpose: string, limit: number): boolean {
  const res = db
    .prepare(
      `INSERT INTO llm_task_usage (purpose, day, requests) VALUES (?, ?, 1)
       ON CONFLICT(purpose, day) DO UPDATE SET requests = requests + 1 WHERE ? <= 0 OR requests < ?`,
    )
    .run(purpose, today(), limit, limit);
  return Number(res.changes) > 0;
}

export function addTaskTokens(db: Database, purpose: string, input: number, output: number): void {
  db.prepare(
    "UPDATE llm_task_usage SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ? WHERE purpose = ? AND day = ?",
  ).run(Math.max(0, input), Math.max(0, output), purpose, today());
}

export function taskRequestsToday(db: Database, purpose: string): number {
  const row = db
    .prepare("SELECT requests FROM llm_task_usage WHERE purpose = ? AND day = ?")
    .get(purpose, today()) as { requests: number } | undefined;
  return row?.requests ?? 0;
}

export type TaskUsageTotals = { requests: number; input_tokens: number; output_tokens: number };

export function taskUsageSince(db: Database, purpose: string, fromDay: string): TaskUsageTotals {
  return db
    .prepare(
      `SELECT COALESCE(SUM(requests), 0) AS requests, COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens
       FROM llm_task_usage WHERE purpose = ? AND day >= ?`,
    )
    .get(purpose, fromDay) as TaskUsageTotals;
}

export type UsageTotals = {
  requests: number;
  input_tokens: number;
  output_tokens: number;
  users: number;
};

export function usageSince(db: Database, fromDay: string): UsageTotals {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(requests), 0) AS requests, COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens, COUNT(DISTINCT user_id) AS users
       FROM llm_usage WHERE day >= ?`,
    )
    .get(fromDay) as UsageTotals;
  return row;
}
