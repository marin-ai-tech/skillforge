import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteMySessionFacts, getMeOverview } from "../../api/client.ts";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import type { LifecycleStatus, MeOverview } from "../../api/types.ts";
import { RequireUser } from "../../components/RequireUser.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { HelpTip } from "../../components/HelpTip.tsx";
import { StatusChip } from "../../components/StatusChip.tsx";
import { GradeChip } from "../../components/GradeChip.tsx";
import { RelativeTime } from "../../components/RelativeTime.tsx";
import { roleAtLeast } from "../../lib/auth.tsx";
import { STR } from "../../lib/strings.ts";

const STATUSES: LifecycleStatus[] = ["candidate", "active", "aging", "zombie", "retired"];
const AGENT_SUMMARY_KEYS = [
  "outdated",
  "modified",
  "local_only",
  "registry_only",
  "in_sync",
] as const;

/** Interface label of an agent kind; an unknown kind from the server is shown as is. */
function kindLabel(kind: string): string {
  return (STR.ws.agentKind as Record<string, string | undefined>)[kind] ?? kind;
}

function ArtifactsSection({ data, canPublish }: { data: MeOverview; canPublish: boolean }) {
  return (
    <section data-testid="me-artifacts" className="space-y-3">
      <h2 className="text-base font-semibold text-ink">{STR.ws.overview.artifacts}</h2>
      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <span
            key={s}
            data-testid={`me-artifacts-count-${s}`}
            className="rounded-sf border border-line bg-surface px-2 py-1 text-xs text-ink-2"
          >
            {s}: {data.artifacts.by_status[s] ?? 0}
          </span>
        ))}
      </div>
      {data.artifacts.items.length === 0 ? (
        <div
          data-testid="me-artifacts-empty"
          className="rounded-sf border border-dashed border-line bg-surface px-4 py-6 text-sm text-muted"
        >
          <p>{STR.ws.overview.noArtifacts}</p>
          {canPublish ? (
            <p className="mt-2">
              <Link to="/publish" className="text-accent underline">
                {STR.ws.overview.publishFirst}
              </Link>
            </p>
          ) : null}
        </div>
      ) : (
        <ul className="space-y-2">
          {data.artifacts.items.map((a) => (
            <li
              key={`${a.type}/${a.name}`}
              data-testid="me-artifact"
              data-key={`${a.type}/${a.name}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-sf border border-line bg-surface px-3 py-2 text-sm"
            >
              <Link
                to={`/artifacts/${a.type}/${a.name}`}
                className="font-medium text-ink no-underline hover:underline"
                translate="no"
              >
                {a.type}/{a.name}
              </Link>
              <span className="flex items-center gap-2">
                {a.latest_version ? (
                  <span data-testid="me-artifact-version" className="font-mono text-xs text-muted">
                    v{a.latest_version}
                  </span>
                ) : null}
                {a.quality ? (
                  <GradeChip grade={a.quality.grade} testId="me-artifact-grade" />
                ) : null}
                <span data-testid="me-artifact-status">
                  <StatusChip status={a.status} />
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AgentsSection({ data }: { data: MeOverview }) {
  return (
    <section data-testid="me-agents" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-ink">{STR.ws.overview.agents}</h2>
        {data.agents.attention > 0 ? (
          <span
            data-testid="me-agents-attention"
            className="rounded-sf bg-st-aging-bg px-2 py-0.5 text-xs font-medium text-st-aging"
          >
            {STR.ws.overview.attention(data.agents.attention)}
          </span>
        ) : null}
      </div>
      {data.agents.items.length === 0 ? (
        <div
          data-testid="me-agents-empty"
          className="rounded-sf border border-dashed border-line bg-surface px-4 py-6 text-sm text-muted"
        >
          {STR.ws.overview.agentsEmptyRun}{" "}
          <code className="rounded-sf bg-surface-2 px-1 py-0.5 font-mono text-xs">
            skillforge agent scan
          </code>{" "}
          {STR.ws.overview.agentsEmptyOr}{" "}
          <Link to="/me/agents" className="text-accent underline">
            {STR.ws.overview.myAgents}
          </Link>
          {STR.ws.overview.agentsEmptyEnd}
        </div>
      ) : (
        <ul className="space-y-2">
          {data.agents.items.map((a) => (
            <li
              key={a.name}
              data-testid="me-agent"
              data-name={a.name}
              className="rounded-sf border border-line bg-surface px-3 py-2 text-sm"
            >
              <Link
                to={`/me/agents/${a.name}`}
                className="font-medium text-ink no-underline hover:underline"
                translate="no"
              >
                {a.name}
              </Link>
              <span className="ml-2 text-muted">
                {kindLabel(a.kind)}
                {a.runtime ? (
                  <>
                    {" / "}
                    <span translate="no">{a.runtime}</span>
                  </>
                ) : null}
              </span>
              <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                {AGENT_SUMMARY_KEYS.filter((k) => a.summary[k] > 0).map((k) => (
                  <span
                    key={k}
                    data-testid={`me-agent-summary-${k}`}
                    className="rounded-sf border border-line bg-surface-2 px-1.5 py-0.5 text-xs text-ink-2"
                  >
                    {STR.ws.agentStatusShort[k]}: {a.summary[k]}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OverviewPage({ data }: { data: MeOverview }) {
  const canPublish = roleAtLeast(data.user.role, "contributor");
  const showReview = data.review != null;
  const [deleteOpen, setDeleteOpen] = useState(false);
  const qc = useQueryClient();
  const deleteMut = useMutation({
    mutationFn: () => deleteMySessionFacts(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["me-overview"] });
    },
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title={STR.ws.overview.title}
        description={STR.ws.overview.description}
        topic="pages/me"
      />

      <section
        data-testid="me-profile"
        className="rounded-sf border border-line bg-surface px-4 py-3 text-sm"
      >
        <div className="font-medium text-ink" translate="no">
          {data.user.display_name
            ? `${data.user.display_name} (${data.user.username})`
            : data.user.username}
        </div>
        <div className="mt-1 text-muted">
          {STR.ws.overview.role}{" "}
          <span data-testid="me-role" className="font-medium text-ink">
            {data.user.role}
          </span>
        </div>
      </section>

      <ArtifactsSection data={data} canPublish={canPublish} />

      <AgentsSection data={data} />

      <section data-testid="me-tokens" className="space-y-3">
        <h2 className="text-base font-semibold text-ink">{STR.ws.overview.tokens}</h2>
        <div className="flex flex-wrap gap-4 text-sm">
          <span data-testid="me-tokens-active">
            {STR.ws.overview.tokensActive} <strong>{data.tokens.active}</strong>
          </span>
          <span data-testid="me-tokens-never-used">
            {STR.ws.overview.tokensNeverUsed} <strong>{data.tokens.never_used}</strong>
          </span>
          {data.tokens.last_used_at ? (
            <span className="text-muted">
              {STR.ws.overview.tokensLastUsed} <RelativeTime iso={data.tokens.last_used_at} />
            </span>
          ) : null}
        </div>
        <HelpTip action="me-tokens-manage">
          <Link
            to="/me/tokens"
            data-testid="me-tokens-manage"
            className="inline-block text-sm text-accent underline"
          >
            {STR.ws.overview.tokensManage}
          </Link>
        </HelpTip>
      </section>

      {showReview && data.review ? (
        <section data-testid="me-review" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-ink">{STR.lifecycle.reviewQueue}</h2>
            <HelpTip action="me-review-open">
              <Link
                to="/lifecycle"
                data-testid="me-review-open"
                className="text-sm text-accent underline"
              >
                {STR.ws.overview.reviewOpen}
              </Link>
            </HelpTip>
          </div>
          <p className="text-sm text-muted">
            {STR.ws.overview.reviewPending}{" "}
            <span data-testid="me-review-pending" className="font-medium text-ink">
              {data.review.pending}
            </span>
          </p>
          <ul className="space-y-2">
            {data.review.items.map((a) => (
              <li
                key={`${a.type}/${a.name}`}
                data-testid="me-review-item"
                data-key={`${a.type}/${a.name}`}
                className="rounded-sf border border-line bg-surface px-3 py-2 text-sm"
              >
                <Link
                  to={`/artifacts/${a.type}/${a.name}`}
                  className="text-ink no-underline hover:underline"
                  translate="no"
                >
                  {a.type}/{a.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section data-testid="me-sessions-panel" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">{STR.ws.overview.sessions}</h2>
          <HelpTip action="sessions-delete">
            <button
              type="button"
              data-testid="me-sessions-delete"
              className="rounded-sf border border-line px-3 py-1.5 text-sm text-danger hover:bg-danger-bg"
              onClick={() => setDeleteOpen(true)}
              disabled={!data.sessions || data.sessions.facts === 0}
            >
              {STR.ws.overview.sessionsDelete}
            </button>
          </HelpTip>
        </div>
        <p className="text-sm text-muted" data-testid="me-sessions-facts">
          {STR.ws.overview.sessionsFacts}{" "}
          <strong className="text-ink">{data.sessions?.facts ?? 0}</strong>
        </p>
        {(data.sessions?.skills?.length ?? 0) === 0 ? (
          <div className="rounded-sf border border-dashed border-line bg-surface px-4 py-6 text-sm text-muted">
            {STR.ws.overview.sessionsEmptyRun}{" "}
            <code className="rounded-sf bg-surface-2 px-1 py-0.5 font-mono text-xs">
              skillforge sessions import
            </code>{" "}
            {STR.ws.overview.sessionsEmptyEnd}
          </div>
        ) : (
          <ul className="space-y-2">
            {data.sessions.skills.map((s) => (
              <li
                key={s.name}
                data-testid="me-sessions-skill"
                className="flex justify-between rounded-sf border border-line bg-surface px-3 py-2 text-sm"
              >
                <span className="font-medium text-ink" translate="no">
                  {s.name}
                </span>
                <span className="font-mono text-xs text-muted">{s.count}</span>
              </li>
            ))}
          </ul>
        )}
        <ConfirmDialog
          open={deleteOpen}
          title={STR.ws.overview.sessionsDeleteTitle}
          body={STR.ws.overview.sessionsDeleteBody}
          helpText={STR.ws.overview.sessionsDeleteHelp}
          helpTopic="actions/me/sessions-delete"
          confirmLabel={STR.ws.overview.sessionsDeleteConfirm}
          onConfirm={() => {
            deleteMut.mutate();
            setDeleteOpen(false);
          }}
          onCancel={() => setDeleteOpen(false)}
        />
      </section>

      <section data-testid="me-activity" className="space-y-3">
        <h2 className="text-base font-semibold text-ink">{STR.ws.overview.activity}</h2>
        {data.activity.length === 0 ? (
          <div
            data-testid="me-activity-empty"
            className="rounded-sf border border-dashed border-line bg-surface px-4 py-6 text-sm text-muted"
          >
            {STR.ws.overview.activityEmpty}
          </div>
        ) : (
          <ul className="space-y-2">
            {data.activity.map((e, i) => (
              <li
                key={`${e.ts}-${e.action}-${e.type}-${e.name}-${i}`}
                data-testid="me-activity-item"
                data-action={e.action}
                className="rounded-sf border border-line bg-surface px-3 py-2 text-sm"
              >
                <span className="font-medium text-ink" translate="no">
                  {e.action}
                </span>
                <span className="text-muted">
                  {" "}
                  {STR.ws.overview.activityOn}{" "}
                  <span translate="no">
                    {e.type}/{e.name}
                  </span>{" "}
                  {STR.ws.overview.activityBy} <span translate="no">{e.actor}</span>
                </span>
                <span className="ml-2 text-xs text-muted">
                  <RelativeTime iso={e.ts} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function OverviewInner() {
  const q = useQuery({ queryKey: ["me-overview"], queryFn: getMeOverview });

  useEffect(() => {
    document.title = STR.ws.overview.docTitle;
  }, []);

  if (q.isLoading) {
    return <p className="text-sm text-muted">{STR.ws.overview.loading}</p>;
  }
  if (q.isError || !q.data) {
    return (
      <p className="text-sm text-danger" data-testid="me-overview-error">
        {STR.ws.overview.loadFailed}
      </p>
    );
  }

  return <OverviewPage data={q.data} />;
}

export function Overview() {
  return <RequireUser>{() => <OverviewInner />}</RequireUser>;
}
