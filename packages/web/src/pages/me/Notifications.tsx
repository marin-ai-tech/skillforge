import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "react-router";
import {
  getNewsAtomKey,
  getNewsSummary,
  getNotificationPrefs,
  issueNewsAtomKey,
  listNotifications,
  markNotificationsRead,
  putNewsSummary,
  putNotificationPrefs,
  revokeNewsAtomKey,
  type NotificationPrefs,
  type NotificationDto,
} from "../../api/client.ts";
import type { IssuedNewsAtomKey, NewsAtomKeyState, NewsSummaryPeriod } from "../../api/types.ts";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { CopyButton } from "../../components/CopyButton.tsx";
import { Callout } from "../../components/Callout.tsx";
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
  "mcp_version",
] as const;

/** Interface label of a notification kind; an unknown kind from the server is shown as is. */
/** A title in the reader's language for kinds with an artifact; plugins and others keep the server's own title. */
function notificationTitle(n: NotificationDto): string {
  // The summary has no artifact: its title comes from the stored item count, with plurals of the reader's language.
  if (n.kind === "news_summary" && typeof n.summary_items === "number") {
    return STR.ws.notifications.summaryTitle(n.summary_items);
  }
  if (n.kind === "mcp_version" && n.meta && n.artifact) {
    const { event, version, registry_version } = n.meta;
    if (event === "release" || event === "drift") {
      return STR.ws.notifications.mcpVersionTitle(
        n.artifact.name,
        event,
        version,
        registry_version,
      );
    }
  }
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

const PERIODS: readonly NewsSummaryPeriod[] = ["off", "daily", "weekly"];
const ATOM_KEY_QUERY = ["news-atom-key"] as const;
const actionClass =
  "rounded-sf border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2";

/** «News summary»: off / daily / weekly, saved on change. */
function NewsSummaryControl() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["news-summary"], queryFn: getNewsSummary, staleTime: 30_000 });
  const [choice, setChoice] = useState<NewsSummaryPeriod | null>(null);
  const [saved, setSaved] = useState(false);
  const mut = useMutation({
    mutationFn: (period: NewsSummaryPeriod) => putNewsSummary(period),
    onMutate: () => setSaved(false),
    onSuccess: (data) => {
      setSaved(true);
      setChoice(null);
      qc.setQueryData(["news-summary"], data);
    },
    // The select goes back to the saved value: it never shows a period the server does not have (finding 3).
    onError: () => setChoice(null),
  });
  if (q.isError) {
    return <p className="text-sm text-danger">{STR.news.delivery.loadFailed}</p>;
  }
  if (!q.data) return <p className="text-sm text-muted">{STR.common.loading}</p>;
  const value = choice ?? q.data.period;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="news-summary-period" className="text-ink-2">
          {STR.news.delivery.summaryLabel}
        </label>
        <HelpTip action="news-summary-period">
          <select
            id="news-summary-period"
            data-testid="news-summary-period"
            className="rounded-sf border border-line bg-bg px-2 py-1.5 text-sm text-ink"
            value={value}
            aria-disabled={mut.isPending || undefined}
            aria-describedby="news-summary-note"
            onChange={(e) => {
              // Focus stays on the select while it saves; a change meanwhile is ignored.
              if (mut.isPending) return;
              const next = e.target.value as NewsSummaryPeriod;
              setChoice(next);
              mut.mutate(next);
            }}
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {STR.news.delivery.periods[p]}
              </option>
            ))}
          </select>
        </HelpTip>
        <span role="status" className="text-xs text-ink-2">
          {saved ? <span data-testid="news-summary-status">{STR.news.delivery.saved}</span> : null}
        </span>
      </div>
      {mut.isError ? (
        <p role="alert" className="text-xs text-danger">
          {STR.news.delivery.saveFailedRetry(
            STR.news.delivery.periods[q.data.period] ?? q.data.period,
          )}
          {mut.error ? ` ${errorText(mut.error)}` : ""}
        </p>
      ) : null}
      <p id="news-summary-note" className="text-xs text-muted">
        {STR.news.delivery.summaryNote}
      </p>
    </div>
  );
}

/** The link as a feed reader needs it: the server may answer with a path. */
function absoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url) || typeof window === "undefined") return url;
  return `${window.location.origin}${url.startsWith("/") ? "" : "/"}${url}`;
}

type AtomAsk = "replace" | "revoke";

const EMPTY_KEY: NewsAtomKeyState = { exists: false, prefix: null, created_at: null };

