import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getArtifactFacets, listArtifacts, listArtifactTypes } from "../api/client.ts";
import { ArtifactCard } from "../components/ArtifactCard.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { ErrorState } from "../components/ErrorState.tsx";
import { Skeleton } from "../components/Skeleton.tsx";
import { STR } from "../lib/strings.ts";
import { PageHeader } from "../components/PageHeader.tsx";
import { HelpTip } from "../components/HelpTip.tsx";
import { StickyBar } from "../components/StickyBar.tsx";
import { useRuntimeLabels } from "../lib/runtimes.ts";
import { FALLBACK_TYPE_IDS } from "../lib/artifact-types.ts";

const PAGE_SIZE = 24;
const STATUSES = ["", "candidate", "active", "aging", "zombie", "retired"] as const;

type BrowseFilters = {
  type: string;
  q: string;
  tag: string;
  status: string;
  team: string;
  owner: string;
  label: string;
  agent: string;
};

function readBrowseFilters(params: URLSearchParams): BrowseFilters {
  return {
    type: params.get("type") ?? "",
    q: params.get("q") ?? "",
    tag: params.get("tag") ?? "",
    status: params.get("status") ?? "",
    team: params.get("team") ?? "",
    owner: params.get("owner") ?? "",
    label: params.get("label") ?? "",
    agent: params.get("agent") ?? "",
  };
}

/**
 * The filters of the page except the type, for the list and for the tab counts alike, so a
 * filter that narrows the list narrows the counts too.
 */
function filterParams(f: BrowseFilters): Partial<Omit<BrowseFilters, "type">> {
  const { type: _type, ...rest } = f;
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== ""));
}

/** No filter at all: the empty catalog then links to Publish. */
function isUnfiltered(f: BrowseFilters): boolean {
  return Object.values(f).every((v) => !v);
}

type ArtifactFacets = Awaited<ReturnType<typeof getArtifactFacets>>;

