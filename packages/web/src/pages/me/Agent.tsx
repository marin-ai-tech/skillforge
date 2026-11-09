import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  getMyAgent,
  publishAgentItem,
  scanMyAgent,
  type MeUser,
} from "../../api/client.ts";
import type {
  AgentComparedItem,
  AgentItemStatus,
  AgentRegistryOnly,
  AgentSummaryCounts,
} from "../../api/types.ts";
import { RequireUser } from "../../components/RequireUser.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { HelpTip } from "../../components/HelpTip.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { CopyButton } from "../../components/CopyButton.tsx";
import { AgentMcpServers } from "../../components/AgentMcpServers.tsx";
import { roleAtLeast } from "../../lib/auth.tsx";
import { STR } from "../../lib/strings.ts";
import { errorText } from "../../i18n/index.ts";

const STATUS_KEYS: AgentItemStatus[] = [
  "local_only",
  "in_sync",
  "outdated",
  "modified",
  "registry_only",
];

const STATUS_CHIP: Record<AgentItemStatus, string> = {
  local_only: "bg-accent/10 text-accent",
  in_sync: "bg-st-active-bg text-st-active",
  outdated: "bg-st-aging-bg text-st-aging",
  modified: "bg-st-zombie-bg text-st-zombie",
  registry_only: "bg-surface-2 text-muted",
};

const ROW_STATUS: Record<AgentItemStatus, string> = {
  local_only: "border-l-accent",
  in_sync: "border-l-st-active",
  outdated: "border-l-st-aging",
  modified: "border-l-st-zombie",
  registry_only: "border-l-muted",
};

function shortDigest(d: string): string {
  return d.length > 12 ? `${d.slice(0, 12)}…` : d;
}

type TableProps = {
  items: AgentComparedItem[];
  registryOnly: AgentRegistryOnly[];
  canPublish: boolean;
  onPublish: (item: AgentComparedItem) => void;
};

/** Local column: version, else short digest; nothing for registry-only rows. */
function localVersionLabel(item: AgentComparedItem): string {
  return item.status === "registry_only"
    ? "—"
    : item.local.version
      ? item.local.version
      : item.local.digest
        ? shortDigest(item.local.digest)
        : "—";
}

function AgentItemName({ item, inRegistry }: { item: AgentComparedItem; inRegistry: boolean }) {
  return inRegistry && item.status !== "local_only" ? (
    <Link
      to={`/artifacts/${encodeURIComponent(item.type)}/${encodeURIComponent(item.name)}`}
      className="text-ink no-underline hover:text-accent"
    >
      {item.key}
    </Link>
  ) : item.status === "local_only" ? (
    <span>{item.key}</span>
  ) : (
    <Link
      to={`/artifacts/${encodeURIComponent(item.type)}/${encodeURIComponent(item.name)}`}
      className="text-ink no-underline hover:text-accent"
    >
      {item.key}
    </Link>
  );
}

