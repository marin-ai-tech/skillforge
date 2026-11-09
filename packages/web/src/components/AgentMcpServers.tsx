import type { AgentMcpServer } from "../api/types.ts";
import { STR } from "../lib/strings.ts";
import { formatDateTime } from "../i18n/index.ts";

function target(s: AgentMcpServer): string {
  if (s.package) return s.version ? `${s.package}@${s.version}` : s.package;
  return s.origin ?? s.launcher ?? "—";
}

/** What to fix on this server, in words: unpinned package, literal secrets by variable name, disabled. */
function notes(s: AgentMcpServer): string[] {
  const S = STR.ws.agent;
  const out: string[] = [];
  if (s.transport === "stdio" && s.package && !s.pinned) out.push(S.mcpUnpinned);
  if (s.literal_secret) {
    const names = [...s.env, ...s.headers]
      .filter((v) => v.kind === "literal" && v.secret_like)
      .map((v) => v.name);
    out.push(S.mcpLiteral(names.length > 0 ? names.join(", ") : S.mcpLiteralOther));
  }
  if (!s.enabled) out.push(S.mcpDisabled);
  return out;
}

function Rows({ servers }: { servers: AgentMcpServer[] }) {
  const C = STR.ws.agent.mcpCols;
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs uppercase tracking-wide text-muted">
        <tr>
          <th className="py-1 pr-3">{C.name}</th>
          <th className="py-1 pr-3">{C.scope}</th>
          <th className="py-1 pr-3">{C.source}</th>
          <th className="py-1 pr-3">{C.transport}</th>
          <th className="py-1 pr-3">{C.target}</th>
          <th className="py-1">{C.notes}</th>
        </tr>
      </thead>
      <tbody>
        {servers.map((s, i) => (
          <tr
            key={`${s.source}/${s.scope}/${s.name}/${i}`}
            data-testid="agent-mcp-server"
            data-name={s.name}
            data-scope={s.scope}
            data-literal={s.literal_secret ? "1" : "0"}
            className="border-t border-line"
          >
            <td translate="no" className="py-1 pr-3 font-mono text-xs">
              {s.name}
            </td>
            <td className="py-1 pr-3">{s.scope}</td>
            <td translate="no" className="py-1 pr-3 font-mono text-xs">
              {s.source}
            </td>
            <td className="py-1 pr-3">{s.transport}</td>
            <td translate="no" className="py-1 pr-3 font-mono text-xs">
              {target(s)}
            </td>
            <td className={`py-1 text-xs ${s.literal_secret ? "text-danger" : "text-ink-2"}`}>
              {notes(s).join(" · ")}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** MCP servers of one agent as the registry saw them (agent scan --mcp); no values ever reach this page. */
export function AgentMcpServers({
  name,
  detail,
}: {
  name: string;
  detail: { mcp_scanned_at?: string | null; mcp_servers?: AgentMcpServer[] } | undefined;
}) {
  if (!detail) return null;
  const scannedAt = detail.mcp_scanned_at;
  const servers = detail.mcp_servers;
  const S = STR.ws.agent;
  return (
    <section data-testid="agent-mcp" className="space-y-2">
      <h2 className="text-sm font-semibold text-ink">{S.mcpTitle}</h2>
      {!scannedAt ? (
        <p data-testid="agent-mcp-hint" className="text-sm text-ink-2">
          {S.mcpHint}{" "}
          <code translate="no" className="rounded-sf bg-surface-2 px-1 py-0.5 text-xs">
            skillforge agent scan --name {name} --mcp
          </code>
        </p>
      ) : (
        <>
          <p data-testid="agent-mcp-scanned" className="text-xs text-muted">
            {S.mcpScanned(formatDateTime(scannedAt))}
          </p>
          {servers && servers.length > 0 ? (
            <Rows servers={servers} />
          ) : (
            <p data-testid="agent-mcp-empty" className="text-sm text-ink-2">
              {S.mcpEmpty}
            </p>
          )}
        </>
      )}
    </section>
  );
}