/** Issue (or replace) and revoke; both keep the key state in the cache so the page needs no reload. */
function useAtomKeyActions(onRevoked: () => void) {
  const qc = useQueryClient();
  const [issued, setIssued] = useState<IssuedNewsAtomKey | null>(null);
  // Success goes to a role="status" region, a failure to role="alert" with the server's reason (findings 6 and 9).
  const [status, setStatus] = useState("");
  const [failure, setFailure] = useState("");
  const reset = () => {
    setStatus("");
    setFailure("");
  };
  const failed = (text: string, error: unknown) =>
    setFailure(error ? `${text} ${errorText(error)}` : text);
  const issue = useMutation({
    // `replace` only picks the failure text: the server swaps the key in one upsert, so a failed replace keeps the old one.
    mutationFn: (_replace: boolean) => issueNewsAtomKey(),
    onMutate: reset,
    onSuccess: (data) => {
      setIssued(data);
      qc.setQueryData<NewsAtomKeyState>(ATOM_KEY_QUERY, {
        exists: true,
        prefix: data.prefix,
        created_at: data.created_at,
      });
      setStatus(STR.news.delivery.created);
    },
    onError: (error, replace) =>
      failed(replace ? STR.news.delivery.replaceFailed : STR.news.delivery.issueFailed, error),
  });
  const revoke = useMutation({
    mutationFn: revokeNewsAtomKey,
    onMutate: reset,
    onSuccess: () => {
      setIssued(null);
      qc.setQueryData<NewsAtomKeyState>(ATOM_KEY_QUERY, EMPTY_KEY);
      setStatus(STR.news.delivery.revoked);
      onRevoked();
    },
    onError: (error) => failed(STR.news.delivery.revokeFailed, error),
  });
  return { issue, revoke, issued, status, failure };
}

/** The link right after it is created: once, read-only, with a copy button and the warning. */
function IssuedAtomLink({ issued }: { issued: IssuedNewsAtomKey }) {
  const urlRef = useRef<HTMLInputElement>(null);
  const url = absoluteUrl(issued.url);
  useEffect(() => {
    // Focus first, so the label and the once-only warning are read out; then select for a quick copy (finding 6).
    urlRef.current?.focus();
    urlRef.current?.select();
  }, [url]);
  return (
    <div className="space-y-2">
      <label htmlFor="news-atom-url" className="block text-ink-2">
        {STR.news.delivery.urlLabel}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={urlRef}
          id="news-atom-url"
          data-testid="news-atom-url"
          readOnly
          value={url}
          aria-describedby="news-atom-once"
          className="min-w-0 flex-1 rounded-sf border border-line bg-bg px-3 py-1.5 font-mono text-xs"
          onFocus={(e) => e.currentTarget.select()}
        />
        <HelpTip action="news-atom-copy">
          <CopyButton
            value={url}
            label={STR.news.delivery.copy}
            testId="news-atom-copy"
            copiedText={STR.news.delivery.copied}
            failedText={STR.news.delivery.copyFailed}
            fieldId="news-atom-url"
          />
        </HelpTip>
      </div>
      <div id="news-atom-once">
        <Callout kind="warning">
          <p>{STR.news.delivery.shownOnce}</p>
        </Callout>
      </div>
    </div>
  );
}

function atomStateText(key: NewsAtomKeyState, issued: IssuedNewsAtomKey | null): string {
  if (!key.exists) return STR.news.delivery.atomNone;
  const created = issued?.created_at ?? key.created_at;
  return STR.news.delivery.atomExists(
    issued?.prefix ?? key.prefix ?? "",
    created ? formatDateTime(created) : "",
  );
}

const ASK_TEXT: Record<
  AtomAsk,
  () => { title: string; body: string; help: string; confirm: string }
> = {
  replace: () => ({
    title: STR.news.delivery.replaceTitle,
    body: STR.news.delivery.replaceBody,
    help: STR.news.delivery.replaceHelp,
    confirm: STR.news.delivery.replace,
  }),
  revoke: () => ({
    title: STR.news.delivery.revokeTitle,
    body: STR.news.delivery.revokeBody,
    help: STR.news.delivery.revokeHelp,
    confirm: STR.news.delivery.revoke,
  }),
};

