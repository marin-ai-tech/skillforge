import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBoard, transitionArtifact } from "../api/client.ts";
import type { ArtifactSummary, CleanupItem } from "../api/types.ts";
import { ArtifactCard } from "../components/ArtifactCard.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { ErrorState } from "../components/ErrorState.tsx";
import { HelpTip } from "../components/HelpTip.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { RequireUser } from "../components/RequireUser.tsx";
import { Skeleton } from "../components/Skeleton.tsx";
import { StatusChip } from "../components/StatusChip.tsx";
import { Tabs } from "../components/Tabs.tsx";
import { TransitionDialog } from "../components/TransitionDialog.tsx";
import { roleAtLeast, useMe } from "../lib/auth.tsx";
import { STR } from "../lib/strings.ts";
import { errorText } from "../i18n/index.ts";

type Pending = {
  artifact: { type: string; name: string; status: string };
  to: string;
  label: string;
  initialReason?: string;
};

function formatMetrics(metrics: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(metrics ?? {})) {
    if (v == null) continue;
    if (typeof v === "number") {
      parts.push(`${k}=${Number.isInteger(v) ? v : Math.round(v * 1000) / 1000}`);
    } else if (typeof v === "string" || typeof v === "boolean") {
      parts.push(`${k}=${String(v)}`);
    }
  }
  return parts.join(", ");
}

function reasonPrefill(item: CleanupItem): string {
  return item.reasons
    .map((r) => {
      const m = formatMetrics(r.metrics);
      return m ? `${r.code}: ${r.text} (${m})` : `${r.code}: ${r.text}`;
    })
    .join("; ");
}

/** Interface label of a suggested cleanup action; an unknown action is shown as is. */
function suggestedActionLabel(action: string): string {
  return (
    (STR.ws.lifecycle.suggestedActions as Record<string, string | undefined>)[action] ?? action
  );
}