/** Team / owner / label facet selects. */
function FacetFilters({
  facets,
  team,
  owner,
  label,
  setFilter,
}: {
  facets: ArtifactFacets | undefined;
  team: string;
  owner: string;
  label: string;
  setFilter: (patch: Record<string, string | null>) => void;
}) {
  return (
    <>
      <label className="flex items-center gap-2 text-sm text-muted">
        {STR.ui.browse.team}
        <select
          data-testid="filter-team"
          value={team}
          onChange={(e) => setFilter({ team: e.target.value || null })}
          className="rounded-sf border border-line bg-surface px-2 py-1.5 font-mono text-sm text-ink"
        >
          <option value="">{STR.ui.browse.allTeams}</option>
          {(facets?.teams ?? []).map((f) => (
            <option key={f.value} value={f.value}>
              {f.value} ({f.count})
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-muted">
        {STR.ui.browse.owner}
        <select
          data-testid="filter-owner"
          value={owner}
          onChange={(e) => setFilter({ owner: e.target.value || null })}
          className="rounded-sf border border-line bg-surface px-2 py-1.5 font-mono text-sm text-ink"
        >
          <option value="">{STR.ui.browse.allOwners}</option>
          {(facets?.owners ?? []).map((f) => (
            <option key={f.value} value={f.value}>
              {f.value} ({f.count})
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-muted">
        {STR.ui.browse.label}
        <select
          data-testid="filter-label"
          value={label}
          onChange={(e) => setFilter({ label: e.target.value || null })}
          className="rounded-sf border border-line bg-surface px-2 py-1.5 font-mono text-sm text-ink"
        >
          <option value="">{STR.ui.browse.allLabels}</option>
          {(facets?.labels ?? []).map((f) => (
            <option key={f.value} value={f.value}>
              {f.value} ({f.count})
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

/** "Agent" filter (artifact-agent-compat): agents from the server runtime table. */
function AgentFilter({
  agent,
  setFilter,
}: {
  agent: string;
  setFilter: (patch: Record<string, string | null>) => void;
}) {
  const { ids, label } = useRuntimeLabels();
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      {STR.ui.browse.agent}
      <select
        data-testid="filter-agent"
        value={agent}
        onChange={(e) => setFilter({ agent: e.target.value || null })}
        className="rounded-sf border border-line bg-surface px-2 py-1.5 text-sm text-ink"
      >
        <option value="">{STR.ui.browse.allAgents}</option>
        {(ids.length ? ids : agent ? [agent] : []).map((id) => (
          <option key={id} value={id} translate="no">
            {label(id)}
          </option>
        ))}
      </select>
    </label>
  );
}

function BrowseResults({
  list,
  total,
  unfiltered,
}: {
  list: UseQueryResult<Awaited<ReturnType<typeof listArtifacts>>>;
  total: number;
  unfiltered: boolean;
}) {
  return list.isError ? (
    <ErrorState onRetry={() => void list.refetch()} />
  ) : list.isLoading ? (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
      <Skeleton className="h-36" />
      <Skeleton className="h-36" />
      <Skeleton className="h-36" />
    </div>
  ) : total === 0 ? (
    unfiltered ? (
      <EmptyState title={STR.browse.empty} linkHref="/publish" linkLabel={STR.home.publishLink} />
    ) : (
      <EmptyState title={STR.browse.empty} />
    )
  ) : (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
      {list.data!.items.map((a) => (
        <ArtifactCard key={`${a.type}/${a.name}`} artifact={a} />
      ))}
    </div>
  );
}

export function Browse() {
  const [params, setParams] = useSearchParams();
  const filters = readBrowseFilters(params);
  const { type, q, tag, status, team, owner, label, agent } = filters;
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);

  const [searchInput, setSearchInput] = useState(q);

  useEffect(() => {
    setSearchInput(q);
  }, [q]);

  useEffect(() => {
    document.title = STR.browse.title + STR.ui.titleSuffix;
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const next = searchInput;
      if (next === q) return;
      const sp = new URLSearchParams(params);
      if (next) sp.set("q", next);
      else sp.delete("q");
      sp.delete("page");
      setParams(sp, { replace: true });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [searchInput, q, params, setParams]);

  const offset = (page - 1) * PAGE_SIZE;

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

  const facetsQ = useQuery({
    queryKey: ["artifacts", "facets"],
    queryFn: getArtifactFacets,
    staleTime: 30_000,
  });

  const shared = filterParams(filters);
  const list = useQuery({
    queryKey: ["artifacts", { ...shared, type, page }],
    queryFn: () =>
      listArtifacts({
        ...shared,
        ...(type ? { type } : {}),
        limit: PAGE_SIZE,
        offset,
      }),
    staleTime: 30_000,
  });

  const tabCounts = useQuery({
    queryKey: ["artifacts", "tab-counts", { ...shared, typeIds: typeIds.join(",") }],
    queryFn: async () => {
      const base = {
        ...shared,
        limit: 1,
        offset: 0,
      };
      const all = await listArtifacts(base);
      const entries = await Promise.all(
        typeIds.map(async (t) => {
          const r = await listArtifacts({ ...base, type: t });
          return [t, r.total] as const;
        }),
      );
      return { all: all.total, ...Object.fromEntries(entries) } as Record<string, number>;
    },
    staleTime: 30_000,
    enabled: typeIds.length > 0,
  });

  function setFilter(patch: Record<string, string | null>) {
    const sp = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") sp.delete(k);
      else sp.set(k, v);
    }
    if (!("page" in patch)) sp.delete("page");
    setParams(sp);
  }

  const total = list.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <StickyBar>
        <PageHeader title={STR.browse.title} topic="pages/catalog" />

        <div role="tablist" className="flex flex-wrap gap-1 border-b border-line">
          {["all", ...typeIds].map((t) => {
            const id = t === "all" ? "" : t;
            const selected = (type || "") === id;
            const count = t === "all" ? tabCounts.data?.all : tabCounts.data?.[t];
            const label = t === "all" ? STR.browse.tabs.all : pluralOf(t);
            return (
              <HelpTip key={t} family="browse-tab-*">
                <button
                  type="button"
                  role="tab"
                  data-testid={`browse-tab-${t}`}
                  aria-selected={selected}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm ${selected ? "border-accent font-medium text-ink" : "border-transparent text-muted"}`}
                  onClick={() => setFilter({ type: id || null })}
                >
                  {label}
                  {count !== undefined ? ` ${count}` : ""}
                </button>
              </HelpTip>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <HelpTip action="browse-search">
            <input
              data-testid="browse-search"
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={STR.browse.search}
              className="min-w-[200px] flex-1 rounded-sf border border-line bg-surface px-3 py-1.5 text-sm"
            />
          </HelpTip>
          <label className="flex items-center gap-2 text-sm text-muted">
            {STR.browse.status}
            <HelpTip action="browse-status">
              <select
                data-testid="browse-status"
                value={status}
                onChange={(e) => setFilter({ status: e.target.value || null })}
                className="rounded-sf border border-line bg-surface px-2 py-1.5 text-sm text-ink"
              >
                {STATUSES.map((s) => (
                  <option key={s || "all"} value={s}>
                    {s || STR.browse.statusAll}
                  </option>
                ))}
              </select>
            </HelpTip>
          </label>
          {tag ? (
            <HelpTip action="browse-tag">
              <span
                data-testid="browse-tag"
                className="inline-flex items-center gap-1 rounded-sf border border-line bg-surface-2 px-2 py-1 text-sm"
              >
                <span translate="no">{tag}</span>
                <button
                  type="button"
                  aria-label={STR.browse.clearTag}
                  className="text-muted hover:text-ink"
                  onClick={() => setFilter({ tag: null })}
                >
                  ×
                </button>
              </span>
            </HelpTip>
          ) : null}
          <AgentFilter agent={agent} setFilter={setFilter} />
          <FacetFilters
            facets={facetsQ.data}
            team={team}
            owner={owner}
            label={label}
            setFilter={setFilter}
          />
        </div>
      </StickyBar>

      <div className="flex items-center justify-between gap-3">
        <div data-testid="browse-total" className="text-sm text-muted">
          {STR.browse.total(total)}
        </div>
        <div data-testid="browse-pagination" className="flex items-center gap-2">
          <HelpTip action="page-prev">
            <button
              type="button"
              data-testid="page-prev"
              disabled={page <= 1}
              className="rounded-sf border border-line px-2 py-1 text-sm disabled:opacity-40"
              onClick={() => setFilter({ page: String(page - 1) })}
            >
              {STR.browse.prev}
            </button>
          </HelpTip>
          <HelpTip action="page-next">
            <button
              type="button"
              data-testid="page-next"
              disabled={page >= totalPages || total === 0}
              className="rounded-sf border border-line px-2 py-1 text-sm disabled:opacity-40"
              onClick={() => setFilter({ page: String(page + 1) })}
            >
              {STR.browse.next}
            </button>
          </HelpTip>
        </div>
      </div>

      <div data-testid="browse-results">
        <BrowseResults list={list} total={total} unfiltered={isUnfiltered(filters)} />
      </div>
    </div>
  );
}
