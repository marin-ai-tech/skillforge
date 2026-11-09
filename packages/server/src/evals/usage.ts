/**
 * Token usage and price of eval tasks. Both the runner's answer and the runners
 * file are untrusted input: fields are parsed here, and anything malformed is dropped without failing the task.
 */
export type RunnerPrice = { input_per_mtok: number; output_per_mtok: number };

export type CaseUsage = {
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  model: string | null;
};

export const NO_USAGE: CaseUsage = {
  input_tokens: null,
  output_tokens: null,
  cost_usd: null,
  model: null,
};

const MAX_TOKENS = 1e12;
const MAX_COST = 1e9;
const MAX_MODEL = 128;

function tokens(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_TOKENS ? v : null;
}

function money(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_COST ? v : null;
}

function modelName(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, MAX_MODEL) : null;
}

/** `usage`, `cost_usd` and `model` of a task answer. */
export function parseCaseUsage(answer: Record<string, unknown>): CaseUsage {
  const usage =
    answer.usage && typeof answer.usage === "object" && !Array.isArray(answer.usage)
      ? (answer.usage as Record<string, unknown>)
      : {};
  return {
    input_tokens: tokens(usage.input_tokens),
    output_tokens: tokens(usage.output_tokens),
    cost_usd: money(answer.cost_usd),
    model: modelName(answer.model),
  };
}

/** `price` of a runners-file entry, or null when absent or malformed. */
export function parseRunnerPrice(v: unknown): RunnerPrice | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const input = money(o.input_per_mtok);
  const output = money(o.output_per_mtok);
  return input === null || output === null
    ? null
    : { input_per_mtok: input, output_per_mtok: output };
}

export function parseRunnerLabel(v: unknown): string | null {
  return modelName(v);
}

/** The runner's own figure first, then tokens at the runner's price, otherwise unknown. */
export function caseCost(usage: CaseUsage, price: RunnerPrice | null): number | null {
  if (usage.cost_usd !== null) return usage.cost_usd;
  if (!price || usage.input_tokens === null || usage.output_tokens === null) return null;
  return (
    (usage.input_tokens * price.input_per_mtok + usage.output_tokens * price.output_per_mtok) / 1e6
  );
}
