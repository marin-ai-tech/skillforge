import { useQuery } from "@tanstack/react-query";
import { listAudit } from "../../api/client.ts";
import { Skeleton } from "../../components/Skeleton.tsx";
import { ErrorState } from "../../components/ErrorState.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { STR } from "../../lib/strings.ts";
import { formatDateTime } from "../../i18n/index.ts";

type Props = { type: string; name: string };

export function Audit({ type, name }: Props) {
  const q = useQuery({
    queryKey: ["audit", type, name],
    queryFn: () => listAudit(type, name),
    staleTime: 30_000,
  });

  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  if (q.isLoading) return <Skeleton className="h-32" />;
  const items = q.data?.items ?? [];
  if (items.length === 0) return <EmptyState title={STR.detail.emptyAudit} />;

  return (
    <ul data-testid="audit-list" className="space-y-2">
      {items.map((e) => (
        <li
          key={e.id}
          data-testid="audit-entry"
          data-action={e.action}
          className="rounded-sf border border-line bg-surface p-3 text-sm"
        >
          <div className="flex flex-wrap gap-2">
            <span className="font-medium" translate="no">
              {e.action}
            </span>
            <span className="text-muted" translate="no">
              {e.actor}
            </span>
            {e.version ? <span className="font-mono">{e.version}</span> : null}
            {e.from_status && e.to_status ? (
              <span>
                {e.from_status} → {e.to_status}
              </span>
            ) : null}
            {e.reason ? (
              <span className="text-ink-2" translate="no">
                {e.reason}
              </span>
            ) : null}
            <span className="text-muted">{formatDateTime(e.ts)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
