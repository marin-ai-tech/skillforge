import { useQuery } from "@tanstack/react-query";
import { getEvalsSummary } from "../api/client.ts";
import type { EvalsSummaryRow } from "../api/types.ts";
import { STR } from "../lib/strings.ts";
import { EmptyState } from "./EmptyState.tsx";
import { ErrorState } from "./ErrorState.tsx";
import { Skeleton } from "./Skeleton.tsx";
import { usd } from "./EvalCostMatrix.tsx";

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;

function SummaryTable({ rows }: { rows: EvalsSummaryRow[] }) {
  const t = STR.ws.metrics.evals;
  const cell = "py-1 pr-3";
  const head = `${cell} font-medium`;
  const cols = [t.cols.runner, t.cols.agent, t.cols.model, t.cols.skills, t.cols.tasks];
  const tail = [t.cols.withSkill, t.cols.withoutSkill, t.cols.uplift, t.cols.costPerSolve];
  return (
    <>
      {/* A narrow screen scrolls the table here; tabIndex lets the keyboard scroll it too (WCAG 2.1.1). */}
      <div
        className="overflow-x-auto"
        role="region"
        aria-labelledby="metrics-evals-summary-title"
        tabIndex={0}
      >
        <table aria-labelledby="metrics-evals-summary-title" className="w-full text-left text-xs">
          <thead className="text-muted">
            <tr>
              {[...cols, ...tail].map((c) => (
                <th key={c} scope="col" className={head}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-ink">
            {rows.map((r) => (
              <tr key={r.runner} data-runner={r.runner} className="border-t border-line">
                <th scope="row" className={`${cell} font-normal`} translate="no">
                  {r.runner_label}
                </th>
                <td className={cell} translate="no">
                  {r.agent ?? "—"}
                </td>
                <td className={`${cell} font-mono`} translate="no">
                  {r.model ?? "—"}
                </td>
                <td className={`${cell} font-mono`}>{r.artifacts}</td>
                <td className={`${cell} font-mono`}>{r.tasks}</td>
                <td className={`${cell} font-mono`}>{pct(r.pass_rate_with)}</td>
                <td className={`${cell} font-mono`}>{pct(r.pass_rate_without)}</td>
                <td className={`${cell} font-mono`}>{pct(r.uplift)}</td>
                <td className={`${cell} font-mono`}>{usd(r.cost_per_solve)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">{t.caveat}</p>
    </>
  );
}

/** evals-summary: agents and models in evals across the registry, for reviewers and above. */
export function EvalsSummarySection() {
  const t = STR.ws.metrics.evals;
  const q = useQuery({ queryKey: ["evals-summary"], queryFn: getEvalsSummary, staleTime: 30_000 });
  let body;
  if (q.isLoading) body = <Skeleton className="h-16" />;
  else if (q.isError || !q.data) body = <ErrorState onRetry={() => void q.refetch()} />;
  else if (q.data.items.length === 0)
    body = (
      <EmptyState
        title={t.emptyTitle}
        hint={t.emptyHint}
        linkHref="/help/getting-started/eval-runs-runners"
        linkLabel={t.emptyLink}
      />
    );
  else body = <SummaryTable rows={q.data.items} />;
  return (
    <section
      data-testid="metrics-evals-summary"
      className="mt-6 rounded-sf border border-line bg-surface p-4 text-sm"
    >
      <h2
        id="metrics-evals-summary-title"
        className="mb-3 text-sm font-medium uppercase tracking-wide text-muted"
      >
        {t.title}
      </h2>
      {body}
    </section>
  );
}
