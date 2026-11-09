import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { getExecutiveReport } from "../../api/client.ts";
import type { ExecutiveReport } from "../../api/types.ts";
import { RequireUser } from "../../components/RequireUser.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { HelpTip } from "../../components/HelpTip.tsx";
import { STR } from "../../lib/strings.ts";
import { errorText, formatDateTime } from "../../i18n/index.ts";

const PERIODS = [7, 30, 90, 365];

/** "+3" / "−2" / "0" against the previous period. */
function delta(now: number, before: number): string {
  const d = now - before;
  return d > 0 ? `+${d}` : d < 0 ? `−${-d}` : "0";
}

function Totals({ r }: { r: ExecutiveReport }) {
  const S = STR.adm.report;
  const cells: Array<[string, string]> = [
    [S.sessions, `${r.totals.sessions} (${delta(r.totals.sessions, r.totals.previous_sessions)})`],
    [S.users, String(r.totals.users)],
    [S.activeArtifacts, String(r.totals.active_artifacts)],
  ];
  return (
    <dl data-testid="report-totals" className="grid gap-3 sm:grid-cols-3">
      {cells.map(([k, v]) => (
        <div key={k} className="rounded-sf border border-line bg-surface p-3">
          <dt className="text-xs uppercase tracking-wide text-muted">{k}</dt>
          <dd className="text-lg font-semibold">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Trend({ r }: { r: ExecutiveReport }) {
  const max = Math.max(1, ...r.trend.map((w) => w.sessions));
  return (
    <section data-testid="report-trend" className="space-y-1">
      <h2 className="text-sm font-semibold text-ink">{STR.adm.report.trend}</h2>
      <ul className="space-y-1 text-xs">
        {r.trend.map((w) => (
          <li key={w.start} className="flex items-center gap-2">
            <span className="w-40 shrink-0 text-muted">{formatDateTime(w.start)}</span>
            <span
              className="h-2 rounded-sf bg-accent"
              style={{ width: `${(w.sessions / max) * 60}%` }}
            />
            <span className="font-mono">{w.sessions}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Teams({ r }: { r: ExecutiveReport }) {
  const S = STR.adm.report;
  return (
    <section className="space-y-1">
      <h2 className="text-sm font-semibold text-ink">{S.teams}</h2>
      <p className="text-xs text-ink-2">{S.teamsNote}</p>
      <table data-testid="report-teams" className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="py-1 pr-3">{S.colTeam}</th>
            <th className="py-1 pr-3">{S.sessions}</th>
            <th className="py-1 pr-3">{S.users}</th>
            <th className="py-1">{S.colTokens}</th>
          </tr>
        </thead>
        <tbody>
          {r.teams.map((t) => (
            <tr key={t.team ?? ""} data-testid="report-team" className="border-t border-line">
              <td translate="no" className="py-1 pr-3">
                {t.team ?? S.noTeam}
              </td>
              <td className="py-1 pr-3">
                {t.sessions} ({delta(t.sessions, t.previous_sessions)})
              </td>
              <td className="py-1 pr-3">{t.users}</td>
              <td className="py-1 font-mono text-xs">{t.est_context_tokens}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Artifacts({ r }: { r: ExecutiveReport }) {
  const S = STR.adm.report;
  return (
    <section className="space-y-1">
      <h2 className="text-sm font-semibold text-ink">{S.artifacts}</h2>
      {r.artifacts.length === 0 ? (
        <p className="text-sm text-ink-2">{S.noUsage}</p>
      ) : (
        <table data-testid="report-artifacts" className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="py-1 pr-3">{S.colArtifact}</th>
              <th className="py-1 pr-3">{S.sessions}</th>
              <th className="py-1">{S.colTokens}</th>
            </tr>
          </thead>
          <tbody>
            {r.artifacts.map((a) => (
              <tr key={`${a.type}/${a.name}`} className="border-t border-line">
                <td className="py-1 pr-3">
                  <Link
                    translate="no"
                    to={`/artifacts/${a.type}/${a.name}`}
                    className="font-mono text-xs text-accent"
                  >
                    {a.type}/{a.name}
                  </Link>
                </td>
                <td className="py-1 pr-3">
                  {a.sessions} ({delta(a.sessions, a.previous_sessions)})
                </td>
                <td className="py-1 font-mono text-xs">{a.est_context_tokens}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Unused({ r }: { r: ExecutiveReport }) {
  const S = STR.adm.report;
  return (
    <section data-testid="report-unused" className="space-y-1">
      <h2 className="text-sm font-semibold text-ink">{S.unused}</h2>
      {r.unused.length === 0 ? (
        <p className="text-sm text-ink-2">{S.noUnused}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {r.unused.map((a) => (
            <li key={`${a.type}/${a.name}`}>
              <Link
                translate="no"
                to={`/artifacts/${a.type}/${a.name}`}
                className="font-mono text-xs text-accent"
              >
                {a.type}/{a.name}
              </Link>{" "}
              <span className="text-xs text-muted">
                {a.status}
                {a.recent ? ` · ${S.recent}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReportPage() {
  const [days, setDays] = useState(30);
  useEffect(() => {
    document.title = STR.adm.report.docTitle;
  }, []);
  const q = useQuery({
    queryKey: ["executive-report", days],
    queryFn: () => getExecutiveReport(days),
  });
  const S = STR.adm.report;
  return (
    <div className="space-y-6">
      <PageHeader title={S.title} topic="pages/admin-report" />
      <p className="text-sm text-ink-2">{S.description}</p>
      <label className="flex items-center gap-2 text-sm text-muted">
        {S.period}
        <HelpTip action="report-days">
          <select
            data-testid="report-days"
            className="rounded-sf border border-line bg-bg px-2 py-1 text-sm text-ink"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {PERIODS.map((d) => (
              <option key={d} value={d}>
                {S.days(d)}
              </option>
            ))}
          </select>
        </HelpTip>
      </label>
      {q.error ? <p className="text-sm text-danger">{errorText(q.error)}</p> : null}
      {q.data ? (
        <>
          <Totals r={q.data} />
          <Trend r={q.data} />
          <Teams r={q.data} />
          <Artifacts r={q.data} />
          <Unused r={q.data} />
        </>
      ) : null}
    </div>
  );
}

export function AdminReport() {
  return <RequireUser requireAdmin>{() => <ReportPage />}</RequireUser>;
}
