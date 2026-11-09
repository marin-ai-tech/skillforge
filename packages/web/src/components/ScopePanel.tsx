import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, listTeams, putArtifactScope } from "../api/client.ts";
import type { ArtifactSummary } from "../api/types.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { HelpTip } from "./HelpTip.tsx";
import { roleAtLeast, useMe } from "../lib/auth.tsx";
import { STR } from "../lib/strings.ts";
import { errorText } from "../i18n/index.ts";

type Props = { artifact: ArtifactSummary; canEdit: boolean };

function humanScopeError(err: unknown): string {
  const t = STR.art.scope.errors;
  if (!(err instanceof ApiError)) return STR.art.common.requestFailed;
  switch (err.error) {
    case "team_required":
      return t.teamRequired;
    case "team_unknown":
      return t.teamUnknown;
    case "not_team_member":
      return t.notTeamMember;
    case "forbidden":
      return t.forbidden;
    case "mcp_token_forbidden":
      return t.mcpForbidden;
    case "bad_request":
      return err.message && err.message !== err.error ? err.message : STR.art.common.invalidRequest;
    default:
      return err.message && err.message !== err.error
        ? `${err.error}: ${errorText(err)}`
        : err.error;
  }
}

export function ScopePanel({ artifact, canEdit }: Props) {
  const me = useMe();
  const queryClient = useQueryClient();
  const [visibility, setVisibility] = useState(artifact.visibility === "team" ? "team" : "org");
  const [team, setTeam] = useState(artifact.owner_team ?? "");
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teamsQ = useQuery({
    queryKey: ["teams"],
    queryFn: listTeams,
    enabled: !!me.data && canEdit,
    staleTime: 30_000,
  });

  const myTeams = useMemo(
    () =>
      (teamsQ.data?.items ?? []).filter((t) => t.is_member || roleAtLeast(me.data?.role, "admin")),
    [teamsQ.data, me.data?.role],
  );

  const narrowing = artifact.visibility === "org" && visibility === "team";
  const widening = artifact.visibility === "team" && visibility === "org";
  const needsConfirm = narrowing || widening;

  const mut = useMutation({
    mutationFn: () =>
      putArtifactScope(artifact.type, artifact.name, {
        visibility,
        owner_team: visibility === "team" ? team : null,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    onSuccess: async () => {
      setConfirmOpen(false);
      setError(null);
      setReason("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["artifact", artifact.type, artifact.name] }),
        queryClient.invalidateQueries({ queryKey: ["audit", artifact.type, artifact.name] }),
        queryClient.invalidateQueries({ queryKey: ["artifacts"] }),
      ]);
    },
    onError: (err: unknown) => {
      setConfirmOpen(false);
      setError(humanScopeError(err));
    },
  });

  if (!canEdit) return null;

  function save() {
    setError(null);
    if (visibility === "team" && !team.trim()) {
      setError(STR.art.scope.chooseTeam);
      return;
    }
    if (needsConfirm) setConfirmOpen(true);
    else mut.mutate();
  }

  return (
    <>
      <div
        data-testid="scope-panel"
        className="space-y-3 rounded-sf border border-line bg-surface-2 p-3"
      >
        <div className="text-xs uppercase tracking-wide text-muted">{STR.art.scope.title}</div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-sm text-muted">
            {STR.art.scope.visibility}
            <select
              data-testid="scope-visibility"
              className="mt-1 block w-40 rounded-sf border border-line bg-bg px-2 py-1.5 text-sm text-ink"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
            >
              <option value="org">org</option>
              <option value="team">team</option>
            </select>
          </label>
          {visibility === "team" ? (
            <label className="block text-sm text-muted">
              {STR.art.scope.team}
              <select
                data-testid="scope-team"
                className="mt-1 block w-48 rounded-sf border border-line bg-bg px-2 py-1.5 font-mono text-sm text-ink"
                value={team}
                onChange={(e) => setTeam(e.target.value)}
              >
                <option value="">{STR.art.scope.selectTeam}</option>
                {myTeams.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="block text-sm text-muted">
            {STR.art.common.reason}
            <input
              data-testid="scope-reason"
              className="mt-1 block w-64 rounded-sf border border-line bg-bg px-2 py-1.5 text-sm text-ink"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoComplete="off"
            />
          </label>
          <HelpTip action="scope-save">
            <button
              type="button"
              data-testid="scope-save"
              className="rounded-sf bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              disabled={mut.isPending}
              onClick={save}
            >
              {STR.art.scope.save}
            </button>
          </HelpTip>
          {error ? (
            <span data-testid="scope-error" className="text-xs text-danger">
              {error}
            </span>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={narrowing ? STR.art.scope.narrowTitle : STR.art.scope.widenTitle}
        body={
          narrowing
            ? STR.art.scope.narrowBody(`${artifact.type}/${artifact.name}`, team)
            : STR.art.scope.widenBody(`${artifact.type}/${artifact.name}`)
        }
        helpText={STR.art.scope.help}
        helpTopic="getting-started/visibility"
        confirmLabel={STR.art.common.confirm}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => mut.mutate()}
      />
    </>
  );
}
