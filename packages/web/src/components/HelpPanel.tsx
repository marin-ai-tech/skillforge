import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Link } from "react-router";
import { HelpTopicView, type TopicLink } from "./HelpTopicView.tsx";
import { useHelp } from "../help/HelpProvider.tsx";
import { useHelpTopics } from "../help/index.ts";
import { Skeleton } from "./Skeleton.tsx";
import { HelpTip } from "./HelpTip.tsx";
import { useQuery } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { getAssistantStatus } from "../api/assistant.ts";
import { buildSections } from "../help/sections.ts";
import { STR } from "../lib/strings.ts";

/** Footer: open the topic in the help center, or ask the assistant about this page (llm-help-assistant). */
function PanelFooter({ current, close }: { current: string; close: () => void }) {
  const assistant = useQuery({
    queryKey: ["assistant-status"],
    queryFn: getAssistantStatus,
    staleTime: 30_000,
  });
  const assistantShown =
    !!assistant.data && (assistant.data.available || assistant.data.reason === "sign_in");
  return (
    <div className="flex flex-wrap items-center gap-4 border-t border-line px-4 py-3">
      {assistantShown ? (
        <HelpTip action="help-ask-assistant">
          <Link
            data-testid="help-ask-assistant"
            to={`/help?assistant=consult&topic=${encodeURIComponent(current)}`}
            className="inline-flex items-center gap-1.5 text-sm text-accent"
            onClick={close}
          >
            <Bot size={14} aria-hidden="true" />
            {STR.tips.help.askAssistant}
          </Link>
        </HelpTip>
      ) : null}
      <Link
        data-testid="help-open-center"
        to={`/help/${current}`}
        className="text-sm text-accent underline"
        onClick={close}
      >
        {STR.tips.help.openInCenter}
      </Link>
    </div>
  );
}

export function HelpPanel() {
  const { open, current, close, openTopic, back, canBack } = useHelp();
  const panelRef = useRef<HTMLDivElement>(null);
  const topics = useHelpTopics();
  const topic = current && !topics.loading ? topics.get(current) : undefined;
  const sections = useMemo(() => buildSections(topics.list), [topics.list]);
  const link: TopicLink = (id: string, children: ReactNode, className = "") => (
    <a
      href={`#help/${id}`}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        openTopic(id);
      }}
    >
      {children}
    </a>
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current) return;
      if (!panelRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, close]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/20" role="presentation">
      <div
        ref={panelRef}
        data-testid="help-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-panel-title"
        className="flex h-full w-full max-w-md flex-col border-l border-line bg-surface shadow-lg"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          {canBack ? (
            <button
              type="button"
              className="rounded-sf border border-line px-2 py-1 text-sm text-ink-2 hover:bg-surface-2"
              onClick={back}
            >
              {STR.tips.help.back}
            </button>
          ) : null}
          <h2
            id="help-panel-title"
            data-testid="help-panel-title"
            className="flex-1 text-base font-semibold"
          >
            {topic ? (
              <span lang={topic.lang} translate="no">
                {topic.title}
              </span>
            ) : (
              (current ?? STR.tips.help.panelTitle)
            )}
          </h2>
          <button
            type="button"
            data-testid="help-close"
            className="rounded-sf border border-line px-2 py-1 text-sm text-ink-2 hover:bg-surface-2"
            onClick={close}
          >
            {STR.tips.help.close}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {topic && topic.lang === "en" && STR.tips.help.langNote ? (
            <p
              data-testid="help-lang-note"
              className="mb-3 rounded-sf border border-line bg-surface-2 px-3 py-2 text-sm text-muted"
            >
              {STR.tips.help.langNote}
            </p>
          ) : null}
          {topics.loading ? (
            <Skeleton className="h-40" />
          ) : topic ? (
            <div data-testid="help-panel-body">
              <HelpTopicView
                topic={topic}
                sections={sections}
                link={link}
                get={topics.get}
                variant="panel"
              />
            </div>
          ) : (
            <p className="text-sm text-muted">{STR.tips.help.topicNotFound}</p>
          )}
        </div>
        {current ? <PanelFooter current={current} close={close} /> : null}
      </div>
    </div>
  );
}
