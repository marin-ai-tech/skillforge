import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createToken, listTokens, revokeToken } from "../../api/client.ts";
import { RequireUser } from "../../components/RequireUser.tsx";
import { CopyButton } from "../../components/CopyButton.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { RelativeTime } from "../../components/RelativeTime.tsx";
import { STR } from "../../lib/strings.ts";
import { PageHeader } from "../../components/PageHeader.tsx";
import { HelpTip } from "../../components/HelpTip.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import {
  MCP_CLIENTS,
  isMcpClient,
  mcpConnectSnippets,
  type McpClient,
  type McpConnectSnippets,
} from "../../lib/mcp-connect.ts";

const MCP_CLIENT_KEY = "skillforge.mcpClient";
const DEFAULT_MCP_CLIENT: McpClient = "claude-code";

/** Remembered client choice; storage is a convenience, so any failure falls back to the default. */
function readMcpClient(): McpClient {
  try {
    const v = localStorage.getItem(MCP_CLIENT_KEY);
    return isMcpClient(v) ? v : DEFAULT_MCP_CLIENT;
  } catch {
    return DEFAULT_MCP_CLIENT;
  }
}

function writeMcpClient(client: McpClient): void {
  try {
    localStorage.setItem(MCP_CLIENT_KEY, client);
  } catch {
    // Storage unavailable (private mode, quota): the choice just is not remembered.
  }
}

function buildSnippets(
  client: McpClient,
  baseUrl: string,
  token: string,
): McpConnectSnippets | null {
  try {
    return mcpConnectSnippets(client, { baseUrl, token });
  } catch {
    return null;
  }
}

