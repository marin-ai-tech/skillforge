import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteNewsPost, listArtifactTypes, listNews, markNewsSeen } from "../api/client.ts";
import type { NewsItem, NewsListResponse } from "../api/types.ts";
import { PageHeader } from "../components/PageHeader.tsx";
import { HelpTip } from "../components/HelpTip.tsx";
import { Skeleton } from "../components/Skeleton.tsx";
import { Button } from "../components/Button.tsx";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { NewsEntry, NewsError, groupByDay, newsRowId } from "../components/NewsEntry.tsx";
import { NewsPostForm } from "../components/NewsPostForm.tsx";
import { useMe } from "../lib/auth.tsx";
import { useNewsAudiences } from "../lib/news-audience.ts";
import { FALLBACK_TYPE_IDS } from "../lib/artifact-types.ts";
import { STR } from "../lib/strings.ts";
import { locale } from "../i18n/index.ts";

const PAGE_SIZE = 20;
const DRAFTS_LIMIT = 100;
const KINDS = ["new_artifact", "new_version", "status_change", "post"] as const;
const selectClass =
  "min-h-6 rounded-sf border border-line bg-bg px-2 py-1.5 text-sm text-ink disabled:opacity-60";
const actionClass =
  "inline-flex min-h-6 items-center rounded-sf border border-line px-3 py-1.5 text-sm text-ink-2 no-underline hover:bg-surface-2";

type RowActions = { onEdit?: (item: NewsItem) => void; onDelete?: (item: NewsItem) => void };

/**
 * Marks the feed seen once per visit, when `ready` (the unread count of this visit is known), and drops the header
 * count; the header reads it again when it is shown.
 */
function useMarkSeen(ready: boolean) {
  const qc = useQueryClient();
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    markNewsSeen()
      .then(() => {
        qc.setQueryData(["news-unread"], 0);
        return qc.invalidateQueries({ queryKey: ["news-unread"] });
      })
      .catch(() => undefined);
  }, [ready, qc]);
}

