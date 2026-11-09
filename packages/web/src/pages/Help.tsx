import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader.tsx";
import { HelpTip } from "../components/HelpTip.tsx";
import { StickyBar } from "../components/StickyBar.tsx";
import { Skeleton } from "../components/Skeleton.tsx";
import { HelpNav } from "../components/HelpNav.tsx";
import { HelpToc, HelpTopicView, type TopicLink } from "../components/HelpTopicView.tsx";
import { useHelpTopics, type HelpTopic, type HelpTopics } from "../help/index.ts";
import type { HelpNavSection } from "../help/sections.ts";
import { buildSections } from "../help/sections.ts";
import { STR } from "../lib/strings.ts";
import { AssistantChat } from "../components/AssistantChat.tsx";
import { getAssistantStatus, type AssistantMode } from "../api/assistant.ts";

const link: TopicLink = (id: string, children: ReactNode, className = "", current = false) => (
  <Link to={`/help/${id}`} className={className} aria-current={current ? "page" : undefined}>
    {children}
  </Link>
);

/** The topic in the help center; the English-only note shows when the topic is not translated yet. */
function TopicColumn({
  missing,
  topic,
  sections,
  get,
}: {
  missing: boolean;
  topic: HelpTopic | undefined;
  sections: HelpNavSection[];
  get: HelpTopics["get"];
}) {
  if (missing) {
    return (
      <div
        data-testid="help-not-found"
        className="rounded-sf border border-line bg-surface p-6 text-sm text-muted"
      >
        {STR.tips.help.pageTopicNotFound}
      </div>
    );
  }
  if (!topic) return null;
  return (
    <div data-testid="help-content" className="rounded-sf border border-line bg-surface p-5">
      {STR.tips.help.langNote && topic.lang === "en" ? (
        <p data-testid="help-page-lang-note" className="mb-3 text-sm text-muted">
          {STR.tips.help.langNote}
        </p>
      ) : null}
      <HelpTopicView topic={topic} sections={sections} link={link} get={get} variant="page" />
    </div>
  );
}

/** `?assistant=onboarding|consult` opens the assistant (llm-help-assistant); `&topic=` is the page it was asked from. */
function useAssistantView() {
  const [params, setParams] = useSearchParams();
  const status = useQuery({
    queryKey: ["assistant-status"],
    queryFn: getAssistantStatus,
    staleTime: 30_000,
  });
  const raw = params.get("assistant");
  const shown = !!status.data && (status.data.available || status.data.reason === "sign_in");
  const mode: AssistantMode | null =
    shown && (raw === "onboarding" || raw === "consult") ? raw : null;
  const open = (m: AssistantMode | null) => {
    const sp = new URLSearchParams(params);
    if (m) sp.set("assistant", m);
    else {
      sp.delete("assistant");
      sp.delete("topic");
    }
    setParams(sp);
  };
  return { shown, mode, status: status.data, open, pageTopic: params.get("topic") };
}

function ViewTabs({
  mode,
  open,
}: {
  mode: AssistantMode | null;
  open: (m: AssistantMode | null) => void;
}) {
  const cls = (on: boolean) =>
    `-mb-px border-b-2 px-3 py-1.5 text-sm ${on ? "border-accent font-medium text-ink" : "border-transparent text-muted"}`;
  return (
    <div role="tablist" className="flex gap-1 border-b border-line">
      <button
        type="button"
        role="tab"
        data-testid="help-reference-tab"
        aria-selected={!mode}
        className={cls(!mode)}
        onClick={() => open(null)}
      >
        {STR.tips.help.assistant.reference}
      </button>
      <HelpTip action="help-assistant-tab">
        <button
          type="button"
          role="tab"
          data-testid="help-assistant-tab"
          aria-selected={!!mode}
          className={cls(!!mode)}
          onClick={() => open(mode ?? "onboarding")}
        >
          {STR.tips.help.assistant.tab}
        </button>
      </HelpTip>
    </div>
  );
}

export function Help() {
  const params = useParams();
  // splat: /help/* -> params["*"]
  const topicId = (params["*"] || "").replace(/^\/+/, "");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    document.title = STR.tips.help.documentTitle;
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  const topics = useHelpTopics();
  const sections = useMemo(() => buildSections(topics.list), [topics.list]);
  const activeId = topicId || "getting-started/overview";
  const topic = topics.get(activeId);
  const results = debounced.trim() ? topics.search(debounced) : [];
  const matches = debounced.trim() ? new Set(results.map((t) => t.id)) : null;
  const assistant = useAssistantView();

  return (
    <div className="space-y-4">
      <StickyBar>
        <PageHeader title={STR.tips.help.pageTitle} topic="pages/help" />

        <HelpTip action="help-search">
          <input
            data-testid="help-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={STR.tips.help.searchPlaceholder}
            className="w-full max-w-md rounded-sf border border-line bg-surface px-3 py-1.5 text-sm"
          />
        </HelpTip>

        {assistant.shown ? <ViewTabs mode={assistant.mode} open={assistant.open} /> : null}

        {results.length > 0 ? (
          <div
            data-testid="help-results"
            className="max-h-[40vh] overflow-y-auto rounded-sf border border-line bg-surface p-3"
          >
            <ul className="space-y-1">
              {results.map((t) => (
                <li key={t.id}>
                  <Link to={`/help/${t.id}`} className="text-sm text-accent underline">
                    <span lang={t.lang} translate="no">
                      {t.title}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </StickyBar>

      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_200px]">
        <HelpNav sections={sections} activeId={activeId} matches={matches} link={link} />

        <div className="min-w-0">
          {assistant.mode && assistant.status ? (
            <AssistantChat
              mode={assistant.mode}
              onMode={assistant.open}
              status={assistant.status}
              pageTopic={assistant.pageTopic}
            />
          ) : topics.loading ? (
            <Skeleton className="h-64" />
          ) : (
            <TopicColumn
              missing={!!topicId && !topic}
              topic={topic}
              sections={sections}
              get={topics.get}
            />
          )}
        </div>

        <aside className="hidden xl:block">
          {topic && !topics.loading && !assistant.mode ? <HelpToc topic={topic} /> : null}
        </aside>
      </div>
    </div>
  );
}
