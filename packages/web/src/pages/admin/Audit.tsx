import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { journalExportUrl, listJournal } from "../../api/client.ts";
import type { JournalEvent, JournalFilters } from "../../api/types.ts";
import { RequireUser } from "../../components/RequireUser.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { HelpTip } from "../../components/HelpTip.tsx";
import { STR } from "../../lib/strings.ts";
import { errorText, formatDateTime } from "../../i18n/index.ts";

/** What the event is about: the artifact page, or the user, policy or mirror the system event names. */
function Subject({ event }: { event: JournalEvent }) {
  if (event.artifact) {
    const { type, name } = event.artifact;
    return (
      <Link
        translate="no"
        to={`/artifacts/${type}/${name}`}
        className="font-mono text-xs text-accent"
      >
        {type}/{name}
        {event.version ? `@${event.version}` : ""}
      </Link>
    );
  }
  return (
    <span translate="no" className="font-mono text-xs">
      {event.target ?? STR.adm.audit.system}
    </span>
  );
}

/** Short details: status change, reason, then the remaining metadata as compact JSON. */
function details(event: JournalEvent): string {
  const parts: string[] = [];
  if (event.from_status || event.to_status) {
    parts.push(`${event.from_status ?? "—"} → ${event.to_status ?? "—"}`);
  }
  if (event.reason) parts.push(event.reason);
  if (event.meta && Object.keys(event.meta).length > 0) parts.push(JSON.stringify(event.meta));
  return parts.join(" · ");
}

function AuditRow({ event }: { event: JournalEvent }) {
  return (
    <tr data-testid="audit-row" className="border-t border-line align-top">
      <td className="whitespace-nowrap py-1 pr-3 text-xs text-muted">{formatDateTime(event.ts)}</td>
      <td translate="no" className="py-1 pr-3">
        {event.actor}
      </td>
      <td translate="no" className="py-1 pr-3 font-mono text-xs">
        {event.action}
      </td>
      <td className="py-1 pr-3">
        <Subject event={event} />
      </td>
      <td className="break-all py-1 text-xs text-ink-2">{details(event)}</td>
    </tr>
  );
}

function Filters({
  value,
  onChange,
}: {
  value: JournalFilters;
  onChange: (f: JournalFilters) => void;
}) {
  const field = (key: keyof JournalFilters, label: string) => (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      <input
        data-testid={`audit-${key}`}
        className="rounded-sf border border-line bg-bg px-2 py-1 text-sm text-ink"
        value={value[key] ?? ""}
        onChange={(e) => onChange({ ...value, [key]: e.target.value })}
      />
    </label>
  );
  return (
    <div className="flex flex-wrap items-end gap-3">
      {field("action", STR.adm.audit.filterAction)}
      {field("actor", STR.adm.audit.filterActor)}
      <HelpTip action="audit-export">
        <a
          data-testid="audit-export"
          href={journalExportUrl(value)}
          download
          className="rounded-sf border border-line px-3 py-1 text-sm text-ink-2 no-underline hover:bg-surface-2"
        >
          {STR.adm.audit.export}
        </a>
      </HelpTip>
    </div>
  );
}

function AuditPage() {
  const [filters, setFilters] = useState<JournalFilters>({});
  useEffect(() => {
    document.title = STR.adm.audit.docTitle;
  }, []);
  const q = useInfiniteQuery({
    queryKey: ["audit", filters],
    queryFn: ({ pageParam }) => listJournal(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="space-y-4">
      <PageHeader title={STR.adm.audit.title} topic="pages/admin-audit" />
      <p className="text-sm text-ink-2">{STR.adm.audit.description}</p>
      <Filters value={filters} onChange={setFilters} />
      {q.error ? <p className="text-sm text-danger">{errorText(q.error)}</p> : null}
      {items.length === 0 && !q.isLoading ? (
        <p data-testid="audit-empty" className="text-sm text-ink-2">
          {STR.adm.audit.empty}
        </p>
      ) : (
        <table data-testid="audit-table" className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="py-1 pr-3">{STR.adm.audit.colTime}</th>
              <th className="py-1 pr-3">{STR.adm.audit.colActor}</th>
              <th className="py-1 pr-3">{STR.adm.audit.colAction}</th>
              <th className="py-1 pr-3">{STR.adm.audit.colSubject}</th>
              <th className="py-1">{STR.adm.audit.colDetails}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <AuditRow key={e.cursor} event={e} />
            ))}
          </tbody>
        </table>
      )}
      {q.hasNextPage ? (
        <HelpTip action="audit-more">
          <button
            type="button"
            data-testid="audit-more"
            disabled={q.isFetchingNextPage}
            onClick={() => void q.fetchNextPage()}
            className="rounded-sf border border-line px-3 py-1 text-sm text-ink-2 hover:bg-surface-2"
          >
            {STR.adm.audit.more}
          </button>
        </HelpTip>
      ) : null}
    </div>
  );
}

export function AdminAudit() {
  return <RequireUser requireAdmin>{() => <AuditPage />}</RequireUser>;
}