/** The personal Atom link: shown once after it is created; replace and revoke only after a confirmation. */
function NewsAtomControl() {
  const q = useQuery({ queryKey: ATOM_KEY_QUERY, queryFn: getNewsAtomKey, staleTime: 30_000 });
  const [ask, setAsk] = useState<AtomAsk | null>(null);
  const issueRef = useRef<HTMLButtonElement>(null);
  const { issue, revoke, issued, status, failure } = useAtomKeyActions(() =>
    window.setTimeout(() => issueRef.current?.focus(), 0),
  );

  if (q.isError) {
    return <p className="text-sm text-danger">{STR.news.delivery.loadFailed}</p>;
  }
  if (!q.data) return <p className="text-sm text-muted">{STR.common.loading}</p>;
  const exists = q.data.exists;
  const text = ASK_TEXT[ask ?? "replace"]();

  return (
    <div className="space-y-2">
      <p className="text-ink-2">{STR.news.delivery.atomIntro}</p>
      <p data-testid="news-atom-state" className="text-muted">
        {atomStateText(q.data, issued)}
      </p>
      {issued ? <IssuedAtomLink issued={issued} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <HelpTip action="news-atom-issue">
          <Button
            ref={issueRef}
            type="button"
            data-testid="news-atom-issue"
            className={actionClass}
            pending={issue.isPending}
            onClick={() => (exists ? setAsk("replace") : issue.mutate(false))}
          >
            {exists ? STR.news.delivery.replace : STR.news.delivery.create}
          </Button>
        </HelpTip>
        {exists ? (
          <HelpTip action="news-atom-revoke">
            <Button
              type="button"
              data-testid="news-atom-revoke"
              className="rounded-sf border border-line px-3 py-1.5 text-sm text-danger hover:bg-danger-bg"
              pending={revoke.isPending}
              onClick={() => setAsk("revoke")}
            >
              {STR.news.delivery.revoke}
            </Button>
          </HelpTip>
        ) : null}
        <span role="status" data-testid="news-atom-status" className="text-xs text-ink-2">
          {status}
        </span>
      </div>
      {failure ? (
        <p role="alert" data-testid="news-atom-error" className="text-xs text-danger">
          {failure}
        </p>
      ) : null}
      <ConfirmDialog
        open={ask !== null}
        title={text.title}
        body={text.body}
        helpText={text.help}
        helpTopic="pages/notifications"
        confirmLabel={text.confirm}
        onConfirm={() => {
          if (ask === "revoke") revoke.mutate();
          else issue.mutate(true);
          setAsk(null);
        }}
        onCancel={() => setAsk(null)}
      />
    </div>
  );
}
/** «News delivery»: the summary period and the personal Atom link (news-delivery). */
function NewsDeliveryPanel({ pageSettled }: { pageSettled: boolean }) {
  const { hash } = useLocation();
  const atomRef = useRef<HTMLDivElement>(null);
  const atomHeadingRef = useRef<HTMLHeadingElement>(null);
  const jumped = useRef<string | null>(null);
  // The same queries the controls below use (shared cache, no extra request): the jump waits until they are settled.
  const summaryQ = useQuery({
    queryKey: ["news-summary"],
    queryFn: getNewsSummary,
    staleTime: 30_000,
  });
  const atomQ = useQuery({ queryKey: ATOM_KEY_QUERY, queryFn: getNewsAtomKey, staleTime: 30_000 });
  const settled = pageSettled && !summaryQ.isPending && !atomQ.isPending;
  useEffect(() => {
    // The page renders after its queries, so the browser cannot scroll to #news-atom by itself. Wait until the list
    // and the delivery settings have loaded (they move the section), then scroll once and focus the heading (finding 4).
    if (hash !== "#news-atom") {
      jumped.current = null;
      return;
    }
    if (!settled || jumped.current === hash) return;
    jumped.current = hash;
    atomRef.current?.scrollIntoView({ block: "start" });
    atomHeadingRef.current?.focus({ preventScroll: true });
  }, [hash, settled]);
  return (
    <section
      data-testid="news-delivery"
      aria-labelledby="news-delivery-h"
      className="space-y-4 rounded-sf border border-line bg-surface p-4 text-sm"
    >
      <div>
        <h2 id="news-delivery-h" className="font-medium">
          {STR.news.delivery.title}
        </h2>
        <p className="text-muted">{STR.news.delivery.description}</p>
      </div>
      <NewsSummaryControl />
      <div id="news-atom" ref={atomRef} className="space-y-2 border-t border-line pt-3">
        <h3 ref={atomHeadingRef} tabIndex={-1} className="font-medium">
          {STR.news.delivery.atomTitle}
        </h3>
        <NewsAtomControl />
      </div>
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

      <NewsDeliveryPanel pageSettled={!listQ.isPending && !prefsQ.isPending} />
    </div>
  );
}

export function Notifications() {
  return <RequireUser>{() => <NotificationsInner />}</RequireUser>;
}
