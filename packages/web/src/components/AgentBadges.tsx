import type { ArtifactSummary } from "../api/types.ts";
import { useRuntimeLabels } from "../lib/runtimes.ts";
import { STR } from "../lib/strings.ts";

const MAX_BADGES = 4;
const badge = "rounded-sf border border-line bg-surface-2 px-1.5 py-0.5 text-xs text-ink-2";

/**
 * Agents on a catalog card (artifact-agent-compat): the author's declaration with minimum versions, or — without a
 * declaration — how many agents take this type.
 */
export function AgentBadges({ artifact }: { artifact: ArtifactSummary }) {
  const { label } = useRuntimeLabels();
  const agents = artifact.agents;
  if (!agents) return null;
  if (agents.declared.length === 0) {
    if (agents.supported.length === 0) return null;
    return (
      <div data-testid="artifact-agents-badges" className="flex flex-wrap gap-1">
        <span className={badge} title={agents.supported.map(label).join(", ")} translate="no">
          {STR.art.agents.count(agents.supported.length)}
        </span>
      </div>
    );
  }
  const shown = agents.declared.slice(0, MAX_BADGES);
  const rest = agents.declared.length - shown.length;
  return (
    <div data-testid="artifact-agents-badges" className="flex flex-wrap gap-1">
      {shown.map((d) => (
        <span key={d.runtime} className={badge} translate="no">
          {d.min_version ? `${label(d.runtime)} ≥ ${d.min_version}` : label(d.runtime)}
        </span>
      ))}
      {rest > 0 ? <span className={badge}>+{rest}</span> : null}
    </div>
  );
}
