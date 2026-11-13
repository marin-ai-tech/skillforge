import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  getNotificationPrefs,
  listNotifications,
  markNotificationsRead,
  putNotificationPrefs,
  type NotificationPrefs,
  type NotificationDto,
} from "../../api/client.ts";
import { RequireUser } from "../../components/RequireUser.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { HelpTip } from "../../components/HelpTip.tsx";
import { isSafeInternalPath } from "../../lib/comment-text.tsx";
import { STR } from "../../lib/strings.ts";
import { errorText, formatDateTime } from "../../i18n/index.ts";
import { Button } from "../../components/Button.tsx";

const PREF_KINDS = [
  "comment",
  "mention",
  "new_version",
  "status_change",
  "plugin",
  "source",
] as const;

/** Interface label of a notification kind; an unknown kind from the server is shown as is. */
/** A title in the reader's language for kinds with an artifact; plugins and others keep the server's own title. */
function notificationTitle(n: NotificationDto): string {
  const build = STR.ws.notifications.titles[n.kind];
  return build && n.artifact ? build(`${n.artifact.type}/${n.artifact.name}`) : n.title;
}

function kindLabel(kind: string): string {
  return (STR.ws.notifications.kinds as Record<string, string | undefined>)[kind] ?? kind;
}

function PrefsPanel({ prefs }: { prefs: NotificationPrefs }) {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: (patch: Partial<NotificationPrefs>) => putNotificationPrefs(patch),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["notification-prefs"] });
    },
  });

  return (
    <section
      data-testid="notification-prefs"
      className="rounded-sf border border-line bg-surface p-4 text-sm"
    >
      <h2 className="mb-2 font-medium">{STR.ws.notifications.prefsTitle}</h2>
      <ul className="space-y-2">
        {PREF_KINDS.map((kind) => {
          const locked = kind === "mention";
          return (
            <li key={kind} className="flex items-center gap-2">
              <input
                id={`notif-pref-${kind}`}
                data-testid={`notif-pref-${kind}`}
                type="checkbox"
                checked={prefs[kind]}
                disabled={locked}
                aria-disabled={mut.isPending || undefined}
                onChange={(e) => {
                  // Focus stays on the checkbox while it saves; a change meanwhile is ignored.
                  if (locked || mut.isPending) return;
                  mut.mutate({ [kind]: e.target.checked });
                }}
              />
              <label htmlFor={`notif-pref-${kind}`} className="text-ink-2">
                {kindLabel(kind)}
                {locked ? STR.ws.notifications.alwaysOn : ""}
              </label>
            </li>
          );
        })}
      </ul>
      {mut.isError ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {mut.error ? errorText(mut.error) : STR.ws.notifications.saveFailed}
        </p>
      ) : null}
    </section>
  );
}

function NotificationsInner() {
  const qc = useQueryClient();
  const listQ = useQuery({
    queryKey: ["notifications"],
    queryFn: () => listNotifications({}),
    staleTime: 15_000,
  });
  const prefsQ = useQuery({
    queryKey: ["notification-prefs"],
    queryFn: getNotificationPrefs,
    staleTime: 30_000,
  });

  const markAll = useMutation({
    mutationFn: () => markNotificationsRead({ all: true }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["notifications"] });
      await qc.invalidateQueries({ queryKey: ["notif-unread"] });
      await qc.invalidateQueries({ queryKey: ["me-overview"] });
    },
  });

  const markOne = useMutation({
    mutationFn: (id: string) => markNotificationsRead({ ids: [id] }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["notifications"] });
      await qc.invalidateQueries({ queryKey: ["notif-unread"] });
      await qc.invalidateQueries({ queryKey: ["me-overview"] });
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={STR.ws.notifications.title}
        description={STR.ws.notifications.description}
        topic="pages/notifications"
      />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span data-testid="notifications-unread" className="text-muted">
          {STR.ws.notifications.unread} {listQ.data?.unread_count ?? "…"}
        </span>
        <HelpTip action="notifications-mark-all">
          <Button
            type="button"
            data-testid="notifications-mark-all"
            className="rounded-sf border border-line px-3 py-1 hover:bg-surface-2 disabled:opacity-50"
            pending={markAll.isPending}
            disabled={(listQ.data?.unread_count ?? 0) === 0}
            onClick={() => markAll.mutate()}
          >
            {STR.ws.notifications.markAll}
          </Button>
        </HelpTip>
      </div>

      {listQ.isError ? (
        <p className="text-sm text-danger">{STR.ws.notifications.loadFailed}</p>
      ) : listQ.isLoading || !listQ.data ? (
        <p className="text-sm text-muted">{STR.common.loading}</p>
      ) : listQ.data.items.length === 0 ? (
        <p className="text-sm text-muted">{STR.ws.notifications.empty}</p>
      ) : (
        <ul className="space-y-2">
          {listQ.data.items.map((n) => {
            const href = isSafeInternalPath(n.url) ? n.url : null;
            return (
              <li
                key={n.id}
                data-testid="notification-row"
                data-read={n.read ? "1" : "0"}
                className={`rounded-sf border border-line p-3 text-sm ${n.read ? "bg-surface opacity-80" : "bg-accent-soft"}`}
              >
                {href ? (
                  <Link
                    to={href}
                    className="font-medium text-accent no-underline hover:underline"
                    translate="no"
                    onClick={() => {
                      if (!n.read) markOne.mutate(n.id);
                    }}
                  >
                    {notificationTitle(n)}
                  </Link>
                ) : (
                  <span className="font-medium" translate="no">
                    {notificationTitle(n)}
                  </span>
                )}
                <div className="mt-1 text-xs text-muted">
                  <span>{kindLabel(n.kind)}</span>
                  {n.actor ? (
                    <span>
                      {" · "}
                      <span translate="no">{n.actor}</span>
                    </span>
                  ) : null}
                  {n.artifact ? (
                    <span>
                      {" · "}
                      <span translate="no">
                        {n.artifact.type}/{n.artifact.name}
                      </span>
                    </span>
                  ) : null}
                  <span> · {formatDateTime(n.created_at)}</span>
                </div>
                {n.text ? (
                  <p className="mt-1 whitespace-pre-wrap text-ink-2" translate="no">
                    {n.text}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {prefsQ.data ? <PrefsPanel prefs={prefsQ.data} /> : null}
    </div>
  );
}

export function Notifications() {
  return <RequireUser>{() => <NotificationsInner />}</RequireUser>;
}
