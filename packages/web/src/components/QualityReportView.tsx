import { useState } from "react";
import { useHelp } from "../help/HelpProvider.tsx";
import { HelpTip } from "./HelpTip.tsx";
import { GradeChip } from "./GradeChip.tsx";
import type { QualityCheck, QualityReport } from "../api/types.ts";
import { STR } from "../lib/strings.ts";
import { codeMessage } from "../i18n/index.ts";

function formatHit(hit: { path: string; line?: number; excerpt?: string }): string {
  if (hit.line != null) return `${hit.path}:${hit.line}`;
  // Hook findings carry no line but name the handler (hooks.PreToolUse[0].hooks[0]) in the excerpt.
  return hit.excerpt ? `${hit.path} ${hit.excerpt}` : hit.path;
}

function CheckHits({ hits }: { hits: QualityCheck["hits"] }) {
  if (!hits.length) return null;
  const shown = hits.slice(0, 5);
  const more = hits.length - shown.length;
  return (
    <span className="ml-2 font-mono text-[11px] opacity-80">
      {shown.map(formatHit).join(", ")}
      {more > 0 ? STR.art.quality.moreHits(more) : ""}
    </span>
  );
}

function QualityChecks({ checks }: { checks: QualityCheck[] }) {
  const { openTopic } = useHelp();
  if (checks.length === 0) {
    return (
      <p data-testid="quality-clean" className="text-sm text-muted">
        {STR.art.quality.clean}
      </p>
    );
  }
  return (
    <ul data-testid="quality-checks" className="space-y-1">
      {checks.map((check, i) => (
        <li
          key={`${check.code}-${i}`}
          data-testid="quality-check"
          data-code={check.code}
          data-severity={check.severity}
          className={`rounded-sf px-2 py-1.5 text-sm ${
            check.severity === "warn" ? "bg-warning-bg text-warning" : "bg-surface-2 text-ink-2"
          }`}
        >
          <span className="font-mono text-[12px] font-semibold">{check.code}</span>
          <span className="ml-2">{codeMessage(check.code, check.message)}</span>
          <CheckHits hits={check.hits} />
          <HelpTip action="quality-check-help">
            <button
              type="button"
              data-testid="quality-check-help"
              className="ml-2 text-xs underline opacity-90"
              onClick={() => openTopic(`codes/${check.code}`)}
            >
              {STR.art.quality.help}
            </button>
          </HelpTip>
        </li>
      ))}
    </ul>
  );
}