function Filters({ kind, type }: { kind: string; type: string }) {
  const [, setParams] = useSearchParams();
  const types = useQuery({
    queryKey: ["artifact-types"],
    queryFn: listArtifactTypes,
    staleTime: 60_000,
  });
  const typeIds = types.data?.items.map((t) => t.id) ?? [...FALLBACK_TYPE_IDS];
  const postsOnly = kind === "post";
  const update = (key: "kind" | "type", value: string) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  return (
    <fieldset className="flex flex-wrap items-end gap-3">
      <legend className="sr-only">{STR.news.filters}</legend>
      <div>
        <label htmlFor="news-filter-kind" className="mb-1 block text-xs text-muted">
          {STR.news.kind}
        </label>
        <HelpTip action="news-filter">
          <select
            id="news-filter-kind"
            data-testid="news-filter-kind"
            value={kind}
            onChange={(e) => update("kind", e.target.value)}
            className={selectClass}
          >
            <option value="">{STR.news.allKinds}</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {STR.news.kinds[k]}
              </option>
            ))}
          </select>
        </HelpTip>
      </div>
      <div>
        <label htmlFor="news-filter-type" className="mb-1 block text-xs text-muted">
          {STR.news.type}
        </label>
        <HelpTip action="news-filter">
          <select
            id="news-filter-type"
            data-testid="news-filter-type"
            value={type}
            disabled={postsOnly}
            aria-describedby={postsOnly ? "news-filter-type-hint" : undefined}
            onChange={(e) => update("type", e.target.value)}
            className={selectClass}
          >
            <option value="">{STR.news.allTypes}</option>
            {typeIds.map((t) => (
              <option key={t} value={t}>
                {(STR.ui.typePlural as Record<string, string | undefined>)[t] ?? t}
              </option>
            ))}
          </select>
        </HelpTip>
        {postsOnly ? (
          <p id="news-filter-type-hint" className="mt-1 text-xs text-muted">
            {STR.news.typeDisabledHint}
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}

function Loading() {
  return (
    <div
      data-testid="news-loading"
      role="status"
      aria-label={STR.news.loadingLabel}
      className="space-y-2"
    >
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
    </div>
  );
}

function Empty({ filtered }: { filtered: boolean }) {
  return (
    <div
      data-testid="news-empty"
      className="rounded-sf border border-dashed border-line bg-surface px-6 py-10 text-center"
    >
      <p className="text-sm font-medium text-ink">{STR.news.empty}</p>
      {filtered ? (
        <>
          <p className="mt-1 text-sm text-muted">{STR.news.emptyFiltered}</p>
          <Link to="/news" data-testid="news-filter-reset" className={`${actionClass} mt-3`}>
            {STR.news.reset}
          </Link>
        </>
      ) : null}
    </div>
  );
}

function Pinned({ items, onEdit, onDelete }: { items: NewsItem[] } & RowActions) {
  if (items.length === 0) return null;
  return (
    <section data-testid="news-pinned" aria-labelledby="news-pinned-h" className="space-y-2">
      <h2 id="news-pinned-h" className="text-sm font-medium uppercase tracking-wide text-muted">
        {STR.news.pinnedLabel}
      </h2>
      <ul className="space-y-2">
        {items.map((item) => (
          <NewsEntry
            key={item.id}
            item={item}
            testId="news-pinned-item"
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </ul>
    </section>
  );
}

/** The author's drafts and scheduled posts (drafts=true); a second feed request, started after the main feed. */
function Drafts({ enabled, onEdit, onDelete }: { enabled: boolean } & RowActions) {
  const q = useQuery({
    queryKey: ["news", "drafts"],
    queryFn: () => listNews({ drafts: true, kind: "post", limit: DRAFTS_LIMIT }),
    enabled,
    retry: false,
  });
  const items = useMemo(() => {
    const seen = new Set<string>();
    return [...(q.data?.pinned ?? []), ...(q.data?.items ?? [])].filter((i) => {
      if (seen.has(i.id) || !i.post || !(i.post.draft || i.post.scheduled)) return false;
      seen.add(i.id);
      return true;
    });
  }, [q.data]);
  if (!enabled || items.length === 0) return null;
  return (
    <section data-testid="news-drafts" aria-labelledby="news-drafts-h" className="space-y-2">
      <h2 id="news-drafts-h" className="text-sm font-medium uppercase tracking-wide text-muted">
        {STR.news.drafts}
      </h2>
      <ul className="space-y-2">
        {items.map((item) => (
          <NewsEntry key={item.id} item={item} onEdit={onEdit} onDelete={onDelete} />
        ))}
      </ul>
    </section>
  );
}

function SeenBoundary() {
  return (
    <li data-testid="news-seen-boundary" className="flex items-center gap-2 text-xs text-muted">
      <span aria-hidden className="h-px flex-1 bg-line" />
      <span>{STR.news.seenBoundary}</span>
      <span aria-hidden className="h-px flex-1 bg-line" />
    </li>
  );
}

function Feed({
  items,
  focusId,
  onFocused,
  boundaryAfter,
  onEdit,
  onDelete,
}: {
  items: NewsItem[];
  focusId: string | null;
  onFocused: () => void;
  boundaryAfter: number | null;
} & RowActions) {
  // Focus goes once to the first item of a page loaded by «Show more», found by its id (not by index).
  useEffect(() => {
    if (focusId === null) return;
    document.getElementById(newsRowId(focusId))?.focus();
    onFocused();
  }, [focusId, onFocused]);
  let index = 0;
  return (
    <div aria-label={STR.news.feedLabel} role="region" className="space-y-6">
      {groupByDay(items).map((g) => (
        <section key={g.key} className="space-y-2">
          <h2 className="text-base font-semibold text-ink">{g.label}</h2>
          <ul className="space-y-2">
            {g.items.flatMap((item) => {
              const i = index++;
              const row = (
                <NewsEntry key={item.id} item={item} onEdit={onEdit} onDelete={onDelete} />
              );
              return i === boundaryAfter ? [row, <SeenBoundary key="seen-boundary" />] : [row];
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function useFeed(kind: string, type: string) {
  return useInfiniteQuery<NewsListResponse>({
    queryKey: ["news", "feed", kind, type],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      listNews({ kind, type, limit: PAGE_SIZE, cursor: (pageParam as string) || undefined }),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    retry: false,
  });
}

/** «Show more» stays in place when the next page fails: the error is next to it and the button retries. */
function More({ feed, onMore }: { feed: ReturnType<typeof useFeed>; onMore: () => void }) {
  if (!feed.hasNextPage) return null;
  const failed = feed.isFetchNextPageError && !feed.isFetchingNextPage;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <HelpTip action="news-more">
        <Button
          type="button"
          data-testid="news-more"
          pending={feed.isFetchingNextPage}
          aria-describedby={failed ? "news-more-error" : undefined}
          onClick={onMore}
          className={actionClass}
        >
          {failed ? STR.news.moreRetry : STR.news.more}
        </Button>
      </HelpTip>
      <p id="news-more-error" role="alert" className="text-sm text-danger">
        {failed ? STR.news.moreFailed : ""}
      </p>
    </div>
  );
}

/** Index of the last unread item: the first `unread` items not written by the reader (approximate by count). */
function boundaryIndex(items: NewsItem[], unread: number, me: string): number | null {
  let n = 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i]!.actor !== me) n++;
    if (n >= unread) return i < items.length - 1 ? i : null;
  }
  return null;
}

/** Pinned posts of the first page, and the feed items of all pages without them. */
function split(pages: NewsListResponse[]): { pinned: NewsItem[]; items: NewsItem[] } {
  const first = pages[0]?.pinned ?? [];
  const pinnedIds = new Set(first.map((p) => p.id));
  const rest = pages.flatMap((p) => p.items).filter((i) => !pinnedIds.has(i.id));
  return { pinned: first, items: rest };
}

function FeedBody({
  kind,
  type,
  me,
  unreadBefore,
  onReady,
  onEdit,
  onDelete,
}: {
  kind: string;
  type: string;
  me: string;
  unreadBefore: number | null;
  onReady: (first: NewsListResponse | null) => void;
} & RowActions) {
  const feed = useFeed(kind, type);
  const filtered = !!(kind || type);
  const [focusId, setFocusId] = useState<string | null>(null);
  const clearFocus = useCallback(() => setFocusId(null), []);
  const { hash } = useLocation();
  const hashDone = useRef(false);
  const { pinned, items } = useMemo(() => split(feed.data?.pages ?? []), [feed.data]);
  const firstPage = feed.data?.pages[0] ?? null;
  useEffect(() => {
    if (!feed.isPending) onReady(firstPage);
  }, [feed.isPending, firstPage, onReady]);
  // A link from the tile (/news#news-<id>) focuses its row once the feed is there.
  useEffect(() => {
    if (hashDone.current || !feed.data || !hash.startsWith("#news-")) return;
    hashDone.current = true;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.focus();
  }, [feed.data, hash]);
  const boundaryAfter = useMemo(
    () => (filtered || !unreadBefore ? null : boundaryIndex(items, unreadBefore, me)),
    [filtered, unreadBefore, items, me],
  );
  if (feed.isPending) return <Loading />;
  if (feed.isError && !feed.data)
    return (
      <NewsError
        message={STR.news.loadFailed}
        pending={feed.isFetching}
        onRetry={() => void feed.refetch()}
      />
    );
  const onMore = () => {
    const before = items.length;
    void feed.fetchNextPage().then((r) => {
      if (r.isError || !r.data) return;
      const next = split(r.data.pages).items[before];
      if (next) setFocusId(next.id);
    });
  };
  // Under a filter the pinned posts step aside (they are not filtered), and emptiness counts the items only.
  const shownPinned = filtered ? [] : pinned;
  const empty = items.length === 0 && shownPinned.length === 0;
  return (
    <div className="space-y-6">
      <Pinned items={shownPinned} onEdit={onEdit} onDelete={onDelete} />
      {empty ? (
        <Empty filtered={filtered} />
      ) : (
        <Feed
          items={items}
          focusId={focusId}
          onFocused={clearFocus}
          boundaryAfter={boundaryAfter}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      )}
      <More feed={feed} onMore={onMore} />
    </div>
  );
}

/** The status line after a save: published (for whom), draft saved, or scheduled (when). */
function savedMessage(item: NewsItem | undefined): string {
  const p = item?.post;
  if (!p) return STR.news.form.saved;
  if (p.draft) return STR.news.form.draftSaved;
  const at = p.publish_at ? new Date(p.publish_at) : null;
  if (at && (p.scheduled || at.getTime() > Date.now())) {
    return STR.news.form.scheduledFor(
      at.toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" }),
    );
  }
  return p.team ? STR.news.form.publishedFor(p.team) : STR.news.form.publishedForEveryone;
}

type Ask = {
  title: string;
  body: string;
  help: string;
  confirm: string;
  cancel?: string;
  run: () => void;
};

/**
 * The unread count of this visit, taken before the feed is marked seen: the header's count when it was shown,
 * otherwise the first answer of the feed (marking waits for it then). Also marks the feed seen.
 */
function useVisitUnread(signedIn: boolean) {
  const qc = useQueryClient();
  const [unreadBefore, setUnreadBefore] = useState<number | null>(() => {
    const cached = qc.getQueryData<number>(["news-unread"]);
    return typeof cached === "number" ? cached : null;
  });
  const [countKnownAtOpen] = useState(() => unreadBefore !== null);
  const [feedReady, setFeedReady] = useState(false);
  const onReady = useCallback((first: NewsListResponse | null) => {
    setFeedReady(true);
    if (first) setUnreadBefore((u) => (u === null ? first.unread_count : u));
  }, []);
  useMarkSeen(signedIn && (countKnownAtOpen || feedReady));
  return { unreadBefore, feedReady, onReady };
}

function NewSince({ n, filtered }: { n: number | null; filtered: boolean }) {
  if (!n || n <= 0 || filtered) return null;
  return (
    <p data-testid="news-new-since" className="text-sm text-ink-2">
      {STR.news.newSince(n)}
    </p>
  );
}

/** One confirmation at a time through the shared ConfirmDialog: delete a post, or discard unsaved text. */
function AskDialog({ ask, onClose }: { ask: Ask | null; onClose: () => void }) {
  return (
    <ConfirmDialog
      open={ask !== null}
      title={ask?.title ?? ""}
      body={ask?.body ?? ""}
      helpText={ask?.help ?? ""}
      confirmLabel={ask?.confirm}
      cancelLabel={ask?.cancel}
      onConfirm={() => {
        onClose();
        ask?.run();
      }}
      onCancel={onClose}
    />
  );
}

function NewPostButton({
  formOpen,
  onOpen,
  ref,
}: {
  formOpen: boolean;
  onOpen: () => void;
  ref: Ref<HTMLButtonElement>;
}) {
  return (
    <HelpTip action="news-new">
      <button
        ref={ref}
        type="button"
        data-testid="news-new"
        aria-expanded={formOpen}
        onClick={() => {
          // While the form is open this button never closes it: it brings the focus back to the title.
          if (formOpen) {
            document.querySelector<HTMLElement>('[data-testid="news-form-title"]')?.focus();
            return;
          }
          onOpen();
        }}
        className="min-h-6 rounded-sf bg-accent px-3 py-1.5 text-sm font-medium text-bg"
      >
        {STR.news.newPost}
      </button>
    </HelpTip>
  );
}

/**
 * The header actions: «Subscribe in a feed reader» for a signed-in reader (only they have a personal Atom link; the
 * link opens the cabinet and sends no news request), then «New post».
 */
function HeaderActions({ signedIn, newButton }: { signedIn: boolean; newButton: ReactNode }) {
  if (!signedIn && !newButton) return null;
  return (
    <>
      {signedIn ? (
        <HelpTip action="news-subscribe">
          <Link
            to="/me/notifications#news-atom"
            data-testid="news-subscribe"
            className={actionClass}
          >
            {STR.news.subscribe}
          </Link>
        </HelpTip>
      ) : null}
      {newButton}
    </>
  );
}

export function News() {
  const [params] = useSearchParams();
  const kind = params.get("kind") ?? "";
  const type = params.get("type") ?? "";
  const filtered = !!(kind || type);
  const qc = useQueryClient();
  const me = useMe();
  const user = me.data ?? null;
  const audiences = useNewsAudiences(user, STR.news.form.everyone);
  const canPost = (audiences.data?.length ?? 0) > 0;
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<NewsItem | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [status, setStatus] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const dirty = useRef(false);
  const newRef = useRef<HTMLButtonElement>(null);
  const { unreadBefore, feedReady, onReady } = useVisitUnread(!!user);
  useEffect(() => {
    document.title = STR.news.documentTitle;
  }, []);
  const onDirtyChange = useCallback((d: boolean) => {
    dirty.current = d;
  }, []);
  const closeForm = (message: string) => {
    setFormOpen(false);
    setEditing(null);
    dirty.current = false;
    setStatus(message);
    window.setTimeout(() => newRef.current?.focus(), 0);
  };
  /** Runs `next` at once, or after «Discard the post?» when the open form holds unsaved text. */
  const guard = (next: () => void) => {
    if (!formOpen || !dirty.current) {
      next();
      return;
    }
    setAsk({
      title: STR.news.form.discardTitle,
      body: STR.news.form.discardBody,
      help: STR.news.form.discardHelp,
      confirm: STR.news.form.discard,
      cancel: STR.news.form.keepEditing,
      run: next,
    });
  };
  const openForm = (item: NewsItem | null) => {
    setStatus("");
    setEditing(item);
    dirty.current = false;
    setFormKey((k) => k + 1);
    setFormOpen(true);
  };
  const del = useMutation({
    mutationFn: (id: string) => deleteNewsPost(id),
    onSuccess: async () => {
      setStatus(STR.news.deleted);
      await qc.invalidateQueries({ queryKey: ["news"] });
    },
    onError: () => setStatus(STR.news.deleteFailed),
  });
  const onEdit = (item: NewsItem) => guard(() => openForm(item));
  const onDelete = (item: NewsItem) =>
    setAsk({
      title: STR.news.deleteTitle,
      body: STR.news.deleteBody(item.post?.title ?? ""),
      help: STR.news.deleteHelp,
      confirm: STR.news.delete,
      run: () => {
        if (editing?.id === item.id) closeForm("");
        del.mutate(item.id);
        window.setTimeout(() => newRef.current?.focus(), 0);
      },
    });
  // The buttons themselves appear only on rows with post.can_edit.
  const actions: RowActions = { onEdit, onDelete };
  const newButton = canPost ? (
    <NewPostButton ref={newRef} formOpen={formOpen} onOpen={() => openForm(null)} />
  ) : null;
  return (
    <div className="space-y-6">
      <PageHeader
        title={STR.news.title}
        description={STR.news.description}
        topic="pages/news"
        actions={<HeaderActions signedIn={!!user} newButton={newButton} />}
      />
      <NewSince n={unreadBefore} filtered={filtered} />
      <p role="status" className="text-sm text-ink-2">
        {status}
      </p>
      {formOpen && audiences.data ? (
        <NewsPostForm
          key={formKey}
          audiences={audiences.data}
          editing={editing}
          onDirtyChange={onDirtyChange}
          onDone={(saved) => closeForm(savedMessage(saved))}
          onCancel={() => guard(() => closeForm(""))}
        />
      ) : null}
      <Drafts enabled={canPost && feedReady} {...actions} />
      <Filters kind={kind} type={type} />
      <FeedBody
        key={`${kind}|${type}`}
        kind={kind}
        type={type}
        me={user?.username ?? ""}
        unreadBefore={unreadBefore}
        onReady={onReady}
        {...actions}
      />
      <AskDialog ask={ask} onClose={() => setAsk(null)} />
    </div>
  );
}