function parseTagsInput(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function TokensPage() {
  const queryClient = useQueryClient();
  const tokensQuery = useQuery({ queryKey: ["tokens"], queryFn: listTokens });
  const [name, setName] = useState("");
  const [mcp, setMcp] = useState(false);
  const [mcpTags, setMcpTags] = useState("");
  const [lastCreated, setLastCreated] = useState<{
    token: string;
    mcp: boolean;
  } | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [mcpClient, setMcpClient] = useState<McpClient>(readMcpClient);

  function chooseMcpClient(client: McpClient) {
    setMcpClient(client);
    writeMcpClient(client);
  }

  useEffect(() => {
    document.title = STR.ws.tokens.docTitle;
    return () => {
      setLastCreated(null);
    };
  }, []);

  const createMut = useMutation({
    mutationFn: () => {
      const tags = parseTagsInput(mcpTags);
      return createToken({
        name: name.trim(),
        ...(mcp ? { mcp: true, mcp_tags: tags } : {}),
      });
    },
    onSuccess: async (created) => {
      setLastCreated({ token: created.token, mcp: created.mcp });
      setName("");
      setMcp(false);
      setMcpTags("");
      await queryClient.invalidateQueries({ queryKey: ["tokens"] });
    },
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => revokeToken(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tokens"] });
    },
  });

  function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createMut.mutate();
  }

  const items = tokensQuery.data?.items ?? [];
  const mcpBase = typeof window !== "undefined" ? window.location.origin : "";
  const snippets =
    lastCreated && lastCreated.mcp ? buildSnippets(mcpClient, mcpBase, lastCreated.token) : null;

  return (
    <div className="space-y-6">
      <PageHeader title={STR.tokens.title} description={STR.tokens.subtitle} topic="pages/tokens" />

      <form
        data-testid="token-create"
        className="flex flex-wrap items-end gap-3 rounded-sf border border-line bg-surface p-4"
        onSubmit={onCreate}
      >
        <label className="block min-w-[12rem] flex-1 text-sm">
          <span className="text-muted">{STR.tokens.name}</span>
          <HelpTip action="token-name">
            <input
              data-testid="token-name"
              className="mt-1 w-full rounded-sf border border-line bg-bg px-3 py-1.5 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </HelpTip>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <HelpTip action="token-mcp">
            <input
              type="checkbox"
              data-testid="token-mcp"
              checked={mcp}
              onChange={(e) => {
                setMcp(e.target.checked);
                if (!e.target.checked) setMcpTags("");
              }}
            />
          </HelpTip>
          <span>{STR.tokens.mcpAllow}</span>
        </label>
        <label className="block min-w-[12rem] flex-1 text-sm">
          <span className="text-muted">{STR.tokens.mcpTags}</span>
          <HelpTip action="token-mcp-tags">
            <input
              data-testid="token-mcp-tags"
              className="mt-1 w-full rounded-sf border border-line bg-bg px-3 py-1.5 text-sm disabled:opacity-40"
              value={mcpTags}
              disabled={!mcp}
              placeholder={STR.ws.tokens.mcpTagsPlaceholder}
              onChange={(e) => setMcpTags(e.target.value)}
            />
          </HelpTip>
        </label>
        <HelpTip action="token-create-submit">
          <button
            type="submit"
            data-testid="token-create-submit"
            disabled={createMut.isPending}
            className="rounded-sf bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {createMut.isPending ? STR.tokens.creating : STR.tokens.create}
          </button>
        </HelpTip>
      </form>

      {lastCreated ? (
        <div
          data-testid="token-secret"
          className="space-y-2 rounded-sf border border-accent/40 bg-surface p-4"
        >
          <p className="text-sm font-medium">{STR.tokens.secretTitle}</p>
          <p className="break-all font-mono text-sm text-ink">{lastCreated.token}</p>
          <CopyButton value={lastCreated.token} />
          <p className="text-sm text-muted">{STR.tokens.secretHint}</p>
          {lastCreated.mcp ? (
            <HelpTip action="token-mcp-snippet">
              <div data-testid="token-mcp-snippet" className="space-y-3 border-t border-line pt-3">
                <p className="text-sm font-medium">{STR.tokens.mcpSnippetTitle}</p>
                <div
                  role="group"
                  aria-label={STR.tokens.mcpClientGroup}
                  className="flex flex-wrap gap-2"
                >
                  {MCP_CLIENTS.map((c) => (
                    <HelpTip key={c} action="token-mcp-client">
                      <button
                        type="button"
                        data-testid="token-mcp-client"
                        data-client={c}
                        aria-pressed={c === mcpClient}
                        className={
                          c === mcpClient
                            ? "rounded-sf border border-accent bg-accent/15 px-3 py-1 text-xs font-medium text-accent"
                            : "rounded-sf border border-line px-3 py-1 text-xs text-muted hover:text-ink"
                        }
                        onClick={() => chooseMcpClient(c)}
                      >
                        {STR.tokens.mcpClientLabels[c]}
                      </button>
                    </HelpTip>
                  ))}
                </div>
                {snippets ? (
                  <>
                    <div className="space-y-1">
                      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-sf bg-bg p-2 font-mono text-xs">
                        {snippets.http}
                      </pre>
                      <CopyButton value={snippets.http} label={STR.tokens.mcpCopyHttp} />
                    </div>
                    <div className="space-y-1">
                      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-sf bg-bg p-2 font-mono text-xs">
                        {snippets.stdio}
                      </pre>
                      <CopyButton value={snippets.stdio} label={STR.tokens.mcpCopyStdio} />
                    </div>
                    {snippets.notes.length > 0 ? (
                      <ul
                        data-testid="token-mcp-notes"
                        className="list-disc space-y-1 pl-5 text-sm text-muted"
                      >
                        {STR.ws.tokens.mcpNotes(mcpClient, snippets.notes).map((n) => (
                          <li key={n}>{n}</li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-danger">{STR.tokens.mcpSnippetUnavailable}</p>
                )}
              </div>
            </HelpTip>
          ) : null}
        </div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState title={STR.tokens.emptyTitle} hint={STR.tokens.emptyHint} />
      ) : (
        <ul data-testid="tokens-list" className="space-y-2">
          {items.map((t) => (
            <li
              key={t.id}
              data-testid="token-row"
              data-id={t.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-sf border border-line bg-surface px-4 py-3"
            >
              <div className="space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium" translate="no">
                    {t.name}
                  </span>
                  {t.mcp ? (
                    <span
                      data-testid="token-mcp-chip"
                      translate="no"
                      className="rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent"
                    >
                      {t.mcp_tags.length > 0 ? `MCP: ${t.mcp_tags.join(", ")}` : "MCP"}
                    </span>
                  ) : null}
                </div>
                <div className="text-muted">
                  {STR.tokens.prefix}: <span className="font-mono">{t.prefix}</span>
                </div>
                <div className="text-muted">
                  {STR.tokens.created}: <RelativeTime iso={t.created_at} />
                </div>
                <div className="text-muted">
                  {STR.tokens.lastUsed}:{" "}
                  {t.last_used_at ? <RelativeTime iso={t.last_used_at} /> : STR.tokens.never}
                </div>
              </div>
              <HelpTip action="token-revoke">
                <button
                  type="button"
                  data-testid="token-revoke"
                  className="rounded-sf border border-line px-3 py-1.5 text-sm text-danger hover:bg-danger-bg"
                  onClick={() => setRevokeId(t.id)}
                >
                  {STR.tokens.revoke}
                </button>
              </HelpTip>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={revokeId != null}
        title={STR.ws.tokens.revokeTitle}
        body={STR.ws.tokens.revokeBody}
        helpText={STR.ws.tokens.revokeHelp}
        helpTopic="actions/tokens/revoke"
        confirmLabel={STR.tokens.revoke}
        onConfirm={() => {
          if (revokeId) revokeMut.mutate(revokeId);
          setRevokeId(null);
        }}
        onCancel={() => setRevokeId(null)}
      />
    </div>
  );
}

export function Tokens() {
  return <RequireUser>{() => <TokensPage />}</RequireUser>;
}
