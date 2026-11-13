import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createHarvest, draftFromHarvest, listHarvests } from "../../api/client.ts";
import type { Harvest } from "../../api/types.ts";
import { RequireUser } from "../../components/RequireUser.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { HelpTip } from "../../components/HelpTip.tsx";
import { STR } from "../../lib/strings.ts";
import { errorText, formatDateTime } from "../../i18n/index.ts";
import { Button } from "../../components/Button.tsx";

const input = "rounded-sf border border-line bg-bg px-2 py-1 text-sm";

function Draft({ harvest }: { harvest: Harvest }) {
  const S = STR.adm.harvest;
  const [name, setName] = useState("");
  const [type, setType] = useState<"rule" | "skill">("rule");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const make = useMutation({
    mutationFn: () => draftFromHarvest(harvest.id, name.trim(), type),
    onSuccess: () => setResult({ ok: true, text: name.trim() }),
    onError: (e) => setResult({ ok: false, text: errorText(e) }),
  });
  if (harvest.rules.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        data-testid="harvest-draft-name"
        className={`${input} font-mono`}
        placeholder={S.draftName}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <HelpTip action="harvest-draft-type">
        <select
          data-testid="harvest-draft-type"
          aria-label={S.draftType}
          className={input}
          value={type}
          onChange={(e) => setType(e.target.value === "skill" ? "skill" : "rule")}
        >
          <option value="rule">{S.draftAsRule}</option>
          <option value="skill">{S.draftAsSkill}</option>
        </select>
      </HelpTip>
      <HelpTip action="harvest-draft">
        <Button
          type="button"
          data-testid="harvest-draft"
          pending={make.isPending}
          disabled={!name.trim()}
          onClick={() => make.mutate()}
          className="rounded-sf border border-line px-3 py-1 text-sm hover:bg-surface-2 disabled:opacity-50"
        >
          {S.draft}
        </Button>
      </HelpTip>
      {result?.ok ? (
        <Link
          translate="no"
          to={`/artifacts/${type}/${result.text}`}
          className="text-sm text-accent"
        >
          {S.draftDone}
        </Link>
      ) : result ? (
        <span className="text-sm text-danger">{result.text}</span>
      ) : null}
    </div>
  );
}

function HarvestCard({ harvest }: { harvest: Harvest }) {
  const S = STR.adm.harvest;
  return (
    <div data-testid="harvest" className="space-y-2 rounded-sf border border-line bg-surface p-3">
      <p className="text-xs text-muted">
        {formatDateTime(harvest.created_at)} · {harvest.created_by} ·{" "}
        <span translate="no" className="font-mono">
          {harvest.request.repo}
        </span>{" "}
        · {S.days(harvest.request.days)}
      </p>
      {harvest.rules.length === 0 ? <p className="text-sm text-ink-2">{S.noRules}</p> : null}
      <ul className="space-y-2 text-sm">
        {harvest.rules.map((r) => (
          <li key={r.text} data-testid="harvest-rule">
            <span>{r.text}</span>{" "}
            <span className="text-xs text-muted">{S.times(r.count, r.sources)}</span>
            <ul className="ml-4 list-disc text-xs">
              {r.evidence.slice(0, 5).map((e) => (
                <li key={e}>
                  <a href={e} target="_blank" rel="noreferrer" className="break-all text-accent">
                    {e}
                  </a>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <Draft harvest={harvest} />
    </div>
  );
}

function HarvestPage() {
  const S = STR.adm.harvest;
  const queryClient = useQueryClient();
  const [repo, setRepo] = useState("");
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    document.title = S.docTitle;
  }, [S.docTitle]);
  const q = useQuery({ queryKey: ["harvests"], queryFn: listHarvests });
  const run = useMutation({
    mutationFn: () => createHarvest({ source: "github", repo: repo.trim(), days }),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["harvests"] });
    },
    onError: (e) => setError(errorText(e)),
  });
  return (
    <div className="space-y-6">
      <PageHeader title={S.title} topic="pages/admin-harvest" />
      <p className="text-sm text-ink-2">{S.description}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          {S.repo}
          <input
            data-testid="harvest-repo"
            className={`${input} font-mono`}
            placeholder={S.repoPlaceholder}
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {S.period}
          <input
            type="number"
            min={1}
            max={365}
            data-testid="harvest-days"
            className={`${input} w-24`}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          />
        </label>
        <HelpTip action="harvest-run">
          <Button
            type="button"
            data-testid="harvest-run"
            pending={run.isPending}
            disabled={!repo.trim()}
            onClick={() => run.mutate()}
            className="rounded-sf bg-accent px-3 py-1.5 text-accent-fg disabled:opacity-50"
          >
            {S.run}
          </Button>
        </HelpTip>
        {error ? <span className="text-sm text-danger">{error}</span> : null}
      </div>
      <p className="text-xs text-ink-2">{S.sessionsNote}</p>
      <section className="space-y-3">
        {(q.data?.items ?? []).length === 0 ? (
          <p className="text-sm text-ink-2">{S.empty}</p>
        ) : null}
        {(q.data?.items ?? []).map((h) => (
          <HarvestCard key={h.id} harvest={h} />
        ))}
      </section>
    </div>
  );
}

export function AdminHarvest() {
  return <RequireUser requireAdmin>{() => <HarvestPage />}</RequireUser>;
}
