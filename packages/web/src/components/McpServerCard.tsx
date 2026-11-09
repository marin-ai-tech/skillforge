import { useQuery } from "@tanstack/react-query";
import { getMcpCard } from "../api/client.ts";
import type { McpCard, McpCardInput } from "../api/types.ts";
import { STR } from "../lib/strings.ts";

function Inputs({ items }: { items: McpCardInput[] }) {
  const S = STR.art.mcp;
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1">
      {items.map((i) => (
        <li
          key={i.name}
          data-testid="mcp-card-env"
          data-name={i.name}
          data-secret={i.isSecret ? "1" : "0"}
          className="flex flex-wrap items-baseline gap-2"
        >
          <code translate="no" className="text-xs">
            {i.name}
          </code>
          {i.isSecret ? (
            <span className="rounded-sf bg-danger-bg px-1.5 text-xs text-danger">{S.secret}</span>
          ) : null}
          {i.isRequired ? (
            <span className="rounded-sf bg-surface-2 px-1.5 text-xs text-muted">{S.required}</span>
          ) : null}
          {i.description ? <span className="text-xs text-ink-2">{i.description}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function Packages({ card }: { card: McpCard }) {
  return (
    <>
      {card.packages.map((p, i) => (
        <div key={`p${i}`} className="space-y-1">
          <div data-testid="mcp-card-package" className="font-mono text-xs" translate="no">
            {p.version ? `${p.identifier}@${p.version}` : p.identifier}
            <span className="text-muted">
              {" "}
              · {p.registryType} · {p.runtimeHint ?? "—"} · {p.transport}
            </span>
          </div>
          <Inputs items={p.env} />
        </div>
      ))}
      {card.remotes.map((r, i) => (
        <div key={`r${i}`} className="space-y-1">
          <div data-testid="mcp-card-remote" className="font-mono text-xs" translate="no">
            {r.url} <span className="text-muted">· {r.type}</span>
          </div>
          <Inputs items={r.headers} />
        </div>
      ))}
    </>
  );
}

function Policy({ card }: { card: McpCard }) {
  const S = STR.art.mcp;
  return (
    <div
      data-testid="mcp-card-policy"
      data-allowed={card.policy.allowed ? "1" : "0"}
      className={card.policy.allowed ? "text-ink-2" : "text-danger"}
    >
      {card.policy.allowed ? S.policyOk : S.policyViolated}
      {card.policy.reasons.length > 0 ? (
        <ul className="list-disc pl-5 text-xs">
          {card.policy.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The MCP part of an mcp-server Overview (mcp-server-card): what it runs, its secrets, policy and usage. */
export function McpServerCard({
  type,
  name,
  version,
}: {
  type: string;
  name: string;
  version: string;
}) {
  const q = useQuery({
    queryKey: ["mcp-card", name, version],
    queryFn: () => getMcpCard(name, version),
    enabled: type === "mcp-server",
    staleTime: 30_000,
  });
  if (type !== "mcp-server" || !q.data) return null;
  const S = STR.art.mcp;
  const card = q.data;
  return (
    <section
      data-testid="mcp-card"
      className="space-y-3 rounded-sf border border-line bg-surface p-4 text-sm"
    >
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted">{S.title}</h2>
      <Packages card={card} />
      {card.tools.length > 0 ? (
        <div className="space-y-1">
          <h3 className="text-xs uppercase tracking-wide text-muted">{S.tools}</h3>
          <ul className="space-y-0.5">
            {card.tools.map((t) => (
              <li key={t.name} data-testid="mcp-card-tool" className="text-xs">
                <code translate="no">{t.name}</code>
                {t.description ? <span className="text-ink-2"> — {t.description}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Policy card={card} />
      <p data-testid="mcp-card-usage" className="text-xs text-muted">
        {S.usage(card.usage.installs, card.usage.people, card.usage.same_version)}
      </p>
      <p className="text-xs text-muted">{S.installHint}</p>
    </section>
  );
}
