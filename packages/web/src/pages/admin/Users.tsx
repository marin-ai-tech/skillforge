import { OrphansPanel } from "../../components/OrphansPanel.tsx";
import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, createUser, getAuthProviders, listUsers, updateUser } from "../../api/client.ts";
import type { AdminUser, Role } from "../../api/types.ts";
import { RequireUser } from "../../components/RequireUser.tsx";
import { RelativeTime } from "../../components/RelativeTime.tsx";
import { STR } from "../../lib/strings.ts";
import { errorText } from "../../i18n/index.ts";
import { PageHeader } from "../../components/PageHeader.tsx";
import { HelpTip } from "../../components/HelpTip.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { Button } from "../../components/Button.tsx";

const ROLES: Role[] = ["viewer", "contributor", "reviewer", "admin"];

function formatError(err: unknown): string {
  if (err instanceof ApiError) {
    const text = errorText(err);
    return text && text !== err.error ? `${err.error}: ${text}` : err.error;
  }
  return errorText(err);
}

function UsersPage() {
  const queryClient = useQueryClient();
  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: listUsers,
  });
  const providersQuery = useQuery({
    queryKey: ["auth-providers"],
    queryFn: getAuthProviders,
    staleTime: 60_000,
  });

  function sourceLabel(source: string | undefined): string {
    if (!source || source === "password") return STR.adm.users.sourcePassword;
    if (source === "local") return STR.adm.users.sourceLocal;
    if (source.startsWith("oidc:") || source.startsWith("ldap:")) {
      const id = source.startsWith("oidc:")
        ? source.slice("oidc:".length)
        : source.slice("ldap:".length);
      const p = providersQuery.data?.providers.find((x) => x.id === id);
      return p?.label ?? id;
    }
    return source;
  }

  function isExternalSource(source: string | undefined): boolean {
    return typeof source === "string" && (source.startsWith("oidc:") || source.startsWith("ldap:"));
  }
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("contributor");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [disableUser, setDisableUser] = useState<AdminUser | null>(null);

  useEffect(() => {
    document.title = STR.adm.users.docTitle;
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const createMut = useMutation({
    mutationFn: createUser,
    onSuccess: async () => {
      setError(null);
      setNotice(STR.admin.noticeCreated);
      setUsername("");
      setDisplayName("");
      setPassword("");
      setRole("contributor");
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => setError(formatError(err)),
  });

  const updateMut = useMutation({
    mutationFn: (args: {
      id: string;
      body: Parameters<typeof updateUser>[1];
      onFail?: () => void;
      noticeText?: string;
    }) => updateUser(args.id, args.body),
    onSuccess: async (_data, vars) => {
      setError(null);
      if (vars.noticeText) setNotice(vars.noticeText);
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err, vars) => {
      setError(formatError(err));
      vars.onFail?.();
    },
  });

  function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    createMut.mutate({
      username,
      password,
      role,
      display_name: displayName || undefined,
    });
  }

  function onRoleChange(user: AdminUser, next: Role) {
    const prev = user.role;
    setError(null);
    // optimistic display via controlled select reading from query data after invalidate;
    // on fail, revert by forcing query cache role back
    updateMut.mutate({
      id: user.id,
      body: { role: next },
      noticeText: STR.admin.noticeUpdated,
      onFail: () => {
        queryClient.setQueryData(["users"], (old: { items: AdminUser[] } | undefined) => {
          if (!old) return old;
          return {
            items: old.items.map((u) => (u.id === user.id ? { ...u, role: prev } : u)),
          };
        });
      },
    });
    // optimistic
    queryClient.setQueryData(["users"], (old: { items: AdminUser[] } | undefined) => {
      if (!old) return old;
      return {
        items: old.items.map((u) => (u.id === user.id ? { ...u, role: next } : u)),
      };
    });
  }

  function onToggleDisabled(user: AdminUser) {
    setError(null);
    updateMut.mutate({
      id: user.id,
      body: { disabled: !user.disabled },
      noticeText: STR.admin.noticeUpdated,
    });
  }

  function onResetSubmit(user: AdminUser) {
    setError(null);
    updateMut.mutate(
      {
        id: user.id,
        body: { password: newPassword },
        noticeText: STR.admin.noticePassword,
      },
      {
        onSuccess: () => {
          setResetFor(null);
          setNewPassword("");
        },
      },
    );
  }

  const items = usersQuery.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title={STR.admin.title} topic="pages/users" />

      {error ? (
        <div
          data-testid="admin-error"
          className="rounded-sf bg-danger-bg px-2 py-1.5 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}
      {notice ? (
        <div
          data-testid="admin-notice"
          className="rounded-sf bg-accent/10 px-2 py-1.5 text-sm text-accent"
        >
          {notice}
        </div>
      ) : null}

      <form
        data-testid="user-create"
        className="grid gap-3 rounded-sf border border-line bg-surface p-4 sm:grid-cols-2"
        onSubmit={onCreate}
      >
        <h2 className="sm:col-span-2 text-sm font-medium">{STR.admin.createTitle}</h2>
        <label className="block text-sm">
          <span className="text-muted">{STR.admin.username}</span>
          <HelpTip action="create-username">
            <input
              data-testid="create-username"
              className="mt-1 w-full rounded-sf border border-line bg-bg px-3 py-1.5 text-sm"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </HelpTip>
        </label>
        <label className="block text-sm">
          <span className="text-muted">{STR.admin.displayName}</span>
          <HelpTip action="create-display-name">
            <input
              data-testid="create-display-name"
              className="mt-1 w-full rounded-sf border border-line bg-bg px-3 py-1.5 text-sm"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </HelpTip>
        </label>
        <label className="block text-sm">
          <span className="text-muted">{STR.admin.password}</span>
          <HelpTip action="create-password">
            <input
              data-testid="create-password"
              type="password"
              className="mt-1 w-full rounded-sf border border-line bg-bg px-3 py-1.5 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </HelpTip>
        </label>
        <label className="block text-sm">
          <span className="text-muted">{STR.admin.role}</span>
          <HelpTip action="create-role">
            <select
              data-testid="create-role"
              className="mt-1 w-full rounded-sf border border-line bg-bg px-3 py-1.5 text-sm"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </HelpTip>
        </label>
        <div className="sm:col-span-2">
          <HelpTip action="create-submit">
            <Button
              type="submit"
              data-testid="create-submit"
              pending={createMut.isPending}
              className="rounded-sf bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {createMut.isPending ? STR.admin.submitting : STR.admin.submit}
            </Button>
          </HelpTip>
        </div>
      </form>

      <div className="overflow-x-auto rounded-sf border border-line">
        <table data-testid="users-table" className="w-full text-left text-sm">
          <thead className="bg-surface-2 text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">{STR.adm.users.colUsername}</th>
              <th className="px-3 py-2 font-medium">{STR.adm.users.colSource}</th>
              <th className="px-3 py-2 font-medium">{STR.adm.users.colDisplayName}</th>
              <th className="px-3 py-2 font-medium">{STR.adm.users.colRole}</th>
              <th className="px-3 py-2 font-medium">{STR.adm.users.colStatus}</th>
              <th className="px-3 py-2 font-medium">{STR.admin.created}</th>
              <th className="px-3 py-2 font-medium">{STR.adm.users.colActions}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => (
              <tr
                key={u.id}
                data-testid="user-row"
                data-username={u.username}
                className="border-t border-line"
              >
                <td className="px-3 py-2 font-medium" translate="no">
                  {u.username}
                </td>
                <td className="px-3 py-2">
                  <span
                    data-testid="user-source"
                    translate={isExternalSource(u.source) ? "no" : undefined}
                    className="inline-flex rounded-sf bg-surface-2 px-1.5 py-0.5 text-xs"
                  >
                    {sourceLabel(u.source)}
                  </span>
                </td>
                <td className="px-3 py-2 text-ink-2" translate="no">
                  {u.display_name ?? "\u2014"}
                </td>
                <td className="px-3 py-2">
                  <span className="mr-2 inline-flex rounded-sf bg-surface-2 px-1.5 py-0.5 text-xs">
                    {u.role}
                  </span>
                  <HelpTip action="user-role-select">
                    <select
                      data-testid="user-role-select"
                      className="rounded-sf border border-line bg-bg px-2 py-1 text-sm"
                      value={u.role}
                      onChange={(e) => onRoleChange(u, e.target.value as Role)}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </HelpTip>
                </td>
                <td className="px-3 py-2">{u.disabled ? STR.admin.disabled : STR.admin.active}</td>
                <td className="px-3 py-2">
                  <RelativeTime iso={u.created_at} />
                </td>
                <td className="px-3 py-2 space-y-2">
                  <HelpTip action="user-disable-toggle">
                    <button
                      type="button"
                      data-testid="user-disable-toggle"
                      className="mr-2 rounded-sf border border-line px-2 py-1 text-xs hover:bg-surface-2"
                      onClick={() => {
                        if (u.disabled) onToggleDisabled(u);
                        else setDisableUser(u);
                      }}
                    >
                      {u.disabled ? STR.admin.enable : STR.admin.disable}
                    </button>
                  </HelpTip>
                  {!isExternalSource(u.source) && u.username !== "local" ? (
                    <HelpTip action="user-reset-password">
                      <button
                        type="button"
                        data-testid="user-reset-password"
                        className="rounded-sf border border-line px-2 py-1 text-xs hover:bg-surface-2"
                        onClick={() => {
                          setResetFor(u.id);
                          setNewPassword("");
                        }}
                      >
                        {STR.admin.resetPassword}
                      </button>
                    </HelpTip>
                  ) : null}
                  {resetFor === u.id ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <HelpTip action="user-new-password">
                        <input
                          data-testid="user-new-password"
                          type="password"
                          className="rounded-sf border border-line bg-bg px-2 py-1 text-sm"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder={STR.admin.newPassword}
                        />
                      </HelpTip>
                      <HelpTip action="user-reset-submit">
                        <button
                          type="button"
                          data-testid="user-reset-submit"
                          className="rounded-sf bg-accent px-2 py-1 text-xs text-white"
                          onClick={() => onResetSubmit(u)}
                        >
                          {STR.admin.resetSubmit}
                        </button>
                      </HelpTip>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <OrphansPanel />

      <ConfirmDialog
        open={disableUser != null}
        title={STR.adm.users.disableTitle}
        body={disableUser ? STR.adm.users.disableBody(disableUser.username) : ""}
        helpText={STR.adm.users.disableHelp}
        helpTopic="actions/users/disable"
        confirmLabel={STR.admin.disable}
        onConfirm={() => {
          if (disableUser) onToggleDisabled(disableUser);
          setDisableUser(null);
        }}
        onCancel={() => setDisableUser(null)}
      />
    </div>
  );
}

export function Users() {
  return <RequireUser requireAdmin>{() => <UsersPage />}</RequireUser>;
}
