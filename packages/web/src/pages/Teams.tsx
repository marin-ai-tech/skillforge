import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, createTeam, listTeams } from "../api/client.ts";
import { RequireUser } from "../components/RequireUser.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { HelpTip } from "../components/HelpTip.tsx";
import { ErrorState } from "../components/ErrorState.tsx";
import { Skeleton } from "../components/Skeleton.tsx";
import { roleAtLeast } from "../lib/auth.tsx";
import { STR } from "../lib/strings.ts";
import { errorText } from "../i18n/index.ts";
import { Button } from "../components/Button.tsx";

function humanTeamError(err: unknown): string {
  if (!(err instanceof ApiError)) return STR.ws.teams.errors.requestFailed;
  const known = (STR.ws.teams.errors as Record<string, string | undefined>)[err.error];
  return known ?? errorText(err);
}

function TeamsInner({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [lead, setLead] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = STR.ws.teams.docTitle;
  }, []);

  const teamsQ = useQuery({
    queryKey: ["teams"],
    queryFn: listTeams,
    staleTime: 15_000,
  });

  const createMut = useMutation({
    mutationFn: () => createTeam({ name: name.trim(), lead: lead.trim() }),
    onSuccess: async () => {
      setName("");
      setLead("");
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["teams"] });
    },
    onError: (err: unknown) => setError(humanTeamError(err)),
  });

  function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    createMut.mutate();
  }

  return (
    <div className="space-y-4">
      <PageHeader title={STR.ws.teams.title} topic="pages/teams" />

      {isAdmin ? (
        <form
          onSubmit={onCreate}
          className="space-y-3 rounded-sf border border-line bg-surface p-4"
        >
          <div className="text-sm font-medium text-ink">{STR.ws.teams.createTitle}</div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-sm text-muted">
              {STR.ws.teams.name}
              <input
                className="mt-1 block w-48 rounded-sf border border-line bg-bg px-2 py-1.5 font-mono text-sm text-ink"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={STR.ws.teams.namePlaceholder}
                autoComplete="off"
                required
              />
            </label>
            <label className="block text-sm text-muted">
              {STR.ws.teams.lead}
              <input
                className="mt-1 block w-48 rounded-sf border border-line bg-bg px-2 py-1.5 font-mono text-sm text-ink"
                value={lead}
                onChange={(e) => setLead(e.target.value)}
                placeholder={STR.ws.teams.leadPlaceholder}
                autoComplete="off"
                required
              />
            </label>
            <HelpTip action="team-create">
              <Button
                type="submit"
                data-testid="team-create"
                className="rounded-sf bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                pending={createMut.isPending}
                disabled={!name.trim() || !lead.trim()}
              >
                {STR.ws.teams.create}
              </Button>
            </HelpTip>
            {error ? (
              <span data-testid="team-create-error" className="text-xs text-danger">
                {error}
              </span>
            ) : null}
          </div>
        </form>
      ) : null}

      {teamsQ.isError ? (
        <ErrorState onRetry={() => void teamsQ.refetch()} />
      ) : teamsQ.isLoading ? (
        <Skeleton className="h-32" />
      ) : (
        <ul
          data-testid="teams-list"
          className="divide-y divide-line rounded-sf border border-line bg-surface"
        >
          {(teamsQ.data?.items ?? []).map((t) => (
            <li
              key={t.name}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
            >
              <div>
                <Link
                  to={`/teams/${encodeURIComponent(t.name)}`}
                  className="font-mono text-sm font-medium text-accent no-underline hover:underline"
                >
                  {t.name}
                </Link>
                {t.display_name ? (
                  <span className="ml-2 text-sm text-muted" translate="no">
                    {t.display_name}
                  </span>
                ) : null}
                {t.description ? (
                  <p className="mt-0.5 text-xs text-ink-2" translate="no">
                    {t.description}
                  </p>
                ) : null}
              </div>
              <div className="text-xs text-muted">
                {t.members_count === null ? "—" : STR.ws.teams.members(t.members_count)}
                {t.is_member ? STR.ws.teams.memberMark : ""}
              </div>
            </li>
          ))}
          {(teamsQ.data?.items ?? []).length === 0 ? (
            <li className="px-4 py-6 text-sm text-muted">{STR.ws.teams.empty}</li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

export function Teams() {
  return (
    <RequireUser>{(user) => <TeamsInner isAdmin={roleAtLeast(user.role, "admin")} />}</RequireUser>
  );
}
