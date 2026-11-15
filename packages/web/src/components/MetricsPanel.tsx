import { useQuery } from "@tanstack/react-query";
import { getArtifactMetrics } from "../api/client.ts";
import type { ArtifactMetrics, ArtifactRuntimeMetrics } from "../api/types.ts";
import { Skeleton } from "./Skeleton.tsx";
import { ErrorState } from "./ErrorState.tsx";
import { RelativeTime } from "./RelativeTime.tsx";
import { STR } from "../lib/strings.ts";

type Props = { type: string; name: string };

function formatVpr(m: ArtifactMetrics): string {
  const { pass, fail, pass_rate } = m.verification;
  if (pass + fail === 0 || pass_rate == null) return "\u2014";
  return `${Math.round(pass_rate * 1000) / 10}%`;
}

function fmtMetric(v: number | null | undefined, digits = 3): string {
  if (v === null || v === undefined) return "\u2014";
  if (!Number.isFinite(v)) return "\u2014";
  return String(Number(v.toFixed(digits)));
}

function rowPassRate(row: ArtifactRuntimeMetrics): string {
  if (row.verification === null) return STR.art.metrics.hiddenOneUser;
  const { pass, fail, pass_rate } = row.verification;
  if (pass + fail === 0 || pass_rate == null) return "—";
  return `${Math.round(pass_rate * 1000) / 10}%`;
}

type SplitRow = ArtifactRuntimeMetrics & { model?: string | null };

/**
 * metrics-by-runtime and session-fact-model: the session facts by the agent they came from ("other sources" last), and
 * by agent and model ("other or not reported" last in each agent). One table frame for both.
 */
function UsageSplit({
  id,
  title,
  rows,
  withModel,
}: {
  id: "metrics-by-runtime" | "metrics-by-model";
  title: string;
  rows: SplitRow[];
  withModel: boolean;
}) {
  if (rows.length === 0) return null;
  const t = STR.art.metrics;
  const cell = "py-1 pr-3";
  const head = `${cell} font-medium`;
  return (
    <div data-testid={id} className="mt-5">
      <h3
        id={`${id}-title`}
        className="mb-2 text-sm font-medium uppercase tracking-wide text-muted"
      >
        {title}
      </h3>
      {/* A narrow screen scrolls the table here; tabIndex lets the keyboard scroll it too (WCAG 2.1.1). */}
      <div className="overflow-x-auto" role="region" aria-labelledby={`${id}-title`} tabIndex={0}>
        <table aria-labelledby={`${id}-title`} className="w-full text-left text-xs">
          <thead className="text-muted">
            <tr>
              <th scope="col" className={head}>
                {t.byRuntimeCols.agent}
              </th>
              {withModel && (
                <th scope="col" className={head}>
                  {t.byModelCols.model}
                </th>
              )}
              <th scope="col" className={head}>
                {t.byRuntimeCols.sessions}
              </th>
              <th scope="col" className={head}>
                {t.byRuntimeCols.users}
              </th>
              <th scope="col" className={head}>
                {t.byRuntimeCols.passRate}
              </th>
              <th scope="col" className={head}>
                {t.byRuntimeCols.lastUsed}
              </th>
            </tr>
          </thead>
          <tbody className="text-ink">
            {rows.map((r) => (
              <tr
                key={`${r.runtime ?? ""}|${r.model ?? ""}`}
                data-runtime={r.runtime ?? ""}
                data-model={withModel ? (r.model ?? "") : undefined}
                className="border-t border-line"
              >
                <th scope="row" className={`${cell} font-normal`}>
                  {r.label ?? t.otherSources}
                </th>
                {withModel && (
                  <td
                    className={r.model ? `${cell} font-mono` : `${cell} text-muted`}
                    translate="no"
                  >
                    {r.model ?? t.otherModel}
                  </td>
                )}
                <td className={`${cell} font-mono`}>{r.sessions_count}</td>
                <td className={`${cell} font-mono`}>{r.users_count}</td>
                <td
                  className={r.verification === null ? `${cell} text-muted` : `${cell} font-mono`}
                >
                  {rowPassRate(r)}
                </td>
                <td className={cell}>
                  {r.last_used_at ? <RelativeTime iso={r.last_used_at} /> : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function MetricsPanel({ type, name }: Props) {
  const q = useQuery({
    queryKey: ["artifact-metrics", type, name],
    queryFn: () => getArtifactMetrics(type, name),
    staleTime: 15_000,
  });

  if (q.isLoading) {
    return (
      <section data-testid="metrics-panel" className="rounded-sf border border-line bg-surface p-4">
        <Skeleton className="h-20" />
      </section>
    );
  }
  if (q.isError || !q.data) {
    return (
      <section data-testid="metrics-panel" className="rounded-sf border border-line bg-surface p-4">
        <ErrorState onRetry={() => void q.refetch()} />
      </section>
    );
  }
  const m = q.data;
  const t = STR.art.metrics;
  return (
    <section
      data-testid="metrics-panel"
      className="rounded-sf border border-line bg-surface p-4 text-sm"
    >
      <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">
        {t.sessionUsage}
      </h3>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase text-muted">{t.sessions}</dt>
          <dd data-testid="metrics-sessions" className="mt-1 font-mono text-ink">
            {m.sessions_count}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-muted">{t.preloadedSessions}</dt>
          <dd data-testid="metrics-preloaded" className="mt-1 font-mono text-ink">
            {m.preloaded_sessions_count ?? 0}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-muted">{t.users}</dt>
          <dd data-testid="metrics-users" className="mt-1 font-mono text-ink">
            {m.users_count}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-muted">{t.lastUsed}</dt>
          <dd data-testid="metrics-last-used" className="mt-1 text-ink">
            {m.last_used_at ? <RelativeTime iso={m.last_used_at} /> : "\u2014"}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-muted">{t.passRate}</dt>
          <dd data-testid="metrics-vpr" className="mt-1 font-mono text-ink">
            {formatVpr(m)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-muted">{t.ageDays}</dt>
          <dd data-testid="metrics-age" className="mt-1 font-mono text-ink">
            {m.skill_age_days}
          </dd>
        </div>
      </dl>

      <UsageSplit
        id="metrics-by-runtime"
        title={t.byRuntime}
        rows={m.by_runtime ?? []}
        withModel={false}
      />
      <UsageSplit id="metrics-by-model" title={t.byModel} rows={m.by_model ?? []} withModel />

      <h3 className="mb-3 mt-5 text-sm font-medium uppercase tracking-wide text-muted">
        {t.qualitySignals}
      </h3>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase text-muted">{t.ablationScore}</dt>
          <dd data-testid="metric-ablation-score" className="mt-1 font-mono text-ink">
            {fmtMetric(m.ablation_score)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-muted">{t.skillAge}</dt>
          <dd data-testid="metric-skill-age" className="mt-1 font-mono text-ink">
            {m.skill_age_days}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-muted">{t.passRateSignal}</dt>
          <dd data-testid="metric-verification-pass-rate" className="mt-1 font-mono text-ink">
            {formatVpr(m)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-muted">
            {t.tokenEfficiency} <span className="normal-case">{t.estimate}</span>
          </dt>
          <dd data-testid="metric-token-efficiency" className="mt-1 font-mono text-ink">
            {fmtMetric(m.token_efficiency)}
          </dd>
        </div>
      </dl>
    </section>
  );
}
