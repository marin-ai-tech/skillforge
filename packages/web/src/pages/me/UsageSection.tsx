import { Link } from "react-router";
import type { MeOverview, MeUsageItem } from "../../api/types.ts";
import { RelativeTime } from "../../components/RelativeTime.tsx";
import { STR } from "../../lib/strings.ts";

const code = "rounded-sf bg-surface-2 px-1 py-0.5 font-mono text-xs";

function bases(i: MeUsageItem): string {
  const S = STR.ws.overview;
  const parts: string[] = [];
  if (i.basis.loaded) parts.push(S.usageLoaded(i.basis.loaded));
  if (i.basis.assigned) parts.push(S.usageAssigned(i.basis.assigned));
  if (i.basis.unspecified) parts.push(S.usageUnspecified(i.basis.unspecified));
  return parts.length ? `${S.usageBasis} ${parts.join(" · ")}` : "";
}

function UsageRow({ item }: { item: MeUsageItem }) {
  const S = STR.ws.overview;
  return (
    <li
      data-testid="me-usage-row"
      data-name={`${item.type}/${item.name}`}
      className="space-y-1 rounded-sf border border-line bg-surface px-3 py-2 text-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link
          to={`/artifacts/${item.type}/${item.name}`}
          className="font-medium text-ink no-underline hover:underline"
          translate="no"
        >
          {item.type}/{item.name}
        </Link>
        <span className="text-ink-2">{S.usageCounts(item.reports, item.helped, item.uses)}</span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
        <span>{bases(item)}</span>
        <span>
          {S.usageLast} <RelativeTime iso={item.last_reported_at} />
          {item.last_version ? (
            <>
              {", "}
              {S.usageVersion}{" "}
              <code translate="no" className="font-mono">
                {item.last_version}
              </code>
            </>
          ) : null}
        </span>
      </div>
    </li>
  );
}

/** «My usage reports» (my-space-usage): what the user and their agents reported to the registry. */
export function UsageSection({ usage }: { usage: MeOverview["usage_reports"] }) {
  const S = STR.ws.overview;
  return (
    <section data-testid="me-usage" className="space-y-3">
      <h2 className="text-base font-semibold text-ink">{S.usageTitle}</h2>
      <p className="text-sm text-muted">
        {S.usageIntroA} <code className={code}>record_usage</code> {S.usageIntroB}{" "}
        <code className={code}>skillforge report-usage</code>.
      </p>
      {usage.items.length === 0 ? (
        <div
          data-testid="me-usage-empty"
          className="rounded-sf border border-dashed border-line bg-surface px-4 py-6 text-sm text-muted"
        >
          {S.usageEmptyA} <code className={code}>record_usage</code>
          {S.usageEmptyB}{" "}
          <code className={code}>
            {"skillforge report-usage <type>/<name> --uses N --helped M"}
          </code>
          .
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {usage.items.map((i) => (
              <UsageRow key={`${i.type}/${i.name}`} item={i} />
            ))}
          </ul>
          {usage.more ? (
            <p className="text-xs text-muted">{S.usageMore(usage.items.length)}</p>
          ) : null}
        </>
      )}
    </section>
  );
}

/** Tokens but no agent snapshot and no session facts: how to send them (my-space-usage). */
export function SetupHint({ data }: { data: MeOverview }) {
  const S = STR.ws.overview;
  if (!(data.tokens.active > 0 && data.agents.total === 0 && (data.sessions?.facts ?? 0) === 0))
    return null;
  return (
    <section
      data-testid="me-setup-hint"
      aria-labelledby="me-setup-hint-title"
      className="rounded-sf border border-line bg-surface-2 px-4 py-3 text-sm text-ink-2"
    >
      <h2 id="me-setup-hint-title" className="mb-1 text-sm font-semibold text-ink">
        {S.setupTitle}
      </h2>
      {S.setupA} <code className={code}>skillforge agent scan</code>
      {S.setupB} <code className={code}>skillforge sessions import</code>.
    </section>
  );
}