function QualityMetrics({ metrics }: { metrics: QualityReport["metrics"] }) {
  const entries: Array<[string, string | number]> = [
    ["description_words", metrics.description_words],
    ["description_chars", metrics.description_chars],
    ["body_chars", metrics.body_chars],
    ["body_tokens_est", metrics.body_tokens_est],
    ["markdown_files", metrics.markdown_files],
    ["reference_depth", metrics.reference_depth],
    ["code_blocks", metrics.code_blocks],
  ];
  return (
    <dl
      data-testid="quality-metrics"
      className="grid gap-1 text-xs sm:grid-cols-[auto_1fr] text-ink-2"
    >
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-mono text-muted">{k}</dt>
          <dd className="font-mono">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const BLOCKING_CLASS: Record<string, string> = {
  block: "text-danger bg-danger-bg",
  ask: "text-st-aging bg-st-aging-bg",
  none: "text-muted bg-surface-2",
  unknown: "text-muted bg-surface-2",
};

function blockingLabel(value: string): string {
  return (STR.art.quality.blocking as Record<string, string | undefined>)[value] ?? value;
}

function HookTable({ hook }: { hook: NonNullable<QualityReport["hook"]> }) {
  const t = STR.art.quality.hook;
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const highlightRows =
    activeLabel == null ? null : (hook.risks.find((r) => r.label === activeLabel)?.rows ?? null);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-sf border border-line">
        <table data-testid="hook-table" className="w-full text-left text-sm">
          <thead className="bg-surface-2 text-muted">
            <tr>
              <th className="px-2 py-1.5 font-medium">{t.event}</th>
              <th className="px-2 py-1.5 font-medium">{t.matcher}</th>
              <th className="px-2 py-1.5 font-medium">{t.type}</th>
              <th className="px-2 py-1.5 font-medium">{t.action}</th>
              <th className="px-2 py-1.5 font-medium">{t.timeout}</th>
              <th className="px-2 py-1.5 font-medium">{t.blocking}</th>
              <th className="px-2 py-1.5 font-medium">{t.runtimes}</th>
            </tr>
          </thead>
          <tbody>
            {hook.rows.map((row, i) => {
              const hi = highlightRows != null && highlightRows.includes(i);
              return (
                <tr
                  key={`${row.event}-${i}`}
                  data-testid="hook-row"
                  data-event={row.event}
                  data-blocking={row.blocking}
                  {...(hi ? { "data-highlight": "true" } : {})}
                  className={`border-t border-line ${hi ? "bg-accent-soft" : ""}`}
                >
                  <td className="px-2 py-1.5 font-mono text-xs">{row.event}</td>
                  <td className="px-2 py-1.5 font-mono text-xs">{row.matcher ?? t.matcherAny}</td>
                  <td className="px-2 py-1.5 text-xs" translate="no">
                    {row.type}
                  </td>
                  <td
                    className="max-w-[16rem] truncate px-2 py-1.5 font-mono text-xs"
                    title={row.action}
                  >
                    {row.action}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-xs">
                    {row.timeout == null ? "-" : row.timeout}
                  </td>
                  <td className="px-2 py-1.5">
                    <span
                      data-testid="hook-blocking"
                      className={`inline-flex rounded-sf px-1.5 py-0.5 text-xs font-medium ${
                        BLOCKING_CLASS[row.blocking] ?? BLOCKING_CLASS.unknown
                      }`}
                    >
                      {blockingLabel(row.blocking)}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-xs text-muted" translate="no">
                    {row.runtimes.join(", ") || "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hook.risks.length > 0 ? (
        <div data-testid="hook-risks" className="flex flex-wrap gap-2">
          {hook.risks.map((risk) => (
            <HelpTip key={risk.label} action="hook-risk">
              <button
                type="button"
                data-testid="hook-risk"
                data-label={risk.label}
                className={`rounded-sf border px-2 py-1 text-xs font-medium ${
                  activeLabel === risk.label
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line bg-surface text-ink-2 hover:bg-surface-2"
                }`}
                onClick={() => setActiveLabel((cur) => (cur === risk.label ? null : risk.label))}
              >
                <span translate="no">{risk.label}</span>
                <span data-testid="hook-risk-count" className="ml-1 font-mono opacity-70">
                  {risk.rows.length}
                </span>
              </button>
            </HelpTip>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type Props = {
  quality: QualityReport;
  gradeTestId?: string;
  showScore?: boolean;
  showMetrics?: boolean;
  showHook?: boolean;
  showChecks?: boolean;
};

/** Shared quality grade / score / checks / metrics / hook table. */
export function QualityReportView({
  quality,
  gradeTestId = "quality-grade",
  showScore = true,
  showMetrics = true,
  showHook = true,
  showChecks = true,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <GradeChip grade={quality.grade} testId={gradeTestId} />
        {showScore ? (
          <span data-testid="quality-score" className="font-mono text-sm">
            {quality.score}
          </span>
        ) : null}
      </div>
      {showChecks ? <QualityChecks checks={quality.checks} /> : null}
      {showMetrics ? <QualityMetrics metrics={quality.metrics} /> : null}
      {showHook && quality.hook && quality.hook.rows.length > 0 ? (
        <HookTable hook={quality.hook} />
      ) : null}
    </div>
  );
}
