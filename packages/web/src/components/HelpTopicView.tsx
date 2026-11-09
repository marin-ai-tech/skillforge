import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, BookOpen, ChevronRight } from "lucide-react";
import { Markdown } from "./Markdown.tsx";
import type { HelpTopic } from "../help/index.ts";
import { placeOf, type HelpNavSection } from "../help/sections.ts";
import { tocOf } from "../help/markdown.ts";
import { STR } from "../lib/strings.ts";

/**
 * Renders a link to another help topic: a router link in the help center, an in-panel switch in the side panel.
 * `current` marks the link to the open topic (`aria-current="page"`).
 */
export type TopicLink = (
  id: string,
  children: ReactNode,
  className?: string,
  current?: boolean,
) => ReactNode;

type Props = {
  topic: HelpTopic;
  sections: HelpNavSection[];
  link: TopicLink;
  /** Topic by id in the interface language (related cards). */
  get: (id: string) => HelpTopic | undefined;
  /** `page` — help center (title, breadcrumbs, table of contents); `panel` — narrow side panel. */
  variant: "page" | "panel";
};

export const sectionLabel = (id: string) => STR.tips.help.sections[id] ?? id;
export const groupLabel = (id: string) => STR.tips.help.groups[id] ?? id.replace(/^actions-/, "");

/** Topic text is marked with its own language and never re-translated by the browser. */
const textOf = (t: HelpTopic) => ({ lang: t.lang, translate: "no" }) as const;

function Intro({ topic }: { topic: HelpTopic }) {
  if (!topic.summary && topic.learn.length === 0) return null;
  return (
    <div
      data-testid="help-intro"
      className="rounded-sf border-l-4 border-accent bg-accent-soft/40 px-4 py-3"
    >
      {topic.summary ? (
        <p className="text-sm text-ink" {...textOf(topic)}>
          {topic.summary}
        </p>
      ) : null}
      {topic.learn.length > 0 ? (
        <div className="mt-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted">
            <BookOpen size={14} aria-hidden="true" />
            {STR.tips.help.learn}
          </div>
          <ul
            data-testid="help-learn"
            className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink-2"
          >
            {topic.learn.map((item) => (
              <li key={item} {...textOf(topic)}>
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Related({ topic, sections, link, get }: Omit<Props, "variant">) {
  const items = topic.related.map((id) => ({ id, rel: get(id) }));
  if (items.length === 0) return null;
  return (
    <div data-testid="help-related" className="border-t border-line pt-4">
      <div className="mb-2 text-xs font-medium uppercase text-muted">{STR.tips.help.related}</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map(({ id, rel }) => {
          const Icon = placeOf(id, sections)?.section.icon ?? BookOpen;
          return (
            <div key={id}>
              {link(
                id,
                <span className="flex items-start gap-2">
                  <Icon size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block font-medium text-ink" {...textOf(rel ?? topic)}>
                      {rel?.title ?? id}
                    </span>
                    {rel?.summary ? (
                      <span className="line-clamp-2 block text-xs text-muted" {...textOf(rel)}>
                        {rel.summary}
                      </span>
                    ) : null}
                  </span>
                </span>,
                "block h-full rounded-sf border border-line p-2 text-sm no-underline hover:border-accent",
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PrevNext({ prev, next, link }: { prev?: HelpTopic; next?: HelpTopic; link: TopicLink }) {
  if (!prev && !next) return null;
  const cls =
    "flex min-w-0 items-center gap-1.5 rounded-sf border border-line px-3 py-2 text-sm no-underline hover:border-accent";
  return (
    <div data-testid="help-prevnext" className="flex justify-between gap-2">
      {prev ? (
        link(
          prev.id,
          <>
            <ArrowLeft size={14} aria-hidden="true" />
            <span className="text-muted">{STR.tips.help.prev}:</span>
            <span className="truncate text-ink" {...textOf(prev)}>
              {prev.title}
            </span>
          </>,
          cls,
        )
      ) : (
        <span />
      )}
      {next
        ? link(
            next.id,
            <>
              <span className="text-muted">{STR.tips.help.next}:</span>
              <span className="truncate text-ink" {...textOf(next)}>
                {next.title}
              </span>
              <ArrowRight size={14} aria-hidden="true" />
            </>,
            cls,
          )
        : null}
    </div>
  );
}

/** «On this page»: the topic's `##` headings, shown beside the topic on wide screens when there are three or more. */
export function HelpToc({ topic }: { topic: HelpTopic }) {
  const toc = tocOf(topic.body);
  if (toc.length < 3) return null;
  return (
    <nav
      data-testid="help-toc"
      aria-label={STR.tips.help.onThisPage}
      className="sf-below-chrome sticky overflow-y-auto text-sm"
    >
      <div className="mb-2 text-xs font-medium uppercase text-muted">
        {STR.tips.help.onThisPage}
      </div>
      <ul className="space-y-1 border-l border-line">
        {toc.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              className="-ml-px block border-l border-transparent pl-3 hover:border-accent"
              {...textOf(topic)}
            >
              <span className="text-ink-2 hover:text-accent">{h.text}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** One topic template for the help center and the side panel. */
export function HelpTopicView({ topic, sections, link, get, variant }: Props) {
  const place = placeOf(topic.id, sections);
  const Icon = place?.section.icon ?? BookOpen;
  return (
    <article className="space-y-4">
      {variant === "page" ? (
        <header className="space-y-1">
          {place ? (
            <div
              data-testid="help-breadcrumbs"
              className="flex flex-wrap items-center gap-1 text-xs text-muted"
            >
              <span>{sectionLabel(place.section.id)}</span>
              {place.group ? (
                <>
                  <ChevronRight size={12} aria-hidden="true" />
                  <span>{groupLabel(place.group.id)}</span>
                </>
              ) : null}
            </div>
          ) : null}
          <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
            <Icon size={22} className="shrink-0 text-accent" aria-hidden="true" />
            <span {...textOf(topic)}>{topic.title}</span>
          </h1>
        </header>
      ) : null}
      <Intro topic={topic} />
      <div {...textOf(topic)}>
        <Markdown source={topic.body} help />
      </div>
      <Related topic={topic} sections={sections} link={link} get={get} />
      <PrevNext prev={place?.prev} next={place?.next} link={link} />
    </article>
  );
}
