import type { AppConfig } from "../config.ts";
import type { Database } from "../db.ts";
import { completeChat, LlmError, type ChatMessage, type Usage } from "./client.ts";
import {
  addTaskTokens,
  isConfigured,
  loadSettings,
  reserveTaskRequest,
  taskRequestsToday,
} from "./settings.ts";

/**
 * Background LLM tasks: one connection, one switch and budget per
 * purpose. Separate from the help assistant, so a task never spends a user's daily limit. Plugins reach this
 * through ctx.llm, which never exposes the key.
 */
export const LLM_PURPOSES = ["skill_validation"] as const;
export type LlmPurpose = (typeof LLM_PURPOSES)[number];

export type LlmTaskReason = "undecided" | "disabled" | "not_configured";

export type LlmTaskStatus = {
  active: boolean;
  reason: LlmTaskReason | null;
  model: string | null;
  /** Requests left today; null when there is no limit. */
  remaining_today: number | null;
};

export function parsePurpose(raw: unknown): LlmPurpose {
  if (typeof raw === "string" && (LLM_PURPOSES as readonly string[]).includes(raw)) {
    return raw as LlmPurpose;
  }
  throw new LlmError("unknown_purpose");
}

/** Plugins that will act on a purpose: without one, the admin page says that nothing checks anything. */
const consumers = new Set<LlmPurpose>();

export function registerConsumer(purpose: LlmPurpose): void {
  consumers.add(purpose);
}

export function resetConsumers(): void {
  consumers.clear();
}

export function hasConsumer(purpose: LlmPurpose): boolean {
  return consumers.has(purpose);
}

export function taskStatus(db: Database, purpose: LlmPurpose): LlmTaskStatus {
  const s = loadSettings(db);
  const limit = s.validation_daily_requests;
  const remaining_today = limit > 0 ? Math.max(0, limit - taskRequestsToday(db, purpose)) : null;
  const inactive = (reason: LlmTaskReason): LlmTaskStatus => ({
    active: false,
    reason,
    model: null,
    remaining_today,
  });
  if (!isConfigured(s)) return inactive("not_configured");
  if (s.validation_enabled === null) return inactive("undecided");
  if (!s.validation_enabled) return inactive("disabled");
  return { active: true, reason: null, model: s.model, remaining_today };
}

export type TaskResult = { text: string; usage: Usage; model: string };

/** One model call for a purpose: checks the switch, spends the budget, counts tokens; failures are LlmError codes. */
export async function completeTask(
  db: Database,
  config: AppConfig,
  args: { purpose: LlmPurpose; messages: ChatMessage[]; budgetGrant?: string },
): Promise<TaskResult> {
  const { purpose, messages } = args;
  if (!taskStatus(db, purpose).active) throw new LlmError("llm_disabled");
  const settings = loadSettings(db);
  if (!reserveTaskRequest(db, purpose, settings.validation_daily_requests)) {
    throw new LlmError("llm_budget_exhausted");
  }
  const { text, usage } = await completeChat({
    config,
    settings: { ...settings, timeout_s: settings.validation_timeout_s },
    messages,
    maxTokens: settings.validation_max_output_tokens,
    budgetGrant: args.budgetGrant,
  });
  addTaskTokens(db, purpose, usage.input_tokens, usage.output_tokens);
  return { text, usage, model: settings.model };
}
