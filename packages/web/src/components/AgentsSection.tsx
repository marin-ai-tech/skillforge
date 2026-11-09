import type { ArtifactSummary } from "../api/types.ts";
import { useRuntimeLabels } from "../lib/runtimes.ts";
import { STR } from "../lib/strings.ts";

/**
 * "Agents" on the Overview tab (artifact-agent-compat): every agent of the runtime table — whether this type installs
 * into it (with the table's reason when not) and whether the author declared it, from which version.
 */
export function AgentsSection({ artifact }: { artifact: ArtifactSummary }) {
  const { label } = useRuntimeLabels();
  const agents = artifact.agents;
  if (!agents) return null;
  const rows = [
    ...agents.supported.map((id) => ({ id, reason: null as string | null })),
    ...agents.unsupported.map((u) => ({ id: u.runtime, reason: u.reason })),
  ];
  const declared = new Map(agents.declared.map((d) => [d.runtime, d]));
  const hasDeclaration = agents.declared.length > 0;
  return (
    <section
      data-testid="artifact-agents"
      className="space-y-2 rounded-sf border border-line bg-surface p-4"
    >
      <h3 className="text-sm font-medium uppercase tracking-wide text-muted">
        {STR.art.agents.title}
      </h3>
      <p className="text-sm text-ink-2">
        {hasDeclaration ? STR.art.agents.hintDeclared : STR.art.agents.hintComputed}
      </p>
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-muted">
          <tr>
            <th className="py-1 pr-3 font-medium">{STR.art.agents.agent}</th>
            <th className="py-1 pr-3 font-medium">{STR.art.agents.installs}</th>
            <th className="py-1 font-medium">{STR.art.agents.declared}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const d = declared.get(r.id);
            return (
              <tr
                key={r.id}
                data-testid="agent-row"
                data-runtime={r.id}
                data-supported={r.reason === null ? "true" : "false"}
                data-declared={d ? "true" : "false"}
                className="border-t border-line align-top"
              >
                <td className="py-1.5 pr-3 font-medium text-ink" translate="no">
                  {label(r.id)}
                </td>
                <td className="py-1.5 pr-3 text-ink-2">
                  {r.reason === null ? (
                    STR.art.agents.yes
                  ) : (
                    <span className="text-muted" translate="no">
                      {r.reason}
                    </span>
                  )}
                </td>
                <td className="py-1.5 text-ink-2">
                  {d
                    ? d.min_version
                      ? STR.art.agents.fromVersion(d.min_version)
                      : STR.art.agents.yes
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
