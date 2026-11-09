import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  exportMetrics,
  getArtifactFacets,
  getMetricsOverview,
  listArtifactTypes,
} from "../api/client.ts";
import type { MetricsOverviewItem, MetricsOverviewResponse, MetricsTotals } from "../api/types.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { ErrorState } from "../components/ErrorState.tsx";
import { HelpTip } from "../components/HelpTip.tsx";
import { StickyBar } from "../components/StickyBar.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { Skeleton } from "../components/Skeleton.tsx";
import { useMe } from "../lib/auth.tsx";
import { STR } from "../lib/strings.ts";
import { errorText } from "../i18n/index.ts";
import { FALLBACK_TYPE_IDS } from "../lib/artifact-types.ts";

const STATUSES = ["", "candidate", "active", "aging", "zombie", "retired"] as const;

type SortId =
  | "name"
  | "status"
  | "skill_age_days"
  | "sessions_count"
  | "verification_pass_rate"
  | "transfer_rate"
  | "ablation_score"
  | "token_efficiency"
  | "last_used_at";

/** Column order; captions come from `STR.ws.metrics.columns`. */
const COLUMNS: Array<{ id: SortId; estimate?: boolean }> = [
  { id: "name" },
  { id: "status" },
  { id: "skill_age_days" },
  { id: "sessions_count" },
  { id: "verification_pass_rate" },
  { id: "transfer_rate" },
  { id: "ablation_score" },
  { id: "token_efficiency", estimate: true },
  { id: "last_used_at" },
];

const DEFAULT_LIMIT = 50;

function fmtMetric(v: number | null | undefined, digits = 3): string {
  if (v === null || v === undefined) return "\u2014";
  if (!Number.isFinite(v)) return "\u2014";
  return String(Number(v.toFixed(digits)));
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "\u2014";
  if (!Number.isFinite(v)) return "\u2014";
  return `${Math.round(v * 1000) / 10}%`;
}

function displayLabel(item: MetricsOverviewItem): string {
  return item.display_name && item.display_name.trim() ? item.display_name : item.name;
}

function cellValue(item: MetricsOverviewItem, id: SortId): string {
  switch (id) {
    case "name":
      return displayLabel(item);
    case "status":
      return item.status;
    case "skill_age_days":
      return String(item.skill_age_days);
    case "sessions_count":
      return String(item.sessions_count);
    case "verification_pass_rate":
      return fmtPct(item.verification_pass_rate);
    case "transfer_rate":
      return fmtMetric(item.transfer_rate);
    case "ablation_score":
      return fmtMetric(item.ablation_score);
    case "token_efficiency":
      return fmtMetric(item.token_efficiency);
    case "last_used_at":
      return item.last_used_at ?? "\u2014";
    default:
      return "\u2014";
  }
}

/** Filters, sort and paging of the metrics board from the URL (with defaults and bounds). */
function readMetricsParams(params: URLSearchParams) {
  const type = params.get("type") ?? "";
  const status = params.get("status") ?? "";
  const team = params.get("team") ?? "";
  const q = params.get("q") ?? "";
  const sort = (params.get("sort") ?? "transfer_rate") as SortId;
  const order = params.get("order") === "asc" ? "asc" : "desc";
  const limit = Math.min(
    200,
    Math.max(1, Number(params.get("limit") ?? String(DEFAULT_LIMIT)) || DEFAULT_LIMIT),
  );
  const offset = Math.max(0, Number(params.get("offset") ?? "0") || 0);
  return { type, status, team, q, sort, order, limit, offset };
}

