import type { ReactNode, Ref } from "react";
import { Link } from "react-router";
import type { NewsItem } from "../api/types.ts";
import { Markdown } from "./Markdown.tsx";
import { Button } from "./Button.tsx";
import { RelativeTime } from "./RelativeTime.tsx";
import { STR } from "../lib/strings.ts";
import { locale } from "../i18n/index.ts";

const artifactHref = (a: { type: string; name: string }) =>
  `/artifacts/${encodeURIComponent(a.type)}/${encodeURIComponent(a.name)}`;

/** Fills `{name}` and `{replacement}` of a template with nodes (links), keeping the text around them. */
function fill(template: string, parts: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{\w+\})/).map((chunk, i) => {
    const m = /^\{(\w+)\}$/.exec(chunk);
    const key = m?.[1];
    if (key !== undefined && key in parts) return <span key={i}>{parts[key]}</span>;
    return chunk;
  });
}

function typeOne(type: string): string {
  return (STR.ui.typeOne as Record<string, string | undefined>)[type] ?? type;
}

function statusTemplate(item: NewsItem): string {
  if (item.to === "retired") return item.replacement ? STR.news.retiredWith : STR.news.retired;
  if (item.to === "zombie") return STR.news.zombie;
  if (item.to === "active") return STR.news.activeAgain;
  return STR.news.statusOther(item.from ?? "", item.to ?? "");
}

function templateOf(item: NewsItem): string {
  const type = item.artifact?.type ?? "";
  if (item.kind === "new_artifact")
    return STR.news.newArtifact[type] ?? STR.news.newArtifactOther(typeOne(type));
  if (item.kind === "new_version") return STR.news.newVersion(item.version ?? "");
  return statusTemplate(item);
}

const linkClass = "font-medium text-accent underline-offset-2 hover:underline";

/** The element id of a row on /news; the tile links to `/news#news-<id>`. */
export const newsRowId = (id: string) => `news-${id}`;

/** The sentence of an automatic news item, built here from its fields; the artifact name is a link. */
function EventText({ item }: { item: NewsItem }) {
  const a = item.artifact;
  if (!a) return <span>{templateOf(item).replace(/\{\w+\}/g, "")}</span>;
  const isVersion = item.kind === "new_version" && !!item.version;
  const href = isVersion
    ? `${artifactHref(a)}?tab=versions&compare=${encodeURIComponent(item.version ?? "")}`
    : artifactHref(a);
  const name = (
    <Link
      to={href}
      className={linkClass}
      translate="no"
      aria-label={isVersion ? STR.news.compareLabel(a.name, item.version ?? "") : undefined}
    >
      {a.name}
    </Link>
  );
  const r = item.replacement;
  const replacement = r ? (
    <Link to={artifactHref(r)} className={linkClass} translate="no">
      {r.name}
    </Link>
  ) : null;
  return <span>{fill(templateOf(item), { name, replacement })}</span>;
}

function Badge({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
  return (
    <span
      className={`rounded-sf border px-1.5 py-0.5 text-xs font-medium ${strong ? "border-danger text-danger" : "border-line text-ink-2"}`}
    >
      {children}
    </span>
  );
}

/** The post title: in the compact tile a link to the post on /news, elsewhere plain text. */
function PostTitle({ item, compact }: { item: NewsItem; compact: boolean }) {
  const title = item.post?.title ?? "";
  if (!compact) return <h3 className="text-sm font-semibold text-ink">{title}</h3>;
  return (
    <h3 className="text-sm font-semibold text-ink">
      <Link to={`/news#news-${encodeURIComponent(item.id)}`} className={linkClass}>
        {title}
      </Link>
    </h3>
  );
}

function PostBody({ item, compact }: { item: NewsItem; compact: boolean }) {
  const post = item.post!;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {post.important ? <Badge strong>{STR.news.important}</Badge> : null}
        {post.pinned ? <Badge>{STR.news.pinned}</Badge> : null}
        {post.draft ? <Badge>{STR.news.draft}</Badge> : null}
        {post.scheduled ? <Badge>{STR.news.scheduled}</Badge> : null}
        <PostTitle item={item} compact={compact} />
      </div>
      {post.body && !compact ? <Markdown source={post.body} headingOffset={3} /> : null}
    </div>
  );
}

