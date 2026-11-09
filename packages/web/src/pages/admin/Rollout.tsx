import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createRollout, listRollouts } from "../../api/client.ts";
import type { Rollout } from "../../api/types.ts";
import { RequireUser } from "../../components/RequireUser.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { HelpTip } from "../../components/HelpTip.tsx";
import { STR } from "../../lib/strings.ts";
import { errorText, formatDateTime } from "../../i18n/index.ts";

const lines = (s: string) =>
  s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

/** "skill/name" lines into artifact references; anything else is passed as is and refused by the server. */
function artifactsOf(s: string) {
  return lines(s).map((l) => {
    const [type = "", name = ""] = l.split("/");
    return { type, name };
  });
}

function Results({ rollout }: { rollout: Rollout }) {
  return (
    <ul className="space-y-1 text-sm">
      {rollout.results.map((r) => (
        <li key={r.repo} data-testid="rollout-result" data-status={r.status}>
          <span translate="no" className="font-mono text-xs">
            {r.repo}
          </span>{" "}
          {r.status === "opened" && r.pr_url ? (
            <a href={r.pr_url} target="_blank" rel="noreferrer" className="text-accent">
              {STR.adm.rollout.opened}
            </a>
          ) : (
            <span className="text-danger">
              {STR.adm.rollout.failed}: {r.error}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function RolloutPage() {
  const S = STR.adm.rollout;
  const queryClient = useQueryClient();
  const [repos, setRepos] = useState("");
  const [artifacts, setArtifacts] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    document.title = S.docTitle;
  }, [S.docTitle]);
  const q = useQuery({ queryKey: ["rollouts"], queryFn: listRollouts });
  const run = useMutation({
    mutationFn: () => createRollout({ repos: lines(repos), artifacts: artifactsOf(artifacts) }),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["rollouts"] });
    },
    onError: (e) => setError(errorText(e)),
  });
  const area = "w-full rounded-sf border border-line bg-bg px-2 py-1 font-mono text-sm";
  return (
    <div className="space-y-6">
      <PageHeader title={S.title} topic="pages/admin-rollout" />
      <p className="text-sm text-ink-2">{S.description}</p>
      {q.data && !q.data.configured ? (
        <p data-testid="rollout-not-configured" className="text-sm text-warning">
          {S.notConfigured}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm text-ink-2">
          <span>{S.repos}</span>
          <textarea
            data-testid="rollout-repos"
            rows={5}
            className={area}
            value={repos}
            onChange={(e) => setRepos(e.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm text-ink-2">
          <span>{S.artifacts}</span>
          <textarea
            data-testid="rollout-artifacts"
            rows={5}
            className={area}
            value={artifacts}
            onChange={(e) => setArtifacts(e.target.value)}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <HelpTip action="rollout-start">
          <button
            type="button"
            data-testid="rollout-start"
            disabled={run.isPending || !q.data?.configured}
            onClick={() => run.mutate()}
            className="rounded-sf bg-accent px-3 py-1.5 text-accent-fg disabled:opacity-50"
          >
            {S.start}
          </button>
        </HelpTip>
        {error ? <span className="text-sm text-danger">{error}</span> : null}
      </div>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink">{S.history}</h2>
        {(q.data?.items ?? []).length === 0 ? (
          <p className="text-sm text-ink-2">{S.empty}</p>
        ) : null}
        {(q.data?.items ?? []).map((r) => (
          <div
            key={r.id}
            data-testid="rollout"
            className="space-y-1 rounded-sf border border-line bg-surface p-3"
          >
            <p className="text-xs text-muted">
              {formatDateTime(r.created_at)} · {r.created_by} ·{" "}
              <span translate="no" className="font-mono">
                {r.request.artifacts.map((a) => `${a.type}/${a.name}`).join(", ")}
              </span>
            </p>
            <Results rollout={r} />
          </div>
        ))}
      </section>
    </div>
  );
}

export function AdminRollout() {
  return <RequireUser requireAdmin>{() => <RolloutPage />}</RequireUser>;
}
