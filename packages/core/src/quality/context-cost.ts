/**
 * Context cost: how many tokens an artifact puts into the agent's context
 * and when. The agent keeps the name and description of every skill, command and agent on each turn, reads the
 * main file's body when the artifact is used, and other text files only when it needs them.
 */
export type ContextLevel = "low" | "medium" | "high";

export type ContextCost = {
  every_turn: number;
  on_use: number;
  on_demand: number;
  level: ContextLevel;
};

/** Thresholds of the level; `on_use` high matches the Q_BODY_LONG limit. */
export const CONTEXT_THRESHOLDS = {
  every_turn: { medium: 100, high: 200 },
  on_use: { medium: 2500, high: 5000 },
} as const;

/** The worse of the two thresholds; `on_demand` is read on request and does not raise the level. */
export function contextLevel(every_turn: number, on_use: number): ContextLevel {
  const t = CONTEXT_THRESHOLDS;
  if (every_turn > t.every_turn.high || on_use > t.on_use.high) return "high";
  if (every_turn > t.every_turn.medium || on_use > t.on_use.medium) return "medium";
  return "low";
}

export function contextCostOf(every_turn: number, on_use: number, on_demand: number): ContextCost {
  return { every_turn, on_use, on_demand, level: contextLevel(every_turn, on_use) };
}

export const NO_CONTEXT: ContextCost = contextCostOf(0, 0, 0);

/** A plugin costs what its components cost together. */
export function sumContextCosts(costs: readonly ContextCost[]): ContextCost {
  const sum = (k: "every_turn" | "on_use" | "on_demand") => costs.reduce((n, c) => n + c[k], 0);
  return contextCostOf(sum("every_turn"), sum("on_use"), sum("on_demand"));
}
