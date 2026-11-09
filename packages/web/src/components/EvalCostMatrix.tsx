import { useQuery } from "@tanstack/react-query";
import { getEvalCost } from "../api/client.ts";
import type { EvalCostCell } from "../api/types.ts";
import { STR } from "../lib/strings.ts";

function usd(v: number | null): string {
  return v === null ? "—" : `$${v < 0.01 ? v.toFixed(4) : v.toFixed(2)}`;
}

function count(v: number | null): string {
  return v === null ? "—" : String(v);
}

function Row({ cell }: { cell: EvalCostCell }) {
  return (
    <tr data-testid="eval-cost-row" className="border-t border-line">
      <td className="py-1 pr-3">
        {cell.runner_label}
        {cell.model ? (
          <span translate="no" className="block font-mono text-xs text-muted">
            {cell.model}
            {cell.agent ? ` · ${cell.agent}` : ""}
          </span>
        ) : null}
      </td>
      <td translate="no" className="py-1 pr-3 font-mono text-xs">
        {cell.kind}: {cell.side}
        <span className="block text-muted">
          {cell.version}
          {cell.against ? ` / ${cell.against}` : ""}
        </span>
      </td>
      <td className="py-1 pr-3">
        {cell.passed}/{cell.tasks}
      </td>
      <td className="py-1 pr-3 font-mono text-xs">
        {count(cell.input_tokens)} / {count(cell.output_tokens)}
      </td>
      <td className="py-1 pr-3 font-mono">{usd(cell.cost_usd)}</td>
      <td data-testid="eval-cost-per-solve" className="py-1 font-mono font-semibold">
        {usd(cell.cost_per_solve)}
      </td>
    </tr>
  );
}

/** Cost per solved task (cost-per-solve): runner x side of the latest compare and ablation runs. */
export function EvalCostMatrix({
  type,
  name,
  enabled,
}: {
  type: string;
  name: string;
  enabled: boolean;
}) {
  const q = useQuery({
    queryKey: ["evals-cost", type, name],
    queryFn: () => getEvalCost(type, name),
    enabled,
    staleTime: 5_000,
  });
  const items = q.data?.items ?? [];
  const S = STR.flow.evals.cost;
  return (
    <div data-testid="eval-cost" className="space-y-2 rounded-sf border border-line bg-surface p-4">
      <h3 className="text-sm font-medium uppercase tracking-wide text-muted">{S.title}</h3>
      <p className="text-xs text-ink-2">{S.description}</p>
      {items.length === 0 ? (
        <p data-testid="eval-cost-empty" className="text-ink-2">
          {S.empty}
        </p>
      ) : (
        <table className="w-full text-left">
          <thead className="text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="py-1 pr-3">{S.colRunner}</th>
              <th className="py-1 pr-3">{S.colVariant}</th>
              <th className="py-1 pr-3">{S.colSolved}</th>
              <th className="py-1 pr-3">{S.colTokens}</th>
              <th className="py-1 pr-3">{S.colCost}</th>
              <th className="py-1">{S.colPerSolve}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <Row key={`${c.run_id}:${c.side}`} cell={c} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