function AgentItemsTable({ items, registryOnly, canPublish, onPublish }: TableProps) {
  const registryRows: AgentComparedItem[] = registryOnly.map((r) => ({
    key: `${r.type}/${r.name}`,
    type: r.type,
    name: r.name,
    status: "registry_only" as const,
    local: { version: null, digest: "", files: 0 },
    registry: {
      latest_version: r.latest_version,
      matched_version: null,
      status: r.status,
    },
  }));
  const rows = [...items, ...registryRows];

  return (
    <div className="overflow-x-auto rounded-sf border border-line">
      <table data-testid="agent-items" className="w-full text-left text-sm">
        <thead className="bg-surface-2 text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">{STR.ws.agent.colArtifact}</th>
            <th className="px-3 py-2 font-medium">{STR.ws.agent.colStatus}</th>
            <th className="px-3 py-2 font-medium">{STR.ws.agent.colLocal}</th>
            <th className="px-3 py-2 font-medium">{STR.ws.agent.colRegistry}</th>
            <th className="px-3 py-2 font-medium">{STR.ws.agent.colActions}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => {
            const inRegistry = item.status !== "local_only";
            const installCmd = `skillforge install ${item.type}/${item.name}`;
            return (
              <tr
                key={item.key}
                data-testid="agent-item"
                data-status={item.status}
                data-key={item.key}
                className={`border-t border-line border-l-4 ${ROW_STATUS[item.status]}`}
              >
                <td className="px-3 py-2 font-medium" translate="no">
                  <AgentItemName item={item} inRegistry={inRegistry} />
                </td>
                <td className="px-3 py-2">
                  <span
                    data-testid="agent-item-status"
                    className={`rounded-sf px-1.5 py-0.5 text-xs font-medium ${STATUS_CHIP[item.status]}`}
                  >
                    {STR.ws.agentStatus[item.status]}
                  </span>
                  {item.translated === true ? (
                    <span
                      data-testid="agent-item-translated"
                      title={STR.ws.agent.translatedHelp}
                      aria-label={STR.ws.agent.translatedAria(STR.ws.agent.translatedHelp)}
                      className="ml-1 cursor-help rounded-sf border border-line px-1.5 py-0.5 text-xs text-muted"
                    >
                      {STR.ws.agent.translatedLabel}
                    </span>
                  ) : null}
                  {item.status === "modified" && item.changed_files?.length ? (
                    <div
                      data-testid="agent-item-changed"
                      className="mt-1 text-xs text-muted"
                      translate="no"
                    >
                      {item.changed_files.join(", ")}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-xs text-ink-2">{localVersionLabel(item)}</td>
                <td className="px-3 py-2 text-xs text-ink-2">
                  {item.registry?.latest_version ?? "—"}
                </td>
                <td className="px-3 py-2">
                  {(item.status === "local_only" || item.status === "modified") && canPublish ? (
                    <HelpTip action="agent-item-publish">
                      <button
                        type="button"
                        data-testid="agent-item-publish"
                        className="rounded-sf border border-line px-2 py-1 text-xs hover:bg-surface-2"
                        onClick={() => onPublish(item)}
                      >
                        {STR.ws.agent.publish}
                      </button>
                    </HelpTip>
                  ) : null}
                  {item.status === "outdated" || item.status === "registry_only" ? (
                    <HelpTip action="agent-item-install">
                      <span
                        data-testid="agent-item-install"
                        className="inline-flex flex-wrap items-center gap-1 text-xs"
                      >
                        <code className="rounded-sf bg-surface-2 px-1 py-0.5">{installCmd}</code>
                        <CopyButton value={installCmd} />
                      </span>
                    </HelpTip>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DuplicatesSection({ duplicates }: { duplicates: AgentDuplicates }) {
  return (
    <section data-testid="agent-duplicates" className="space-y-2">
      <h2 className="text-sm font-semibold text-ink">{STR.ws.agent.duplicates}</h2>
      <ul className="space-y-2">
        {duplicates.map((d) => (
          <li
            key={d.key}
            data-testid="agent-duplicate"
            data-key={d.key}
            data-class={d.class}
            className="rounded-sf border border-line bg-surface px-3 py-2 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2" translate="no">
              <span className="font-medium">{d.key}</span>
              <span className="rounded-sf bg-surface-2 px-1.5 py-0.5 text-xs text-ink-2">
                {d.class}
              </span>
            </div>
            <div data-testid="agent-duplicate-keep" className="mt-1 font-mono text-xs text-accent">
              {STR.ws.agent.keep} <span translate="no">{d.keep}</span>
            </div>
            <p className="mt-1 text-xs text-muted" translate="no">
              {d.reason}
            </p>
            <ul className="mt-1 space-y-0.5 text-xs text-ink-2" translate="no">
              {d.roots.map((r) => (
                <li key={r.root} className="font-mono">
                  {r.root}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

type AgentDetailData = Awaited<ReturnType<typeof getMyAgent>>;
type AgentDuplicates = NonNullable<AgentDetailData["duplicates"]>;

function isNotFound(isError: boolean, error: unknown): boolean {
  return isError && error instanceof ApiError && error.status === 404;
}

function agentDescription(agent: AgentDetailData["agent"] | undefined): string | undefined {
  return agent
    ? `${agent.kind}${agent.runtime ? ` · ${agent.runtime}` : ""}${agent.server_path ? ` · ${agent.server_path}` : ""}`
    : undefined;
}

function AgentFilterBar({
  filter,
  setFilter,
  registryAll,
  searchParams,
  setSearchParams,
}: {
  filter: AgentItemStatus | "all";
  setFilter: (f: AgentItemStatus | "all") => void;
  registryAll: boolean;
  searchParams: URLSearchParams;
  setSearchParams: ReturnType<typeof useSearchParams>[1];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        data-testid="agent-filter-all"
        className={`rounded-sf border px-2 py-1 text-xs ${filter === "all" ? "border-accent text-accent" : "border-line"}`}
        onClick={() => setFilter("all")}
      >
        {STR.ws.agent.filterAll}
      </button>
      {STATUS_KEYS.map((k) => (
        <button
          key={k}
          type="button"
          data-testid={`agent-filter-${k}`}
          className={`rounded-sf border px-2 py-1 text-xs ${filter === k ? "border-accent text-accent" : "border-line"}`}
          onClick={() => setFilter(k)}
        >
          {STR.ws.agentStatus[k]}
        </button>
      ))}
      <HelpTip action="agent-registry-all">
        <label className="ml-2 inline-flex items-center gap-1 text-xs text-ink-2">
          <input
            type="checkbox"
            data-testid="agent-registry-all"
            checked={registryAll}
            onChange={(e) => {
              const next = new URLSearchParams(searchParams);
              if (e.target.checked) next.set("registry_status", "all");
              else next.delete("registry_status");
              setSearchParams(next);
            }}
          />
          {STR.ws.agent.registryAll}
        </label>
      </HelpTip>
    </div>
  );
}

function AgentRefreshHint({
  agent,
  name,
  rescanPending,
  onRescan,
}: {
  agent: AgentDetailData["agent"] | undefined;
  name: string;
  rescanPending: boolean;
  onRescan: () => void;
}) {
  return (
    <div
      data-testid="agent-refresh-hint"
      className="rounded-sf border border-line bg-surface px-3 py-2 text-sm text-ink-2"
    >
      {agent?.kind === "server" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span>{STR.ws.agent.serverRefresh}</span>
          <HelpTip action="agent-rescan">
            <button
              type="button"
              data-testid="agent-rescan"
              disabled={rescanPending}
              className="rounded-sf bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              onClick={onRescan}
            >
              {rescanPending ? STR.ws.agent.scanning : STR.ws.agent.rescan}
            </button>
          </HelpTip>
        </div>
      ) : (
        <span>
          {STR.ws.agent.reuploadHint}{" "}
          <code className="rounded-sf bg-surface-2 px-1 py-0.5 text-xs">
            skillforge agent scan &lt;dir&gt; --name {name}
          </code>
        </span>
      )}
    </div>
  );
}

function AgentMessages({ error, notice }: { error: string | null; notice: string | null }) {
  return (
    <>
      {error ? (
        <div
          data-testid="agent-error"
          className="rounded-sf bg-danger-bg px-2 py-1.5 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}
      {notice ? (
        <div
          data-testid="agent-notice"
          className="rounded-sf bg-accent/10 px-2 py-1.5 text-sm text-accent"
        >
          {notice}
        </div>
      ) : null}
    </>
  );
}

function AgentDetailPage({ user }: { user: MeUser }) {
  const { name = "" } = useParams<{ name: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const registryAll = searchParams.get("registry_status") === "all";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<AgentItemStatus | "all">("all");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [publishTarget, setPublishTarget] = useState<AgentComparedItem | null>(null);

  useEffect(() => {
    document.title = STR.ws.agent.docTitle(name);
  }, [name]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const detailQuery = useQuery({
    queryKey: ["agent", name, registryAll ? "all" : "active"],
    queryFn: () => getMyAgent(name, registryAll ? { registry_status: "all" } : undefined),
    retry: false,
  });

  const missing = isNotFound(detailQuery.isError, detailQuery.error);

  const scanMut = useMutation({
    mutationFn: () => scanMyAgent(name),
    onSuccess: async () => {
      setError(null);
      setNotice(STR.ws.agent.rescanned);
      await queryClient.invalidateQueries({ queryKey: ["agent", name] });
      await queryClient.invalidateQueries({ queryKey: ["my-agents"] });
    },
    onError: (err) => setError(errorText(err)),
  });

  const publishMut = useMutation({
    mutationFn: (item: AgentComparedItem) => publishAgentItem(name, item.type, item.name),
    onSuccess: async (data) => {
      setPublishTarget(null);
      setError(null);
      const ver = data.version.version;
      setNotice(`${data.artifact.type}/${data.artifact.name}@${ver}`);
      await queryClient.invalidateQueries({ queryKey: ["agent", name] });
      await queryClient.invalidateQueries({ queryKey: ["my-agents"] });
    },
    onError: (err) => {
      setPublishTarget(null);
      setError(errorText(err));
    },
  });

  const summary: AgentSummaryCounts | null = detailQuery.data?.summary ?? null;
  const agent = detailQuery.data?.agent;

  const filteredItems = useMemo(() => {
    const items = detailQuery.data?.items ?? [];
    const registryOnly = detailQuery.data?.registry_only ?? [];
    if (filter === "all") return { items, registryOnly };
    if (filter === "registry_only") return { items: [], registryOnly };
    return {
      items: items.filter((i) => i.status === filter),
      registryOnly: [],
    };
  }, [detailQuery.data, filter]);

  const canPublish = roleAtLeast(user.role, "contributor");

  if (missing) {
    return (
      <div className="space-y-4">
        <PageHeader title={name || STR.ws.agent.fallbackTitle} topic="pages/me-agent" />
        <div
          data-testid="agent-missing"
          className="rounded-sf border border-line bg-surface px-4 py-6 text-sm text-ink-2"
        >
          {STR.ws.agent.missing}
          <div className="mt-3">
            <button
              type="button"
              className="rounded-sf border border-line px-3 py-1.5 text-sm"
              onClick={() => navigate("/me/agents")}
            >
              {STR.ws.agent.back}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={name} description={agentDescription(agent)} topic="pages/me-agent" />

      <AgentMessages error={error} notice={notice} />

      {summary ? (
        <div className="flex flex-wrap gap-2">
          {STATUS_KEYS.map((k) => (
            <span
              key={k}
              data-testid={`agent-summary-${k}`}
              className={`rounded-sf px-2 py-1 text-xs font-medium ${STATUS_CHIP[k]}`}
            >
              {STR.ws.agentStatus[k]}: {summary[k]}
            </span>
          ))}
        </div>
      ) : null}

      <AgentFilterBar
        filter={filter}
        setFilter={setFilter}
        registryAll={registryAll}
        searchParams={searchParams}
        setSearchParams={setSearchParams}
      />

      {detailQuery.isLoading ? (
        <p className="text-sm text-muted">{STR.common.loading}</p>
      ) : (
        <AgentItemsTable
          items={filteredItems.items}
          registryOnly={filteredItems.registryOnly}
          canPublish={canPublish}
          onPublish={(item) => setPublishTarget(item)}
        />
      )}

      {detailQuery.data?.duplicates && detailQuery.data.duplicates.length > 0 ? (
        <DuplicatesSection duplicates={detailQuery.data.duplicates} />
      ) : null}

      <AgentMcpServers name={name} detail={detailQuery.data} />

      <AgentRefreshHint
        agent={agent}
        name={name}
        rescanPending={scanMut.isPending}
        onRescan={() => {
          setError(null);
          scanMut.mutate();
        }}
      />

      <ConfirmDialog
        open={publishTarget != null}
        title={STR.ws.agent.publishTitle}
        body={publishTarget ? STR.ws.agent.publishBody(publishTarget.key, name) : ""}
        helpText={STR.ws.agent.publishHelp}
        helpTopic="actions/agents/agent-item-publish"
        confirmLabel={STR.ws.agent.publish}
        onConfirm={() => {
          if (publishTarget) publishMut.mutate(publishTarget);
        }}
        onCancel={() => setPublishTarget(null)}
      />
    </div>
  );
}

export function Agent() {
  return <RequireUser>{(user) => <AgentDetailPage user={user} />}</RequireUser>;
}
