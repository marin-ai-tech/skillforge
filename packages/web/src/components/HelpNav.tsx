import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { HelpTopic } from "../help/index.ts";
import {
  groupIcon,
  placeOf,
  sectionTopics,
  type HelpNavGroup,
  type HelpNavSection,
} from "../help/sections.ts";
import { groupLabel, sectionLabel, type TopicLink } from "./HelpTopicView.tsx";
import { STR } from "../lib/strings.ts";

const STORE_KEY = "sf.help.nav.expanded";

function loadExpanded(): string[] {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveExpanded(ids: Set<string>): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage unavailable (private window, blocked site data): expansion is a per-visit convenience.
  }
}

type Props = {
  sections: HelpNavSection[];
  activeId: string;
  /** Topic ids matching the search; `null` when not searching. */
  matches: Set<string> | null;
  link: TopicLink;
};

type Ctx = {
  activeId: string;
  matches: Set<string> | null;
  link: TopicLink;
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
};

function Toggle({
  id,
  open,
  count,
  onClick,
  children,
}: {
  id: string;
  open: boolean;
  count: number;
  onClick: () => void;
  children: ReactNode;
}) {
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={`help-nav-${id}`}
      onClick={onClick}
      className="flex w-full items-center gap-1.5 rounded-sf px-1.5 py-1 text-left hover:bg-surface-2"
    >
      <Chevron size={14} className="shrink-0 text-muted" aria-hidden="true" />
      {children}
      <span className="ml-auto rounded-full bg-surface-2 px-1.5 text-xs text-muted">{count}</span>
    </button>
  );
}

function TopicItems({ id, topics, ctx }: { id: string; topics: HelpTopic[]; ctx: Ctx }) {
  return (
    <ul id={`help-nav-${id}`} className="ml-3 space-y-0.5 border-l border-line pl-2">
      {topics.map((t) => {
        const active = t.id === ctx.activeId;
        return (
          <li key={t.id}>
            {ctx.link(
              t.id,
              // Colour on the span: the global `a` colour is unlayered and beats utilities on the link.
              <span
                lang={t.lang}
                translate="no"
                className={active ? "text-accent" : "text-ink-2 hover:text-accent"}
              >
                {t.title}
              </span>,
              `block rounded-sf px-1.5 py-0.5 hover:bg-surface-2 ${active ? "bg-accent-soft font-medium" : ""}`,
              active,
            )}
          </li>
        );
      })}
    </ul>
  );
}

const visible = (topics: HelpTopic[], matches: Set<string> | null) =>
  matches ? topics.filter((t) => matches.has(t.id)) : topics;

function Group({ group, ctx }: { group: HelpNavGroup; ctx: Ctx }) {
  const topics = visible(group.topics, ctx.matches);
  if (topics.length === 0) return null;
  const open = ctx.matches !== null || ctx.isOpen(group.id);
  const Icon = groupIcon(group.id);
  return (
    <li data-testid="help-nav-group" data-group={group.id}>
      <Toggle id={group.id} open={open} count={topics.length} onClick={() => ctx.toggle(group.id)}>
        {Icon ? <Icon size={14} className="shrink-0 text-muted" aria-hidden="true" /> : null}
        <span className="text-ink-2">{groupLabel(group.id)}</span>
      </Toggle>
      {open ? <TopicItems id={group.id} topics={topics} ctx={ctx} /> : null}
    </li>
  );
}

function Section({ section, ctx }: { section: HelpNavSection; ctx: Ctx }) {
  const total = visible(sectionTopics(section), ctx.matches).length;
  if (total === 0) return null;
  const open = ctx.matches !== null || ctx.isOpen(section.id);
  const Icon = section.icon;
  return (
    <div data-testid="help-nav-section" data-section={section.id}>
      <Toggle id={section.id} open={open} count={total} onClick={() => ctx.toggle(section.id)}>
        <Icon size={16} className="shrink-0 text-accent" aria-hidden="true" />
        <span className="font-medium text-ink">{sectionLabel(section.id)}</span>
      </Toggle>
      {open && section.groups.length > 0 ? (
        <ul id={`help-nav-${section.id}`} className="ml-3 space-y-0.5">
          {section.groups.map((g) => (
            <Group key={g.id} group={g} ctx={ctx} />
          ))}
        </ul>
      ) : null}
      {open && section.groups.length === 0 ? (
        <TopicItems id={section.id} topics={visible(section.topics, ctx.matches)} ctx={ctx} />
      ) : null}
    </div>
  );
}

/** Collapsible tree of help sections: only the current topic's section opens by itself; search filters the tree. */
export function HelpNav({ sections, activeId, matches, link }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(loadExpanded()));

  useEffect(() => {
    const place = placeOf(activeId, sections);
    if (!place) return;
    setExpanded((prev) => {
      const ids = [place.section.id, place.group?.id].filter((x): x is string => !!x);
      if (ids.every((id) => prev.has(id))) return prev;
      return new Set([...prev, ...ids]);
    });
  }, [activeId, sections]);

  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    // Bring the open topic into the tree's own scroll area (never scrolls the page).
    const nav = navRef.current;
    const current = nav?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (!nav || !current || nav.scrollHeight <= nav.clientHeight) return;
    const top = current.getBoundingClientRect().top - nav.getBoundingClientRect().top;
    if (top < 0 || top > nav.clientHeight - current.offsetHeight) {
      nav.scrollTop += top - nav.clientHeight / 2;
    }
  }, [activeId, expanded]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveExpanded(next);
      return next;
    });

  const ctx: Ctx = { activeId, matches, link, isOpen: (id) => expanded.has(id), toggle };
  return (
    <nav
      ref={navRef}
      data-testid="help-nav"
      aria-label={STR.tips.help.navLabel}
      // Pinned beside the topic on wide screens, with its own scroll: the tree stays on screen while the topic scrolls.
      className="space-y-1 text-sm sf-below-chrome-lg lg:sticky lg:self-start lg:overflow-y-auto lg:pr-1"
    >
      {sections.map((s) => (
        <Section key={s.id} section={s} ctx={ctx} />
      ))}
    </nav>
  );
}