function Meta({ item }: { item: NewsItem }) {
  const who = item.post?.author ?? item.actor;
  const audience = item.post
    ? item.post.team
      ? STR.news.forTeam(item.post.team)
      : STR.news.forEveryone
    : null;
  return (
    <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted">
      <RelativeTime iso={item.at} />
      {who ? <span translate="no">{STR.news.by(who)}</span> : null}
      {audience ? <span>{audience}</span> : null}
    </div>
  );
}

const rowAction =
  "inline-flex min-h-6 items-center rounded-sf border border-line px-2 py-0.5 text-xs text-ink-2 hover:bg-surface-2";

/** Edit and Delete of a post, only when the reader may edit it (`post.can_edit`). */
function PostActions({
  item,
  onEdit,
  onDelete,
}: {
  item: NewsItem;
  onEdit?: (item: NewsItem) => void;
  onDelete?: (item: NewsItem) => void;
}) {
  const post = item.post;
  if (!post?.can_edit || (!onEdit && !onDelete)) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {onEdit ? (
        <button
          type="button"
          data-testid="news-post-edit"
          aria-label={STR.news.editLabel(post.title)}
          onClick={() => onEdit(item)}
          className={rowAction}
        >
          {STR.news.edit}
        </button>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          data-testid="news-post-delete"
          aria-label={STR.news.deleteLabel(post.title)}
          onClick={() => onDelete(item)}
          className={`${rowAction} hover:text-danger`}
        >
          {STR.news.delete}
        </button>
      ) : null}
    </div>
  );
}

type Props = {
  item: NewsItem;
  compact?: boolean;
  testId?: string;
  ref?: Ref<HTMLLIElement>;
  /** Shown on a post row with `post.can_edit` (not in the compact tile). */
  onEdit?: (item: NewsItem) => void;
  onDelete?: (item: NewsItem) => void;
};

/** One news item as a list row; a post shows its Markdown body through `Markdown` only (no raw HTML). */
export function NewsEntry({
  item,
  compact = false,
  testId = "news-item",
  ref,
  onEdit,
  onDelete,
}: Props) {
  const important = !!item.post?.important;
  return (
    <li
      ref={ref}
      id={compact ? undefined : newsRowId(item.id)}
      tabIndex={-1}
      data-testid={testId}
      data-kind={item.kind}
      className={`rounded-sf border bg-surface p-3 text-sm focus:outline-2 focus:outline-offset-2 focus:outline-accent ${important ? "border-danger" : "border-line"}`}
    >
      {item.post ? <PostBody item={item} compact={compact} /> : <EventText item={item} />}
      <Meta item={item} />
      {compact ? null : <PostActions item={item} onEdit={onEdit} onDelete={onDelete} />}
    </li>
  );
}

const DAY = 86_400_000;

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Heading of a day group: Today, Yesterday or the date in the reader's locale. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (dayKey(d) === dayKey(now)) return STR.news.today;
  if (dayKey(d) === dayKey(new Date(now.getTime() - DAY))) return STR.news.yesterday;
  return d.toLocaleDateString(locale(), { year: "numeric", month: "long", day: "numeric" });
}

/** Items grouped by local day, in feed order. */
export function groupByDay(items: NewsItem[]): { key: string; label: string; items: NewsItem[] }[] {
  const groups: { key: string; label: string; items: NewsItem[] }[] = [];
  for (const item of items) {
    const key = dayKey(new Date(item.at));
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label: dayLabel(item.at), items: [item] });
  }
  return groups;
}

/** An error with a retry; inside the tile or the page, it never hides anything around it. */
export function NewsError({
  message,
  onRetry,
  pending = false,
}: {
  message: string;
  onRetry: () => void;
  pending?: boolean;
}) {
  return (
    <div
      data-testid="news-error"
      role="alert"
      className="rounded-sf border border-line bg-surface p-4 text-sm"
    >
      <p className="text-ink">{message}</p>
      <Button
        type="button"
        data-testid="news-retry"
        pending={pending}
        onClick={onRetry}
        className="mt-2 min-h-6 rounded-sf bg-accent px-3 py-1.5 text-sm font-medium text-on-accent"
      >
        {STR.common.retry}
      </Button>
    </div>
  );
}
