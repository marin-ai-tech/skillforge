import type { ContextCost as Cost } from "../api/types.ts";
import { STR } from "../lib/strings.ts";

/** Tokens the artifact puts into the agent's context (context-cost): every turn, when used and on demand. */
export function ContextCost({ cost }: { cost: Cost | undefined }) {
  if (!cost) return null;
  const rows: Array<[keyof typeof STR.art.quality.contextRows, number]> = [
    ["every_turn", cost.every_turn],
    ["on_use", cost.on_use],
    ["on_demand", cost.on_demand],
  ];
  return (
    <section data-testid="quality-context" data-level={cost.level} className="space-y-2">
      <h2 className="text-sm font-semibold text-ink">{STR.art.quality.contextTitle}</h2>
      <dl className="grid gap-1 text-sm sm:grid-cols-[auto_1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{STR.art.quality.contextRows[k]}</dt>
            <dd data-testid={`quality-context-${k}`} className="font-mono">
              {STR.art.quality.contextTokens(v)}
            </dd>
          </div>
        ))}
      </dl>
      {cost.level === "high" ? (
        <p data-testid="quality-context-warning" className="text-sm text-warning">
          {STR.art.quality.contextHigh}
        </p>
      ) : null}
    </section>
  );
}
