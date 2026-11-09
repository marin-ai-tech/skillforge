import type { ReactNode } from "react";
import { Link } from "react-router";
import type { ArtifactSummary } from "../api/types.ts";
import { TypeChip } from "./TypeChip.tsx";
import { StatusChip } from "./StatusChip.tsx";
import { Tag } from "./Tag.tsx";
import { RelativeTime } from "./RelativeTime.tsx";
import { GradeChip } from "./GradeChip.tsx";
import { AgentBadges } from "./AgentBadges.tsx";
import { STR } from "../lib/strings.ts";
import { useLang } from "../i18n/index.ts";

type Props = { artifact: ArtifactSummary; children?: ReactNode };

/** content-security-scan: the latest version's scan verdict, shown only when it is not a pass. */
function RiskChip({ verdict }: { verdict: "pass" | "warn" | "fail" | null }) {
  if (verdict !== "warn" && verdict !== "fail") return null;
  return (
    <span
      data-testid="artifact-security"
      data-verdict={verdict}
      className={`rounded-sf px-1.5 py-0.5 text-xs ${verdict === "fail" ? "bg-danger-bg text-danger" : "bg-surface-2 text-warning"}`}
    >
      {STR.art.quality.riskChip[verdict]}
    </span>
  );
}

const BADGE_TONE: Record<string, string> = {
  ok: "bg-surface-2 text-st-active",
  info: "bg-surface-2 text-ink-2",
  warn: "bg-surface-2 text-warning",
  danger: "bg-danger-bg text-danger",
};

/** plugin-artifact-badges: what plugins say about the artifact, e.g. the outcome of a review run. */
function PluginBadges({ badges }: { badges: ArtifactSummary["badges"] }) {
  const lang = useLang();
  if (!badges || badges.length === 0) return null;
  return (
    <>
      {badges.map((b) => (
        <span
          key={`${b.plugin}:${b.id}`}
          data-testid="artifact-badge"
          data-plugin={b.plugin}
          title={b.plugin}
          className={`rounded-sf px-1.5 py-0.5 text-xs ${BADGE_TONE[b.tone] ?? BADGE_TONE.info}`}
        >
          {b.labels?.[lang] ?? b.label}
        </span>
      ))}
    </>
  );
}

export function ArtifactCard({ artifact, children }: Props) {
  const href = `/artifacts/${artifact.type}/${artifact.name}`;
  const title = artifact.display_name || artifact.name;
  const tags = artifact.tags.slice(0, 4);
  return (
    <article
      data-testid="artifact-card"
      data-type={artifact.type}
      data-name={artifact.name}
      className="flex flex-col gap-2 rounded-sf border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <TypeChip type={artifact.type} />
        <StatusChip status={artifact.status} />
        {artifact.quality ? (
          <GradeChip grade={artifact.quality.grade} testId="artifact-grade" />
        ) : null}
        <RiskChip verdict={artifact.quality?.security ?? null} />
        <PluginBadges badges={artifact.badges} />
        {artifact.quality?.context === "high" ? (
          <span
            data-testid="artifact-context-high"
            className="rounded-sf bg-surface-2 px-1.5 py-0.5 text-xs text-warning"
          >
            {STR.art.quality.contextChip}
          </span>
        ) : null}
        {artifact.replaced_by ? (
          <span
            data-testid="artifact-replaced"
            className="rounded-sf bg-surface-2 px-1.5 py-0.5 text-xs text-warning"
          >
            {STR.art.overview.replacedChip}
          </span>
        ) : null}
        {artifact.latest_version ? (
          <span translate="no" className="font-mono text-xs text-muted">
            {artifact.latest_version}
          </span>
        ) : null}
        <RelativeTime iso={artifact.updated_at} />
      </div>
      <div>
        <Link
          to={href}
          translate="no"
          className="text-base font-semibold text-ink no-underline hover:underline"
        >
          {title}
        </Link>
        {artifact.display_name ? (
          <span translate="no" className="ml-2 text-sm text-muted">
            {artifact.name}
          </span>
        ) : null}
      </div>
      <p translate="no" className="line-clamp-3 text-sm text-ink-2">
        {artifact.description}
      </p>
      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => (
            <Tag key={t} tag={t} to={`/artifacts?tag=${encodeURIComponent(t)}`} />
          ))}
        </div>
      ) : null}
      <AgentBadges artifact={artifact} />
      {children ? <div className="mt-1 flex flex-wrap gap-2">{children}</div> : null}
    </article>
  );
}
