import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  createAdminAgent,
  deleteAdminAgent,
  listAdminAgents,
  scanAdminAgent,
  type MeUser,
} from "../../api/client.ts";
import type { AdminAgentListItem } from "../../api/types.ts";
import { RequireUser } from "../../components/RequireUser.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { HelpTip } from "../../components/HelpTip.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { RelativeTime } from "../../components/RelativeTime.tsx";
import { useAgentRuntimeOptions } from "../../lib/runtimes.ts";
import { STR } from "../../lib/strings.ts";
import { errorText } from "../../i18n/index.ts";

function formatError(err: unknown): string {
  if (err instanceof ApiError) {
    const text = errorText(err);
    return text && text !== err.error ? `${err.error}: ${text}` : err.error;
  }
  return errorText(err);
}

function AdminAgentsPage({ user }: { user: MeUser }) {
  const queryClient = useQueryClient();
  const listQuery = useQuery({ queryKey: ["admin-agents"], queryFn: listAdminAgents });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [serverPath, setServerPath] = useState("");
  const [runtime, setRuntime] = useState<string>("claude-code");
  const runtimeOptions = useAgentRuntimeOptions(runtime);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    document.title = STR.adm.agents.docTitle;
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const createMut = useMutation({
    mutationFn: () =>
      createAdminAgent({
        name: name.trim(),
        server_path: serverPath.trim(),
        runtime: runtime || null,
      }),
    onSuccess: async (data) => {
      setError(null);
      setNotice(STR.adm.agents.noticeCreated(data.agent.name));
      setName("");
      setServerPath("");
      await queryClient.invalidateQueries({ queryKey: ["admin-agents"] });
      await queryClient.invalidateQueries({ queryKey: ["my-agents"] });
    },
    onError: (err) => setError(formatError(err)),
  });

  const scanMut = useMutation({
    mutationFn: (id: string) => scanAdminAgent(id),
    onSuccess: async (data) => {
      setError(null);
      setNotice(STR.adm.agents.noticeRescanned(data.agent.name));
      await queryClient.invalidateQueries({ queryKey: ["admin-agents"] });
      await queryClient.invalidateQueries({ queryKey: ["agent", data.agent.name] });
    },
    onError: (err) => setError(formatError(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteAdminAgent(id),
    onSuccess: async () => {
      setDeleteId(null);
      setError(null);
      setNotice(STR.adm.agents.noticeDeleted);
      await queryClient.invalidateQueries({ queryKey: ["admin-agents"] });
      await queryClient.invalidateQueries({ queryKey: ["my-agents"] });
    },
    onError: (err) => {
      setError(formatError(err));
      setDeleteId(null);
    },
  });

  function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    createMut.mutate();
  }

  const items: AdminAgentListItem[] = listQuery.data?.items ?? [];
  const roots = listQuery.data?.roots ?? [];
  const rootsEnabled = listQuery.data?.roots_enabled ?? false;
  const deleteTarget = items.find((a) => a.id === deleteId) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={STR.adm.agents.title}
        description={STR.adm.agents.description}
        topic="pages/admin-agents"
      />

      {error ? (
        <div
          data-testid="admin-error"
          className="rounded-sf bg-danger-bg px-2 py-1.5 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}
      {notice ? (
        <div
          data-testid="admin-notice"
          className="rounded-sf bg-accent/10 px-2 py-1.5 text-sm text-accent"
        >
          {notice}
        </div>
      ) : null}

      {rootsEnabled ? (
        <div
          data-testid="agent-roots"
          className="rounded-sf border border-line bg-surface px-3 py-2 text-sm text-ink-2"
        >
          <div className="font-medium text-ink">{STR.adm.agents.rootsTitle}</div>
          <ul className="mt-1 list-disc pl-5">
            {roots.map((r) => (
              <li key={r}>
                <code translate="no" className="rounded-sf bg-surface-2 px-1 py-0.5 text-xs">
                  {r}
                </code>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div
          data-testid="agent-roots-disabled"
          className="rounded-sf border border-line bg-surface px-3 py-2 text-sm text-muted"
        >
          {STR.adm.agents.rootsDisabled}
        </div>
      )}

      <form
        data-testid="server-agent-form"
        className="space-y-3 rounded-sf border border-line bg-surface p-4"
        onSubmit={onCreate}
      >
        <div className="text-sm font-medium text-ink">{STR.adm.agents.registerTitle}</div>
        <div className="flex flex-wrap gap-3">
          <label className="block min-w-[10rem] flex-1 text-sm">
            <span className="text-muted">{STR.adm.agents.name}</span>
            <input
              data-testid="server-agent-name"
              className="mt-1 w-full rounded-sf border border-line bg-bg px-3 py-1.5 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <label className="block min-w-[16rem] flex-[2] text-sm">
            <span className="text-muted">{STR.adm.agents.serverPath}</span>
            <input
              data-testid="server-agent-path"
              className="mt-1 w-full rounded-sf border border-line bg-bg px-3 py-1.5 text-sm"
              value={serverPath}
              onChange={(e) => setServerPath(e.target.value)}
              required
            />
          </label>
          <label className="block min-w-[10rem] text-sm">
            <span className="text-muted">{STR.adm.agents.runtime}</span>
            <select
              data-testid="server-agent-runtime"
              className="mt-1 w-full rounded-sf border border-line bg-bg px-3 py-1.5 text-sm"
              value={runtime}
              onChange={(e) => setRuntime(e.target.value)}
            >
              {runtimeOptions.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <HelpTip action="server-agent-submit">
          <button
            type="submit"
            data-testid="server-agent-submit"
            disabled={createMut.isPending || !rootsEnabled}
            className="rounded-sf bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {createMut.isPending ? STR.adm.agents.creating : STR.adm.agents.create}
          </button>
        </HelpTip>
      </form>

      <div className="overflow-x-auto rounded-sf border border-line">
        <table data-testid="admin-agents-table" className="w-full text-left text-sm">
          <thead className="bg-surface-2 text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">{STR.adm.agents.colName}</th>
              <th className="px-3 py-2 font-medium">{STR.adm.agents.colOwner}</th>
              <th className="px-3 py-2 font-medium">{STR.adm.agents.colKind}</th>
              <th className="px-3 py-2 font-medium">{STR.adm.agents.colRuntime}</th>
              <th className="px-3 py-2 font-medium">{STR.adm.agents.colItems}</th>
              <th className="px-3 py-2 font-medium">{STR.adm.agents.colScanned}</th>
              <th className="px-3 py-2 font-medium">{STR.adm.agents.colActions}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => {
              const isOwn = a.owner.id === user.id || a.owner.username === user.username;
              return (
                <tr key={a.id} data-testid="admin-agent-row" className="border-t border-line">
                  <td className="px-3 py-2 font-medium" translate="no">
                    {isOwn ? (
                      <Link
                        to={`/me/agents/${encodeURIComponent(a.name)}`}
                        className="text-ink no-underline hover:text-accent"
                      >
                        {a.name}
                      </Link>
                    ) : (
                      a.name
                    )}
                  </td>
                  <td className="px-3 py-2" translate="no">
                    {a.owner.username}
                  </td>
                  <td className="px-3 py-2">{STR.adm.agents.kind[a.kind] ?? a.kind}</td>
                  <td className="px-3 py-2" translate="no">
                    {a.runtime ?? "—"}
                  </td>
                  <td className="px-3 py-2">{a.item_count}</td>
                  <td className="px-3 py-2">
                    {a.scanned_at ? <RelativeTime iso={a.scanned_at} /> : "—"}
                  </td>
                  <td className="px-3 py-2 space-x-2">
                    {a.kind === "server" ? (
                      <HelpTip action="admin-agent-scan">
                        <button
                          type="button"
                          data-testid="admin-agent-scan"
                          className="rounded-sf border border-line px-2 py-1 text-xs hover:bg-surface-2"
                          onClick={() => {
                            setError(null);
                            scanMut.mutate(a.id);
                          }}
                        >
                          {STR.adm.agents.scan}
                        </button>
                      </HelpTip>
                    ) : null}
                    <HelpTip action="admin-agent-delete">
                      <button
                        type="button"
                        data-testid="admin-agent-delete"
                        className="rounded-sf border border-line px-2 py-1 text-xs hover:bg-surface-2"
                        onClick={() => setDeleteId(a.id)}
                      >
                        {STR.adm.agents.delete}
                      </button>
                    </HelpTip>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={deleteId != null}
        title={STR.adm.agents.deleteTitle}
        body={
          deleteTarget
            ? STR.adm.agents.deleteBody(deleteTarget.name, deleteTarget.owner.username)
            : ""
        }
        helpText={STR.adm.agents.deleteHelp}
        helpTopic="actions/agents/admin-agent-delete"
        confirmLabel={STR.adm.agents.delete}
        onConfirm={() => {
          if (deleteId) deleteMut.mutate(deleteId);
        }}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}

export function AdminAgents() {
  return <RequireUser requireAdmin>{(user) => <AdminAgentsPage user={user} />}</RequireUser>;
}