export function Metrics() {
  const me = useMe();
  const user = me.data ?? null;
  const [params, setParams] = useSearchParams();

  const { type, status, team, q, sort, order, limit, offset } = readMetricsParams(params);

  const [searchInput, setSearchInput] = useState(q);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);

  useEffect(() => {
    setSearchInput(q);
  }, [q]);

  useEffect(() => {
    document.title = STR.ws.metrics.docTitle;
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (searchInput === q) return;
      const sp = new URLSearchParams(params);
      if (searchInput) sp.set("q", searchInput);
      else sp.delete("q");
      sp.delete("offset");
      setParams(sp, { replace: true });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [searchInput, q, params, setParams]);

  function setFilter(patch: Record<string, string | null>) {
    const sp = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") sp.delete(k);
      else sp.set(k, v);
    }
    if (!("offset" in patch)) sp.delete("offset");
    setParams(sp);
  }

  function toggleSort(field: SortId) {
    if (sort === field) {
      setFilter({ sort: field, order: order === "desc" ? "asc" : "desc" });
    } else {
      setFilter({ sort: field, order: "desc" });
    }
  }

  const typeCatalog = useQuery({
    queryKey: ["artifact-types"],
    queryFn: listArtifactTypes,
    staleTime: 60_000,
  });
  const typeIds: string[] = typeCatalog.data?.items.map((t) => t.id) ?? [...FALLBACK_TYPE_IDS];

  const facetsQ = useQuery({
    queryKey: ["artifacts", "facets"],
    queryFn: getArtifactFacets,
    staleTime: 30_000,
  });

  const queryArgs = useMemo(
    () => ({
      ...(type ? { type } : {}),
      ...(status ? { status } : {}),
      ...(team ? { team } : {}),
      ...(q ? { q } : {}),
      sort,
      order: order as "asc" | "desc",
      limit,
      offset,
    }),
    [type, status, team, q, sort, order, limit, offset],
  );

  const board = useQuery({
    queryKey: ["metrics-overview", queryArgs],
    queryFn: () => getMetricsOverview(queryArgs),
    staleTime: 15_000,
  });

  async function doExport(format: "csv" | "json") {
    setExportError(null);
    if (!user) {
      setExportError(STR.ws.metrics.signInToExport);
      return;
    }
    setExportBusy(true);
    try {
      const { blob, filename } = await exportMetrics({
        format,
        ...(type ? { type } : {}),
        ...(status ? { status } : {}),
        ...(team ? { team } : {}),
        ...(q ? { q } : {}),
        sort,
        order: order as "asc" | "desc",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(errorText(e));
    } finally {
      setExportBusy(false);
    }
  }

  const data = board.data;
  const totals = data?.totals;

  /** Totals, filters and export: the pinned part above the table (a render function, so inputs keep focus). */
  const toolbar = (data: MetricsOverviewResponse, totals: MetricsTotals) => (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-sf border border-line bg-surface p-4">
          <div className="text-xs uppercase text-muted">{STR.ws.metrics.totalArtifacts}</div>
          <div data-testid="metrics-total-artifacts" className="mt-1 font-mono text-xl text-ink">
            {totals.artifacts}
          </div>
        </div>
        <div className="rounded-sf border border-line bg-surface p-4">
          <div className="text-xs uppercase text-muted">{STR.ws.metrics.totalTransfer}</div>
          <div data-testid="metrics-total-transfer" className="mt-1 font-mono text-xl text-ink">
            {fmtMetric(totals.transfer_rate)}
          </div>
        </div>
        <div className="rounded-sf border border-line bg-surface p-4">
          <div className="text-xs uppercase text-muted">{STR.ws.metrics.totalAblation}</div>
          <div data-testid="metrics-total-ablation" className="mt-1 font-mono text-xl text-ink">
            {fmtMetric(totals.ablation_mean)}
          </div>
        </div>
        <div className="rounded-sf border border-line bg-surface p-4">
          <div className="text-xs uppercase text-muted">{STR.ws.metrics.totalSessions}</div>
          <div data-testid="metrics-total-sessions" className="mt-1 font-mono text-xl text-ink">
            {totals.sessions}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted">
          {STR.ws.metrics.type}
          <select
            data-testid="metrics-filter-type"
            value={type}
            onChange={(e) => setFilter({ type: e.target.value || null })}
            className="rounded-sf border border-line bg-surface px-2 py-1.5 text-sm text-ink"
          >
            <option value="">{STR.ws.metrics.allTypes}</option>
            {typeIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">
          {STR.ws.metrics.status}
          <select
            data-testid="metrics-filter-status"
            value={status}
            onChange={(e) => setFilter({ status: e.target.value || null })}
            className="rounded-sf border border-line bg-surface px-2 py-1.5 text-sm text-ink"
          >
            {STATUSES.map((s) => (
              <option key={s || "all"} value={s}>
                {s || STR.ws.metrics.allStatuses}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">
          {STR.ws.metrics.team}
          <select
            data-testid="metrics-filter-team"
            value={team}
            onChange={(e) => setFilter({ team: e.target.value || null })}
            className="rounded-sf border border-line bg-surface px-2 py-1.5 font-mono text-sm text-ink"
          >
            <option value="">{STR.ws.metrics.allTeams}</option>
            {(facetsQ.data?.teams ?? []).map((f) => (
              <option key={f.value} value={f.value}>
                {f.value}
              </option>
            ))}
          </select>
        </label>
        <input
          data-testid="metrics-filter-q"
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={STR.ws.metrics.searchPlaceholder}
          className="min-w-[200px] flex-1 rounded-sf border border-line bg-surface px-3 py-1.5 text-sm"
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {user ? (
            <>
              <HelpTip action="metrics-export-csv">
                <button
                  type="button"
                  data-testid="metrics-export-csv"
                  disabled={exportBusy}
                  className="rounded-sf border border-line px-2 py-1 text-sm hover:border-accent disabled:opacity-50"
                  onClick={() => void doExport("csv")}
                >
                  {STR.ws.metrics.exportCsv}
                </button>
              </HelpTip>
              <HelpTip action="metrics-export-json">
                <button
                  type="button"
                  data-testid="metrics-export-json"
                  disabled={exportBusy}
                  className="rounded-sf border border-line px-2 py-1 text-sm hover:border-accent disabled:opacity-50"
                  onClick={() => void doExport("json")}
                >
                  {STR.ws.metrics.exportJson}
                </button>
              </HelpTip>
            </>
          ) : (
            <p data-testid="metrics-export-login" className="text-sm text-muted">
              <Link to="/login?next=/metrics" className="text-accent no-underline hover:underline">
                {STR.ws.metrics.signIn}
              </Link>
              {STR.ws.metrics.signInSuffix}
            </p>
          )}
        </div>
      </div>
      {exportError ? (
        <div data-testid="metrics-export-error" className="text-sm text-danger">
          {exportError}
        </div>
      ) : null}
    </>
  );

  return (
    <div className="space-y-4">
      <StickyBar>
        <PageHeader
          title={STR.ws.metrics.title}
          description={STR.ws.metrics.description}
          topic="pages/metrics"
        />
        {data && totals ? toolbar(data, totals) : null}
      </StickyBar>

      {board.isError ? (
        <ErrorState onRetry={() => void board.refetch()} />
      ) : board.isLoading || !data || !totals ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          {data.items.length === 0 ? (
            <EmptyState title={STR.browse.empty} />
          ) : (
            <div className="overflow-x-auto rounded-sf border border-line bg-surface">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                  <tr>
                    {COLUMNS.map((col) => (
                      <th key={col.id} className="px-3 py-2">
                        <HelpTip action="metrics-sort">
                          <button
                            type="button"
                            data-testid={`metrics-sort-${col.id}`}
                            className="inline-flex items-center gap-1 hover:text-ink"
                            onClick={() => toggleSort(col.id)}
                          >
                            <span>{STR.ws.metrics.columns[col.id]}</span>
                            {col.estimate ? (
                              <span className="normal-case text-[10px] text-muted">
                                {STR.ws.metrics.estimateParen}
                              </span>
                            ) : null}
                            {sort === col.id ? <span>{order === "asc" ? " ↑" : " ↓"}</span> : null}
                          </button>
                        </HelpTip>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr
                      key={`${item.type}/${item.name}`}
                      data-testid={`metrics-row-${item.type}-${item.name}`}
                      className="border-b border-line last:border-0"
                    >
                      {COLUMNS.map((col) => (
                        <td key={col.id} className="px-3 py-2 font-mono">
                          {col.id === "name" ? (
                            <div>
                              <Link
                                to={`/artifacts/${encodeURIComponent(item.type)}/${encodeURIComponent(item.name)}`}
                                className="font-sans font-medium text-accent no-underline hover:underline"
                                translate="no"
                              >
                                {displayLabel(item)}
                              </Link>
                              <div className="font-mono text-xs text-muted">
                                {item.type}/{item.name}
                              </div>
                            </div>
                          ) : col.id === "token_efficiency" ? (
                            <span>
                              {cellValue(item, col.id)}
                              <span className="ml-1 text-[10px] text-muted">
                                {STR.ws.metrics.estimate}
                              </span>
                            </span>
                          ) : (
                            cellValue(item, col.id)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-muted">
              {STR.ws.metrics.showing(data.items.length, totals.artifacts)}
              {offset > 0 ? STR.ws.metrics.offset(offset) : ""}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="metrics-page-prev"
                disabled={offset <= 0}
                className="rounded-sf border border-line px-2 py-1 text-sm disabled:opacity-40"
                onClick={() => setFilter({ offset: String(Math.max(0, offset - limit)) })}
              >
                {STR.ws.metrics.prev}
              </button>
              <button
                type="button"
                data-testid="metrics-page-next"
                disabled={data.next_offset == null}
                className="rounded-sf border border-line px-2 py-1 text-sm disabled:opacity-40"
                onClick={() => {
                  if (data.next_offset != null) {
                    setFilter({ offset: String(data.next_offset) });
                  }
                }}
              >
                {STR.ws.metrics.next}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
