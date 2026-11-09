import { useEffect } from "react";
import { Link } from "react-router";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  getBoard,
  getHealth,
  getInstallInfo,
  listArtifacts,
  listArtifactTypes,
} from "../api/client.ts";
import { ArtifactCard } from "../components/ArtifactCard.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { ErrorState } from "../components/ErrorState.tsx";
import { Skeleton } from "../components/Skeleton.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { HelpTip } from "../components/HelpTip.tsx";
import { CopyButton } from "../components/CopyButton.tsx";
import { STR } from "../lib/strings.ts";
import { roleAtLeast, useMe } from "../lib/auth.tsx";
import { FALLBACK_TYPE_IDS } from "../lib/artifact-types.ts";

type ArtifactListResult = Awaited<ReturnType<typeof listArtifacts>>;

function CountsSection({
  counts,
  typeIds,
  pluralOf,
}: {
  counts: UseQueryResult<Record<string, number>>;
  typeIds: string[];
  pluralOf: (id: string) => string;
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">
        {STR.home.counts}
      </h2>
      {counts.isError ? (
        <ErrorState onRetry={() => void counts.refetch()} />
      ) : counts.isPending ? (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sf border border-line bg-line sm:grid-cols-3 xl:grid-cols-6">
          {typeIds.map((t) => (
            <Skeleton key={t} className="h-16 rounded-none" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sf border border-line bg-line sm:grid-cols-3 xl:grid-cols-6">
          {typeIds.map((type) => (
            <HelpTip key={type} family="home-count-*">
              <Link
                to={`/artifacts?type=${type}`}
                data-testid={`home-count-${type}`}
                className="block h-full w-full bg-surface p-4 no-underline hover:bg-surface-2"
              >
                <div className="text-xs uppercase text-muted">{pluralOf(type)}</div>
                <div className="mt-1 text-2xl font-semibold text-ink">
                  {counts.data?.[type] ?? 0}
                </div>
              </Link>
            </HelpTip>
          ))}
        </div>
      )}
    </section>
  );
}

function RecentSection({
  recent,
  emptyRegistry,
}: {
  recent: UseQueryResult<ArtifactListResult>;
  emptyRegistry: boolean | undefined;
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">
        {STR.home.recent}
      </h2>
      <div data-testid="home-recent">
        {recent.isError ? (
          <ErrorState onRetry={() => void recent.refetch()} />
        ) : recent.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-36" />
            <Skeleton className="h-36" />
          </div>
        ) : emptyRegistry ? (
          <EmptyState
            hint={STR.home.emptyHint}
            linkHref="/publish"
            linkLabel={STR.home.publishLink}
          />
        ) : (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
            {recent.data!.items.map((a) => (
              <ArtifactCard key={`${a.type}/${a.name}`} artifact={a} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ReviewSection({
  review,
  emptyRegistry,
}: {
  review: UseQueryResult<ArtifactListResult>;
  emptyRegistry: boolean | undefined;
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">
        {STR.home.review}
      </h2>
      <div data-testid="home-review">
        {review.isError ? (
          <ErrorState onRetry={() => void review.refetch()} />
        ) : review.isLoading ? (
          <Skeleton className="h-36" />
        ) : emptyRegistry || review.data!.items.length === 0 ? (
          <EmptyState
            hint={STR.home.emptyHint}
            linkHref="/publish"
            linkLabel={STR.home.publishLink}
          />
        ) : (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
            {review.data!.items.map((a) => (
              <ArtifactCard key={`${a.type}/${a.name}`} artifact={a} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** release-dist: the CLI package this registry serves, installable into any agent's machine. */
function CliInstall({ url }: { url: string }) {
  const command = `npm i -g ${url}`;
  return (
    <div className="mt-3">
      <p className="mb-2 text-ink-2">{STR.home.cliHint}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code
          data-testid="home-install-cli"
          className="flex-1 rounded-sf border border-line bg-bg px-3 py-2 font-mono text-xs"
        >
          {command}
        </code>
        <CopyButton value={command} />
      </div>
    </div>
  );
}

/** The running version, from the public health endpoint; without it the page simply has no footer. */
function VersionFooter() {
  const health = useQuery({ queryKey: ["health"], queryFn: getHealth, staleTime: 60_000 });
  const version = health.data?.version;
  if (!version) return null;
  return (
    <footer
      data-testid="home-version"
      className="border-t border-line pt-4 text-center text-xs text-muted"
    >
      {`${STR.nav.brand} ${version}`}
    </footer>
  );
}

export function Home() {
  const me = useMe();
  const typeCatalog = useQuery({
    queryKey: ["artifact-types"],
    queryFn: listArtifactTypes,
    staleTime: 60_000,
  });
  const typeIds: string[] = typeCatalog.data?.items.map((t) => t.id) ?? [...FALLBACK_TYPE_IDS];
  const pluralOf = (id: string) =>
    (STR.ui.typePlural as Record<string, string | undefined>)[id] ??
    typeCatalog.data?.items.find((t) => t.id === id)?.plural ??
    id;
  useEffect(() => {
    document.title = "SkillForge";
  }, []);

  const recent = useQuery({
    queryKey: ["artifacts", { limit: 8, sort: "recent" }],
    queryFn: () => listArtifacts({ limit: 8, offset: 0 }),
    staleTime: 30_000,
  });

  const review = useQuery({
    queryKey: ["artifacts", { status: "candidate", limit: 8 }],
    queryFn: () => listArtifacts({ status: "candidate", limit: 8, offset: 0 }),
    staleTime: 30_000,
  });

  const board = useQuery({
    queryKey: ["board"],
    queryFn: getBoard,
    staleTime: 30_000,
    enabled: roleAtLeast(me.data?.role, "reviewer"),
  });

  const installInfo = useQuery({
    queryKey: ["install-info"],
    queryFn: getInstallInfo,
    staleTime: 60_000,
  });

  // The key carries the type list: counted before the type catalog loads, plugin/settings stayed 0 for good.
  // Waits for the catalog's answer, not its success: on an error the counts use the fallback list instead of
  // staying off. A query that is off is pending but not loading, so CountsSection checks isPending.
  const counts = useQuery({
    queryKey: ["artifacts", "counts", typeIds.join(",")],
    enabled: typeCatalog.isFetched,
    queryFn: async () => {
      const entries = await Promise.all(
        typeIds.map(async (type) => {
          const res = await listArtifacts({ type, limit: 1, offset: 0 });
          return [type, res.total] as const;
        }),
      );
      return Object.fromEntries(entries) as Record<string, number>;
    },
    staleTime: 30_000,
  });

  const emptyRegistry = recent.data && recent.data.total === 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title={STR.home.title}
        description={STR.home.subtitle}
        topic="pages/home"
        titleClassName="text-[28px] font-semibold tracking-tight"
      />

      {installInfo.data ? (
        <section
          data-testid="home-install"
          className="rounded-sf border border-line bg-surface p-4 text-sm"
        >
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted">
            {STR.home.installTitle}
          </h2>
          <p className="mb-3 text-ink-2">{STR.home.installHint}</p>
          <HelpTip action="home-install">
            <div className="flex flex-wrap items-center gap-2">
              <code className="flex-1 rounded-sf border border-line bg-bg px-3 py-2 font-mono text-xs">
                {`/plugin marketplace add ${installInfo.data.marketplace_url}`}
              </code>
              <CopyButton value={`/plugin marketplace add ${installInfo.data.marketplace_url}`} />
            </div>
          </HelpTip>
          {installInfo.data.cli ? <CliInstall url={installInfo.data.cli.url} /> : null}
        </section>
      ) : null}

      <CountsSection counts={counts} typeIds={typeIds} pluralOf={pluralOf} />

      <RecentSection recent={recent} emptyRegistry={emptyRegistry} />

      <ReviewSection review={review} emptyRegistry={emptyRegistry} />

      {roleAtLeast(me.data?.role, "reviewer") &&
      board.data &&
      board.data.counts.aging + board.data.counts.zombie > 0 ? (
        <section>
          <div
            data-testid="home-delete-board"
            className="rounded-sf border border-line bg-surface p-4 text-sm text-ink-2"
          >
            <HelpTip action="home-delete-board">
              <div>
                <strong>{STR.home.deleteBoard}</strong>
                <span className="ml-2">
                  {STR.ui.home.boardCounts(board.data.counts.aging, board.data.counts.zombie)}
                </span>
                <div className="mt-2">
                  <Link to="/lifecycle?tab=delete" className="text-accent underline">
                    {STR.ui.home.openDeleteBoard}
                  </Link>
                </div>
              </div>
            </HelpTip>
          </div>
        </section>
      ) : null}

      <VersionFooter />
    </div>
  );
}
