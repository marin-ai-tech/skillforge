/**
 * Workflow templates. `epic-with-gates`: plan → approval → implement ↔ review (bounded rounds) →
 * release approval, where a rejected release goes back to implementation. Commands come from the operator.
 */
export type WorkflowTemplate = {
  id: string;
  name: string;
  description: string;
  slots: string[];
};

export const TEMPLATES: WorkflowTemplate[] = [
  {
    id: "epic-with-gates",
    name: "Epic with gates",
    description:
      "Plan, a person approves the plan, implement and review in bounded rounds, a person approves the release.",
    slots: ["plan", "implement", "review"],
  },
];

export class TemplateError extends Error {}

function argvOf(commands: Record<string, unknown>, slot: string): string[] {
  const argv = commands[slot];
  if (!Array.isArray(argv) || argv.length === 0 || !argv.every((x) => typeof x === "string" && x)) {
    throw new TemplateError(`commands.${slot} must be a non-empty array of strings`);
  }
  return argv as string[];
}

/** The definition the template produces; it goes through the usual validation afterwards. */
export function definitionFromTemplate(body: unknown): unknown {
  const o = (body ?? {}) as Record<string, unknown>;
  if (o.template !== "epic-with-gates") throw new TemplateError("unknown template");
  const commands = (o.commands ?? {}) as Record<string, unknown>;
  const rounds = o.max_review_rounds === undefined ? 3 : o.max_review_rounds;
  return {
    version: 1,
    name: "Epic with gates",
    steps: [
      { id: "plan", kind: "command", argv: argvOf(commands, "plan"), timeout_s: 600 },
      { id: "plan-approval", kind: "gate", on_failure: "fail" },
      {
        id: "implement",
        kind: "command",
        argv: argvOf(commands, "implement"),
        timeout_s: 600,
        max_visits: rounds,
        on_exhausted: "fail",
      },
      {
        id: "review",
        kind: "command",
        argv: argvOf(commands, "review"),
        timeout_s: 600,
        on_success: "release-approval",
        on_failure: "implement",
      },
      { id: "release-approval", kind: "gate", on_success: "end", on_failure: "implement" },
    ],
  };
}