function CleanupSection({
  items,
  onRetire,
}: {
  items: CleanupItem[];
  onRetire: (item: CleanupItem) => void;
}) {
  return (
    <section data-testid="lifecycle-cleanup" className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
        {STR.lifecycle.cleanupTitle}
      </h2>
      {items.length === 0 ? (
        <EmptyState title={STR.lifecycle.cleanupEmpty} />
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={`${item.type}/${item.name}`}
              data-testid="cleanup-row"
              className="rounded-sf border border-line bg-surface p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to={`/artifacts/${item.type}/${item.name}`}
                  className="font-mono font-medium text-accent no-underline hover:underline"
                >
                  {item.type}/{item.name}
                </Link>
                <StatusChip status={item.status} />
                <span className="text-xs text-muted">
                  {STR.ws.lifecycle.suggest} {suggestedActionLabel(item.suggested_action)}
                </span>
                <HelpTip action="cleanup-retire">
                  <button
                    type="button"
                    data-testid={`cleanup-retire-${item.name}`}
                    className="ml-auto rounded-sf border border-line px-2 py-1 text-xs hover:border-accent"
                    onClick={() => onRetire(item)}
                  >
                    {STR.ws.lifecycle.retireEllipsis}
                  </button>
                </HelpTip>
              </div>
              <ul className="mt-2 space-y-1">
                {item.reasons.map((r) => {
                  const metrics = formatMetrics(r.metrics);
                  return (
                    <li
                      key={r.code}
                      data-testid={`cleanup-reason-${r.code}`}
                      className="text-xs text-ink-2"
                    >
                      <span className="font-mono font-medium">{r.code}</span>
                      {": "}
                      <span translate="no">
                        {r.text}
                        {metrics ? ` · ${metrics}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type BoardData = Awaited<ReturnType<typeof getBoard>>;
type OpenTransition = (artifact: ArtifactSummary, to: string, label: string) => void;

function ReviewQueueSection({
  data,
  openTransition,
}: {
  data: BoardData;
  openTransition: OpenTransition;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
        {STR.lifecycle.reviewQueue}
      </h2>
      {data.review.length === 0 ? (
        <EmptyState title={STR.lifecycle.empty} />
      ) : (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {data.review.map((a) => (
            <ArtifactCard key={`${a.type}/${a.name}`} artifact={a}>
              <HelpTip action="queue-promote">
                <button
                  type="button"
                  data-testid="queue-promote"
                  className="rounded-sf border border-line px-2 py-1 text-xs hover:border-accent"
                  onClick={() => openTransition(a, "active", STR.ws.lifecycle.promote)}
                >
                  {STR.ws.lifecycle.promote}
                </button>
              </HelpTip>
              <HelpTip action="queue-reject">
                <button
                  type="button"
                  data-testid="queue-reject"
                  className="rounded-sf border border-line px-2 py-1 text-xs hover:border-accent"
                  onClick={() => openTransition(a, "retired", STR.ws.lifecycle.reject)}
                >
                  {STR.ws.lifecycle.reject}
                </button>
              </HelpTip>
            </ArtifactCard>
          ))}
        </div>
      )}
    </section>
  );
}

function DeleteBoardSection({
  data,
  openTransition,
}: {
  data: BoardData;
  openTransition: OpenTransition;
}) {
  return (
    <div className="space-y-6">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
        {STR.lifecycle.deleteBoard}
      </h2>
      <section data-testid="board-aging" className="space-y-3">
        <h3 className="text-sm font-semibold text-ink">{STR.ws.lifecycle.aging}</h3>
        {data.aging.length === 0 ? (
          <EmptyState title={STR.lifecycle.empty} />
        ) : (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
            {data.aging.map((a) => (
              <ArtifactCard key={`${a.type}/${a.name}`} artifact={a}>
                <HelpTip action="board-revalidate">
                  <button
                    type="button"
                    data-testid="board-revalidate"
                    className="rounded-sf border border-line px-2 py-1 text-xs hover:border-accent"
                    onClick={() => openTransition(a, "active", STR.ws.lifecycle.revalidate)}
                  >
                    {STR.ws.lifecycle.revalidate}
                  </button>
                </HelpTip>
                <HelpTip action="board-retire">
                  <button
                    type="button"
                    data-testid="board-retire"
                    className="rounded-sf border border-line px-2 py-1 text-xs hover:border-accent"
                    onClick={() => openTransition(a, "retired", STR.ws.lifecycle.retire)}
                  >
                    {STR.ws.lifecycle.retire}
                  </button>
                </HelpTip>
              </ArtifactCard>
            ))}
          </div>
        )}
      </section>
      <section data-testid="board-zombie" className="space-y-3">
        <h3 className="text-sm font-semibold text-ink">{STR.ws.lifecycle.zombie}</h3>
        {data.zombie.length === 0 ? (
          <EmptyState title={STR.lifecycle.empty} />
        ) : (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
            {data.zombie.map((a) => (
              <ArtifactCard key={`${a.type}/${a.name}`} artifact={a}>
                <HelpTip action="board-revalidate">
                  <button
                    type="button"
                    data-testid="board-revalidate"
                    className="rounded-sf border border-line px-2 py-1 text-xs hover:border-accent"
                    onClick={() => openTransition(a, "active", STR.ws.lifecycle.revalidate)}
                  >
                    {STR.ws.lifecycle.revalidate}
                  </button>
                </HelpTip>
                <HelpTip action="board-retire">
                  <button
                    type="button"
                    data-testid="board-retire"
                    className="rounded-sf border border-line px-2 py-1 text-xs hover:border-accent"
                    onClick={() => openTransition(a, "retired", STR.ws.lifecycle.retire)}
                  >
                    {STR.ws.lifecycle.retire}
                  </button>
                </HelpTip>
              </ArtifactCard>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function RetiredSection({
  data,
  openTransition,
}: {
  data: BoardData;
  openTransition: OpenTransition;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
        {STR.lifecycle.retiredRecent}
      </h2>
      {data.retired_recent.length === 0 ? (
        <EmptyState title={STR.lifecycle.empty} />
      ) : (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {data.retired_recent.map((a) => (
            <ArtifactCard key={`${a.type}/${a.name}`} artifact={a}>
              <HelpTip action="board-restore">
                <button
                  type="button"
                  data-testid="board-restore"
                  className="rounded-sf border border-line px-2 py-1 text-xs hover:border-accent"
                  onClick={() => openTransition(a, "candidate", STR.ws.lifecycle.restore)}
                >
                  {STR.ws.lifecycle.restore}
                </button>
              </HelpTip>
            </ArtifactCard>
          ))}
        </div>
      )}
    </section>
  );
}

function readTab(params: URLSearchParams): string {
  const tabParam = params.get("tab") ?? "review";
  return ["review", "delete", "retired"].includes(tabParam) ? tabParam : "review";
}

/** TransitionDialog props derived from the pending transition (closed when there is none). */
function pendingDialogProps(pending: Pending | null) {
  return {
    open: !!pending,
    to: pending?.to ?? "",
    from: pending?.artifact.status,
    title: pending?.label,
    confirmLabel: pending?.label ?? STR.ws.lifecycle.confirm,
    initialReason: pending?.initialReason ?? "",
  };
}

function LifecycleBody() {
  const me = useMe();
  const user = me.data;
  const [params, setParams] = useSearchParams();
  const tab = readTab(params);
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = STR.ws.lifecycle.docTitle;
  }, []);

  const board = useQuery({
    queryKey: ["board"],
    queryFn: getBoard,
    staleTime: 15_000,
  });

  const mut = useMutation({
    mutationFn: (input: { type: string; name: string; to: string; reason: string }) =>
      transitionArtifact(input.type, input.name, {
        to: input.to,
        reason: input.reason || undefined,
      }),
    onSuccess: async () => {
      setPending(null);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["board"] });
      await queryClient.invalidateQueries({ queryKey: ["artifact"] });
      await queryClient.invalidateQueries({ queryKey: ["artifacts"] });
      await queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
    onError: (err: unknown) => setError(errorText(err)),
  });

  if (!user || !roleAtLeast(user.role, "reviewer")) {
    return (
      <div
        data-testid="lifecycle-forbidden"
        className="rounded-sf border border-line bg-surface px-4 py-6 text-sm text-ink-2"
      >
        {STR.lifecycle.forbidden}
      </div>
    );
  }

  function setTab(id: string) {
    const sp = new URLSearchParams(params);
    sp.set("tab", id);
    setParams(sp);
  }

  function openTransition(artifact: ArtifactSummary, to: string, label: string) {
    setError(null);
    setPending({ artifact, to, label });
  }

  function openCleanupRetire(item: CleanupItem) {
    setError(null);
    setPending({
      artifact: { type: item.type, name: item.name, status: item.status },
      to: "retired",
      label: STR.ws.lifecycle.retire,
      initialReason: reasonPrefill(item),
    });
  }

  const data = board.data;
  const cleanup = data?.cleanup ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={STR.lifecycle.title}
        description={STR.lifecycle.subtitle}
        topic="pages/lifecycle"
      />

      {!board.isLoading && data ? (
        <CleanupSection items={cleanup} onRetire={openCleanupRetire} />
      ) : null}

      <Tabs
        tabs={[
          { id: "review", label: STR.lifecycle.tabReview, testId: "tab-review" },
          { id: "delete", label: STR.lifecycle.tabDelete, testId: "tab-delete" },
          { id: "retired", label: STR.lifecycle.tabRetired, testId: "tab-retired" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {board.isError ? (
        <ErrorState onRetry={() => void board.refetch()} />
      ) : board.isLoading || !data ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          {tab === "review" ? (
            <ReviewQueueSection data={data} openTransition={openTransition} />
          ) : null}

          {tab === "delete" ? (
            <DeleteBoardSection data={data} openTransition={openTransition} />
          ) : null}

          {tab === "retired" ? (
            <RetiredSection data={data} openTransition={openTransition} />
          ) : null}
        </>
      )}

      <TransitionDialog
        {...pendingDialogProps(pending)}
        error={error}
        busy={mut.isPending}
        onCancel={() => {
          setPending(null);
          setError(null);
        }}
        onConfirm={(reason) => {
          if (!pending) return;
          mut.mutate({
            type: pending.artifact.type,
            name: pending.artifact.name,
            to: pending.to,
            reason,
          });
        }}
      />
    </div>
  );
}

export function Lifecycle() {
  return <RequireUser>{() => <LifecycleBody />}</RequireUser>;
}
