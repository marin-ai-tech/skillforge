import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteMyAgent, listMyAgents, putMyAgent } from "../../api/client.ts";
import type { AgentListItem, AgentSummaryCounts } from "../../api/types.ts";
import { RequireUser } from "../../components/RequireUser.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { HelpTip } from "../../components/HelpTip.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { RelativeTime } from "../../components/RelativeTime.tsx";
import { encodeFiles, filesFromInput, type LocalFile } from "../../lib/files.ts";
import { agentUploadPaths } from "../../lib/agent-files.ts";
import { useAgentRuntimeOptions } from "../../lib/runtimes.ts";
import { STR } from "../../lib/strings.ts";
import { codeMessage, errorText } from "../../i18n/index.ts";

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const STATUS_CHIP: Record<keyof AgentSummaryCounts, string> = {
  local_only: "bg-accent/10 text-accent",
  in_sync: "bg-st-active-bg text-st-active",
  outdated: "bg-st-aging-bg text-st-aging",
  modified: "bg-st-zombie-bg text-st-zombie",
  registry_only: "bg-surface-2 text-muted",
};

/** Interface label of an agent kind; an unknown kind from the server is shown as is. */
function kindLabel(kind: string): string {
  return (STR.ws.agentKind as Record<string, string | undefined>)[kind] ?? kind;
}

/** Strip the webkitdirectory top folder (e.g. laptop/skills/... -> skills/...). */
function stripTopSegment(files: LocalFile[]): LocalFile[] {
  return files
    .map((f) => {
      const parts = f.path.replace(/\\/g, "/").split("/");
      if (parts.length <= 1) return f;
      return { ...f, path: parts.slice(1).join("/") };
    })
    .filter((f) => f.path.length > 0);
}

async function buildUploadBody(
  fileList: FileList | null,
  runtime: string,
): Promise<
  | {
      ok: true;
      body: {
        runtime: string;
        files: Array<{ path: string; content_base64: string }>;
        lock?: unknown;
      };
    }
  | { ok: false; message: string }
> {
  const raw = stripTopSegment(filesFromInput(fileList));
  if (raw.length === 0) return { ok: false, message: STR.ws.agents.noFiles };

  let lock: unknown = undefined;
  const files: LocalFile[] = [];
  for (const f of raw) {
    const base = f.path.split("/").pop() ?? "";
    if (base === ".skillforge-lock.json") {
      try {
        const text = await f.file.text();
        lock = JSON.parse(text) as unknown;
      } catch {
        return { ok: false, message: STR.ws.agents.invalidLock };
      }
      continue;
    }
    files.push(f);
  }
  // Only files that form artifacts leave the browser; settings.local.json, auth.json, .env and the like stay here.
  const upload = new Set(agentUploadPaths(files.map((f) => f.path)).upload);
  const artifactFiles = files.filter((f) => upload.has(f.path));
  if (artifactFiles.length === 0) return { ok: false, message: STR.ws.agents.noArtifactFiles };
  const encoded = await encodeFiles(artifactFiles);
  if (!encoded.ok) {
    return {
      ok: false,
      message: encoded.issues.map((i) => codeMessage(i.code, i.message)).join("; "),
    };
  }
  return {
    ok: true,
    body: {
      runtime,
      files: encoded.files,
      ...(lock !== undefined ? { lock } : {}),
    },
  };
}

function SummaryChips({ summary }: { summary: AgentSummaryCounts }) {
  const keys = Object.keys(STATUS_CHIP) as Array<keyof AgentSummaryCounts>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {keys.map((k) => (
        <span
          key={k}
          data-testid={`agent-summary-${k}`}
          className={`rounded-sf px-1.5 py-0.5 text-xs font-medium ${STATUS_CHIP[k]}`}
        >
          {STR.ws.agentStatus[k]}: {summary[k]}
        </span>
      ))}
    </span>
  );
}

function AgentsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const listQuery = useQuery({ queryKey: ["my-agents"], queryFn: listMyAgents });
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [runtime, setRuntime] = useState<string>("claude-code");
  const runtimeOptions = useAgentRuntimeOptions(runtime);
  const [folder, setFolder] = useState<FileList | null>(null);
  const [deleteName, setDeleteName] = useState<string | null>(null);

  useEffect(() => {
    document.title = STR.ws.agents.docTitle;
  }, []);

  const addMut = useMutation({
    mutationFn: async () => {
      if (!NAME_RE.test(name) || name.length < 1 || name.length > 64) {
        throw new Error(STR.ws.agents.invalidName);
      }
      const built = await buildUploadBody(folder, runtime);
      if (!built.ok) throw new Error(built.message);
      return putMyAgent(name, built.body);
    },
    onSuccess: async (_data, _vars) => {
      setError(null);
      setDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["my-agents"] });
      navigate(`/me/agents/${name}`);
    },
    onError: (err) => setError(errorText(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (n: string) => deleteMyAgent(n),
    onSuccess: async () => {
      setDeleteName(null);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["my-agents"] });
    },
    onError: (err) => {
      setError(errorText(err));
      setDeleteName(null);
    },
  });

  function onAddSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    addMut.mutate();
  }

  const items: AgentListItem[] = listQuery.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={STR.ws.agents.title}
        description={STR.ws.agents.description}
        topic="pages/me-agents"
        actions={
          <HelpTip action="agent-add">
            <button
              type="button"
              data-testid="agent-add"
              className="rounded-sf bg-accent px-4 py-2 text-sm font-medium text-white"
              onClick={() => {
                setError(null);
                setName("");
                setRuntime("claude-code");
                setFolder(null);
                setDialogOpen(true);
              }}
            >
              {STR.ws.agents.add}
            </button>
          </HelpTip>
        }
      />

      {error ? (
        <div
          data-testid="agent-error"
          className="rounded-sf bg-danger-bg px-2 py-1.5 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      {items.length === 0 && !listQuery.isLoading ? (
        <div
          data-testid="agents-empty"
          className="rounded-sf border border-dashed border-line px-4 py-8 text-center text-sm text-muted"
        >
          {STR.ws.agents.emptyHint}{" "}
          <code className="rounded-sf bg-surface-2 px-1 py-0.5 text-xs">
            skillforge agent scan .claude --name &lt;name&gt;
          </code>
        </div>
      ) : (
        <div data-testid="agents-list" className="space-y-2">
          {items.map((a) => (
            <div
              key={a.id}
              data-testid="agent-row"
              className="flex flex-wrap items-center gap-3 rounded-sf border border-line bg-surface px-3 py-2"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/me/agents/${encodeURIComponent(a.name)}`}
                    className="font-medium text-ink no-underline hover:text-accent"
                    translate="no"
                  >
                    {a.name}
                  </Link>
                  <span
                    data-testid="agent-kind"
                    className="rounded-sf border border-line px-1.5 py-0.5 text-xs"
                  >
                    {kindLabel(a.kind)}
                  </span>
                  {a.runtime ? (
                    <span className="text-xs text-muted" translate="no">
                      {a.runtime}
                    </span>
                  ) : null}
                  <span className="text-xs text-muted">{STR.ws.agents.items(a.item_count)}</span>
                </div>
                <SummaryChips summary={a.summary} />
                {a.scanned_at ? (
                  <div className="text-xs text-muted">
                    {STR.ws.agents.scanned} <RelativeTime iso={a.scanned_at} />
                  </div>
                ) : null}
              </div>
              <HelpTip action="agent-delete">
                <button
                  type="button"
                  data-testid="agent-delete"
                  className="rounded-sf border border-line px-2 py-1 text-xs hover:bg-surface-2"
                  onClick={() => setDeleteName(a.name)}
                >
                  {STR.ws.agents.delete}
                </button>
              </HelpTip>
            </div>
          ))}
        </div>
      )}

      {dialogOpen ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
          <form
            data-testid="agent-add-dialog"
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md space-y-3 rounded-sf border border-line bg-surface p-4 shadow-lg"
            onSubmit={onAddSubmit}
          >
            <h2 className="text-base font-semibold text-ink">{STR.ws.agents.dialogTitle}</h2>
            <label className="block text-sm">
              <span className="text-muted">{STR.ws.agents.nameLabel}</span>
              <input
                data-testid="agent-name"
                className="mt-1 w-full rounded-sf border border-line bg-bg px-3 py-1.5 text-sm"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
            <label className="block text-sm">
              <span className="text-muted">{STR.ws.agents.runtimeLabel}</span>
              <select
                data-testid="agent-runtime"
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
            <label className="block text-sm">
              <span className="text-muted">{STR.ws.agents.folderLabel}</span>
              <input
                data-testid="agent-folder"
                type="file"
                className="mt-1 block w-full text-sm"
                {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                multiple
                onChange={(e) => setFolder(e.target.files)}
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="rounded-sf border border-line px-3 py-1.5 text-sm"
                onClick={() => setDialogOpen(false)}
              >
                {STR.ws.agents.cancel}
              </button>
              <button
                type="submit"
                data-testid="agent-add-submit"
                disabled={addMut.isPending}
                className="rounded-sf bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
              >
                {addMut.isPending ? STR.ws.agents.uploading : STR.ws.agents.addSubmit}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <ConfirmDialog
        open={deleteName != null}
        title={STR.ws.agents.deleteTitle}
        body={deleteName ? STR.ws.agents.deleteBody(deleteName) : ""}
        helpText={STR.ws.agents.deleteHelp}
        helpTopic="actions/agents/agent-delete"
        confirmLabel={STR.ws.agents.delete}
        onConfirm={() => {
          if (deleteName) deleteMut.mutate(deleteName);
        }}
        onCancel={() => setDeleteName(null)}
      />
    </div>
  );
}

export function Agents() {
  return <RequireUser>{() => <AgentsPage />}</RequireUser>;
}
