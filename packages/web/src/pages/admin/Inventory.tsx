import { useEffect } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { getInventory } from "../../api/client.ts";
import type {
  InventoryArtifact,
  InventoryMcp,
  InventoryMcpServer,
  OrganisationInventory,
} from "../../api/types.ts";
import { RequireUser } from "../../components/RequireUser.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { STR } from "../../lib/strings.ts";
import { errorText, formatDateTime } from "../../i18n/index.ts";

const STATUSES = ["unregistered", "modified", "outdated", "in_sync"] as const;

function Totals({ inv }: { inv: OrganisationInventory }) {
  const S = STR.adm.inventory;
  const cells: Array<[string, number]> = [
    [S.people, inv.totals.people],
    [S.agents, inv.totals.agents],
    [S.copies, inv.totals.copies],
    ...STATUSES.map((s) => [S.status[s], inv.totals.by_status[s]] as [string, number]),
  ];
  return (
    <dl data-testid="inventory-totals" className="grid gap-3 sm:grid-cols-4">
      {cells.map(([k, v]) => (
        <div key={k} className="rounded-sf border border-line bg-surface p-3">
          <dt className="text-xs uppercase tracking-wide text-muted">{k}</dt>
          <dd className="text-lg font-semibold">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Name({ a }: { a: InventoryArtifact }) {
  const label = `${a.type}/${a.name}`;
  if (a.origin === "unregistered") {
    return (
      <span translate="no" className="font-mono text-xs">
        {label}
      </span>
    );
  }
  return (
    <Link
      translate="no"
      to={`/artifacts/${a.type}/${a.name}`}
      className="font-mono text-xs text-accent"
    >
      {label}
    </Link>
  );
}

function Artifacts({ inv }: { inv: OrganisationInventory }) {
  const S = STR.adm.inventory;
  if (inv.artifacts.length === 0) return <p className="text-sm text-ink-2">{S.empty}</p>;
  return (
    <table data-testid="inventory-artifacts" className="w-full text-left text-sm">
      <thead className="text-xs uppercase tracking-wide text-muted">
        <tr>
          <th className="py-1 pr-3">{S.colArtifact}</th>
          <th className="py-1 pr-3">{S.colOrigin}</th>
          <th className="py-1 pr-3">{S.copies}</th>
          <th className="py-1 pr-3">{S.people}</th>
          <th className="py-1 pr-3">{S.colVariants}</th>
          <th className="py-1">{S.colStatuses}</th>
        </tr>
      </thead>
      <tbody>
        {inv.artifacts.map((a) => (
          <tr
            key={`${a.type}/${a.name}`}
            data-testid="inventory-artifact"
            data-origin={a.origin}
            className="border-t border-line"
          >
            <td className="py-1 pr-3">
              <Name a={a} />
            </td>
            <td className={`py-1 pr-3 ${a.origin === "unregistered" ? "text-warning" : ""}`}>
              {S.origin[a.origin]}
            </td>
            <td className="py-1 pr-3">{a.copies}</td>
            <td className="py-1 pr-3">{a.people}</td>
            <td className="py-1 pr-3">{a.variants}</td>
            <td className="py-1 text-xs">
              {STATUSES.filter((s) => a.statuses[s])
                .map((s) => `${S.status[s]}: ${a.statuses[s]}`)
                .join(" · ")}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function People({ inv }: { inv: OrganisationInventory }) {
  const S = STR.adm.inventory;
  return (
    <section className="space-y-1">
      <h2 className="text-sm font-semibold text-ink">{S.peopleTitle}</h2>
      <table data-testid="inventory-people" className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="py-1 pr-3">{S.colPerson}</th>
            <th className="py-1 pr-3">{S.agents}</th>
            <th className="py-1 pr-3">{S.copies}</th>
            <th className="py-1 pr-3">{S.status.unregistered}</th>
            <th className="py-1">{S.colLastScan}</th>
          </tr>
        </thead>
        <tbody>
          {inv.people.map((p) => (
            <tr key={p.username} className="border-t border-line">
              <td translate="no" className="py-1 pr-3">
                {p.username}
              </td>
              <td className="py-1 pr-3">{p.agents}</td>
              <td className="py-1 pr-3">{p.copies}</td>
              <td className="py-1 pr-3">{p.unregistered}</td>
              <td className="py-1 text-xs text-muted">
                {p.last_scan ? formatDateTime(p.last_scan) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function McpTotals({ mcp }: { mcp: InventoryMcp }) {
  const T = STR.adm.inventory.mcpTotals;
  const cells: Array<[string, number]> = [
    [T.agents, mcp.totals.agents],
    [T.people, mcp.totals.people],
    [T.servers, mcp.totals.servers],
    [T.installs, mcp.totals.installs],
    [T.unpinned, mcp.totals.unpinned_installs],
    [T.literal, mcp.totals.literal_secret_installs],
    [T.remote, mcp.totals.remote_installs],
  ];
  return (
    <dl data-testid="inventory-mcp-totals" className="grid gap-3 sm:grid-cols-4">
      {cells.map(([k, v]) => (
        <div key={k} className="rounded-sf border border-line bg-surface p-3">
          <dt className="text-xs uppercase tracking-wide text-muted">{k}</dt>
          <dd className="text-lg font-semibold">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function McpRow({ s }: { s: InventoryMcpServer }) {
  const others = s.names.filter((n) => n !== s.label);
  return (
    <tr
      data-testid="inventory-mcp-server"
      data-key={s.key}
      data-literal={s.literal_secret_installs > 0 ? "1" : "0"}
      data-unpinned={s.unpinned_installs > 0 ? "1" : "0"}
      className="border-t border-line"
    >
      <td translate="no" className="py-1 pr-3 font-mono text-xs">
        {s.label}
        {others.length > 0 ? <span className="text-muted"> ({others.join(", ")})</span> : null}
      </td>
      <td className="py-1 pr-3">{s.transports.join(", ")}</td>
      <td className="py-1 pr-3">{s.installs}</td>
      <td translate="no" className="py-1 pr-3 text-xs">
        {s.people.join(", ")}
      </td>
      <td translate="no" className="py-1 pr-3 font-mono text-xs">
        {s.versions.join(", ") || "—"}
      </td>
      <td className={`py-1 pr-3 ${s.unpinned_installs > 0 ? "text-warning" : ""}`}>
        {s.unpinned_installs}
      </td>
      <td className={`py-1 pr-3 ${s.literal_secret_installs > 0 ? "text-danger" : ""}`}>
        {s.literal_secret_installs}
      </td>
      <td className="py-1 pr-3">{s.disabled_installs}</td>
      <td data-testid="inventory-mcp-registry" className="py-1 text-xs">
        {s.registry ? (
          <Link
            translate="no"
            to={`/artifacts/mcp-server/${s.registry.name}`}
            className="font-mono text-accent"
          >
            {s.registry.name}
          </Link>
        ) : (
          <span className="text-warning">{STR.adm.inventory.mcpNotInRegistry}</span>
        )}
        {s.registry ? <span className="text-muted"> · {s.registry.status}</span> : null}
      </td>
    </tr>
  );
}

function McpServers({ inv }: { inv: OrganisationInventory }) {
  const S = STR.adm.inventory;
  const C = S.mcpCols;
  const mcp = inv.mcp;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-ink">{S.mcpTitle}</h2>
      <p className="text-sm text-ink-2">{S.mcpDescription}</p>
      {!mcp || mcp.servers.length === 0 ? (
        <p data-testid="inventory-mcp-empty" className="text-sm text-ink-2">
          {S.mcpEmpty}{" "}
          <code translate="no" className="rounded-sf bg-surface-2 px-1 py-0.5 text-xs">
            skillforge agent scan --name &lt;agent&gt; --mcp
          </code>
        </p>
      ) : (
        <>
          <McpTotals mcp={mcp} />
          <table data-testid="inventory-mcp" className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="py-1 pr-3">{C.server}</th>
                <th className="py-1 pr-3">{C.transport}</th>
                <th className="py-1 pr-3">{C.installs}</th>
                <th className="py-1 pr-3">{C.people}</th>
                <th className="py-1 pr-3">{C.versions}</th>
                <th className="py-1 pr-3">{C.unpinned}</th>
                <th className="py-1 pr-3">{C.literal}</th>
                <th className="py-1 pr-3">{C.disabled}</th>
                <th className="py-1">{C.registry}</th>
              </tr>
            </thead>
            <tbody>
              {mcp.servers.map((s) => (
                <McpRow key={s.key} s={s} />
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function InventoryPage() {
  useEffect(() => {
    document.title = STR.adm.inventory.docTitle;
  }, []);
  const q = useQuery({ queryKey: ["organisation-inventory"], queryFn: getInventory });
  const S = STR.adm.inventory;
  return (
    <div className="space-y-6">
      <PageHeader title={S.title} topic="pages/admin-inventory" />
      <p className="text-sm text-ink-2">{S.description}</p>
      {q.error ? <p className="text-sm text-danger">{errorText(q.error)}</p> : null}
      {q.data ? (
        <>
          <Totals inv={q.data} />
          <Artifacts inv={q.data} />
          <People inv={q.data} />
          <McpServers inv={q.data} />
        </>
      ) : null}
    </div>
  );
}

export function AdminInventory() {
  return <RequireUser requireAdmin>{() => <InventoryPage />}</RequireUser>;
}
