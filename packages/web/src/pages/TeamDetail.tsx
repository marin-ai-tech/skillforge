import { TeamRubricPanel } from "../components/QualityRubricPanels.tsx";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, addTeamMember, getTeam, removeTeamMember } from "../api/client.ts";
import { RequireUser } from "../components/RequireUser.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { HelpTip } from "../components/HelpTip.tsx";
import { ErrorState } from "../components/ErrorState.tsx";
import { Skeleton } from "../components/Skeleton.tsx";
import { NotFound } from "./NotFound.tsx";
import { roleAtLeast } from "../lib/auth.tsx";
import type { MeUser } from "../api/client.ts";
import { STR } from "../lib/strings.ts";
import { errorText } from "../i18n/index.ts";

function humanMemberError(err: unknown): string {
  if (!(err instanceof ApiError)) return STR.ws.teamDetail.errors.requestFailed;
  const known = (STR.ws.teamDetail.errors as Record<string, string | undefined>)[err.error];
  return known ?? errorText(err);
}

/** Interface label of a team role; an unknown role from the server is shown as is. */
function roleLabel(role: string): string {
  return (STR.ws.teamDetail.roles as Record<string, string | undefined>)[role] ?? role;
}

type TeamMembers = NonNullable<Awaited<ReturnType<typeof getTeam>>["members"]>;

/** Admins and team leads manage members. */
function canManageMembers(user: MeUser, members: TeamMembers | null | undefined): boolean {
  const isAdmin = roleAtLeast(user.role, "admin");
  const myRole =
    members?.find((m) => m.username.toLowerCase() === user.username.toLowerCase())?.role ?? null;
  return isAdmin || myRole === "lead";
}

function AddMemberForm({
  username,
  setUsername,
  role,
  setRole,
  addError,
  setAddError,
  addMut,
}: {
  username: string;
  setUsername: (v: string) => void;
  role: "member" | "lead";
  setRole: (v: "member" | "lead") => void;
  addError: string | null;
  setAddError: (v: string | null) => void;
  addMut: { isPending: boolean; mutate: () => void };
}) {
  return (
    <form
      className="flex flex-wrap items-end gap-2 border-t border-line pt-3"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        setAddError(null);
        addMut.mutate();
      }}
    >
      <label className="block text-sm text-muted">
        {STR.ws.teamDetail.username}
        <input
          className="mt-1 block w-48 rounded-sf border border-line bg-bg px-2 py-1.5 font-mono text-sm text-ink"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="off"
          required
        />
      </label>
      <label className="block text-sm text-muted">
        {STR.ws.teamDetail.role}
        <select
          className="mt-1 block w-32 rounded-sf border border-line bg-bg px-2 py-1.5 text-sm text-ink"
          value={role}
          onChange={(e) => setRole(e.target.value as "member" | "lead")}
        >
          <option value="member">{STR.ws.teamDetail.roles.member}</option>
          <option value="lead">{STR.ws.teamDetail.roles.lead}</option>
        </select>
      </label>
      <HelpTip action="team-member-add">
        <button
          type="submit"
          data-testid="team-member-add"
          className="rounded-sf bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          disabled={addMut.isPending || !username.trim()}
        >
          {STR.ws.teamDetail.addMember}
        </button>
      </HelpTip>
      {addError ? (
        <span data-testid="team-member-add-error" className="text-xs text-danger">
          {addError}
        </span>
      ) : null}
    </form>
  );
}

function TeamDetailInner({ user }: { user: MeUser }) {
  const { name = "" } = useParams();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<"member" | "lead">("member");
  const [addError, setAddError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => {
    if (name) document.title = STR.ws.teamDetail.docTitle(name);
  }, [name]);

  const teamQ = useQuery({
    queryKey: ["team", name],
    queryFn: () => getTeam(name),
    enabled: !!name,
    retry: false,
  });

  const members = teamQ.data?.members;
  const canManage = canManageMembers(user, members);

  const addMut = useMutation({
    mutationFn: () => addTeamMember(name, username.trim(), role),
    onSuccess: async () => {
      setUsername("");
      setAddError(null);
      await queryClient.invalidateQueries({ queryKey: ["team", name] });
      await queryClient.invalidateQueries({ queryKey: ["teams"] });
    },
    onError: (err: unknown) => setAddError(humanMemberError(err)),
  });

  const removeMut = useMutation({
    mutationFn: (u: string) => removeTeamMember(name, u),
    onSuccess: async () => {
      setRemoveError(null);
      await queryClient.invalidateQueries({ queryKey: ["team", name] });
      await queryClient.invalidateQueries({ queryKey: ["teams"] });
    },
    onError: (err: unknown) => setRemoveError(humanMemberError(err)),
  });

  if (teamQ.isError) {
    const err = teamQ.error;
    if (err instanceof ApiError && err.status === 404) return <NotFound name={name} />;
    return (
      <div className="space-y-4">
        <PageHeader title={name || STR.ws.teamDetail.fallbackTitle} topic="pages/teams" />
        <ErrorState onRetry={() => void teamQ.refetch()} />
      </div>
    );
  }

  if (teamQ.isLoading || !teamQ.data) {
    return (
      <div className="space-y-4">
        <PageHeader title={name || STR.ws.teamDetail.fallbackTitle} topic="pages/teams" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const team = teamQ.data;

  return (
    <div className="space-y-4">
      <PageHeader title={team.name} topic="pages/teams" />
      <p className="text-sm text-muted">
        <Link to="/teams" className="text-accent no-underline hover:underline">
          {STR.ws.teamDetail.back}
        </Link>
      </p>
      {team.display_name ? (
        <p className="text-sm text-ink-2" translate="no">
          {team.display_name}
        </p>
      ) : null}
      {team.description ? (
        <p className="text-sm text-ink-2" translate="no">
          {team.description}
        </p>
      ) : null}

      {members ? (
        <div className="space-y-3 rounded-sf border border-line bg-surface p-4">
          <div className="text-sm font-medium text-ink">{STR.ws.teamDetail.members}</div>
          <ul data-testid="team-members" className="space-y-2">
            {members.map((m) => (
              <li key={m.username} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono">{m.username}</span>
                <span className="rounded-sf bg-surface-2 px-1.5 py-0.5 text-xs text-muted">
                  {roleLabel(m.role)}
                </span>
                {canManage ? (
                  <HelpTip action="team-member-remove">
                    <button
                      type="button"
                      data-testid={`team-member-remove-${m.username}`}
                      className="rounded-sf border border-line px-2 py-0.5 text-xs text-ink-2 hover:border-danger hover:text-danger disabled:opacity-50"
                      disabled={removeMut.isPending}
                      onClick={() => {
                        setRemoveError(null);
                        removeMut.mutate(m.username);
                      }}
                    >
                      {STR.ws.teamDetail.remove}
                    </button>
                  </HelpTip>
                ) : null}
              </li>
            ))}
          </ul>
          {removeError ? (
            <p data-testid="team-member-remove-error" className="text-xs text-danger">
              {removeError}
            </p>
          ) : null}

          {canManage ? (
            <>
              <AddMemberForm
                username={username}
                setUsername={setUsername}
                role={role}
                setRole={setRole}
                addError={addError}
                setAddError={setAddError}
                addMut={addMut}
              />
              <TeamRubricPanel team={name} />
            </>
          ) : null}
        </div>
      ) : (
        <p data-testid="team-members-hidden" className="text-sm text-muted">
          {STR.ws.teamDetail.hidden}
        </p>
      )}
    </div>
  );
}

export function TeamDetail() {
  return <RequireUser>{(user) => <TeamDetailInner user={user} />}</RequireUser>;
}
