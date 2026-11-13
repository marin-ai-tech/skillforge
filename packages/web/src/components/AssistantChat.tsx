import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useQueryClient } from "@tanstack/react-query";
import { Bot, Send, Square, RotateCcw } from "lucide-react";
import {
  streamAssistantChat,
  type AssistantMode,
  type AssistantStatus,
  type AssistantTurn,
} from "../api/assistant.ts";
import { HelpTip } from "./HelpTip.tsx";
import { errorText, useLang } from "../i18n/index.ts";
import { STR } from "../lib/strings.ts";
import { Button } from "./Button.tsx";

/**
 * Read-only help assistant: a conversation kept in this tab's
 * sessionStorage, answers streamed from the server. Answers render as markdown without HTML; only help links
 * (`/help/…`) are links, anything else stays plain text.
 */
type Props = {
  mode: AssistantMode;
  onMode: (m: AssistantMode) => void;
  status: AssistantStatus;
  pageTopic: string | null;
};

const STORE_KEY = "sf.assistant.conversation";

type Stored = { mode: AssistantMode; turns: AssistantTurn[] };

function loadStored(mode: AssistantMode): AssistantTurn[] {
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Stored) : null;
    return parsed && parsed.mode === mode && Array.isArray(parsed.turns) ? parsed.turns : [];
  } catch {
    return [];
  }
}

function saveStored(mode: AssistantMode, turns: AssistantTurn[]): void {
  try {
    window.sessionStorage.setItem(STORE_KEY, JSON.stringify({ mode, turns }));
  } catch {
    // Storage unavailable: the conversation simply does not survive a reload.
  }
}

/** Only plain help topic paths are links: no `..`, no query, no other routes. */
const HELP_LINK = /^\/help\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*(?:#[A-Za-z0-9_-]+)?$/;

/** A link outside the help is shown as text with its address, never as a clickable link. */
function ExternalAsText({ href, children }: { href?: string; children: ReactNode }) {
  const label = typeof children === "string" ? children : null;
  if (!href || label === href) return <span>{children}</span>;
  return (
    <span>
      {children} ({href})
    </span>
  );
}

/** Markdown of an assistant answer: help links are router links, other links and images become text. */
function AnswerMarkdown({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed text-ink-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) =>
            href && HELP_LINK.test(href) ? (
              <Link to={href}>{children}</Link>
            ) : (
              <ExternalAsText href={href}>{children}</ExternalAsText>
            ),
          img: ({ alt }) => <span>{alt}</span>,
          code: ({ children }) => (
            <code className="rounded bg-surface-2 px-1 font-mono text-[13px]">{children}</code>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function Message({ turn, pending }: { turn: AssistantTurn; pending: boolean }) {
  const mine = turn.role === "user";
  return (
    <div
      data-testid="assistant-message"
      data-role={turn.role}
      className={`rounded-sf border px-3 py-2 ${mine ? "ml-8 border-line bg-surface-2" : "mr-8 border-line bg-surface"}`}
    >
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase text-muted">
        {mine ? null : <Bot size={14} aria-hidden="true" />}
        {mine ? STR.tips.help.assistant.you : STR.tips.help.assistant.bot}
      </div>
      {mine ? (
        <p className="whitespace-pre-wrap text-sm text-ink">{turn.content}</p>
      ) : turn.content ? (
        <AnswerMarkdown text={turn.content} />
      ) : (
        <p className="text-sm text-muted">{pending ? STR.tips.help.assistant.thinking : ""}</p>
      )}
    </div>
  );
}

function ModeSwitch({ mode, onMode }: { mode: AssistantMode; onMode: (m: AssistantMode) => void }) {
  const button = (m: AssistantMode, label: string) => (
    <HelpTip action="assistant-mode">
      <button
        type="button"
        data-testid={`assistant-mode-${m}`}
        aria-pressed={mode === m}
        onClick={() => onMode(m)}
        className={`rounded-sf border px-3 py-1 text-sm ${mode === m ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-2 hover:bg-surface-2"}`}
      >
        {label}
      </button>
    </HelpTip>
  );
  return (
    <div className="flex flex-wrap gap-2">
      {button("onboarding", STR.tips.help.assistant.modeOnboarding)}
      {button("consult", STR.tips.help.assistant.modeConsult)}
    </div>
  );
}

function SignIn() {
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  return (
    <div
      data-testid="assistant-sign-in"
      className="rounded-sf border border-line bg-surface p-4 text-sm text-ink-2"
    >
      {STR.tips.help.assistant.signIn}{" "}
      <Link to={`/login?next=${next}`}>{STR.tips.help.assistant.signInLink}</Link>
    </div>
  );
}

function Shell({
  children,
  mode,
  onMode,
}: {
  children: ReactNode;
  mode: AssistantMode;
  onMode: (m: AssistantMode) => void;
}) {
  return (
    <section
      data-testid="assistant-chat"
      aria-label={STR.tips.help.assistant.chatLabel}
      className="space-y-3 rounded-sf border border-line bg-surface p-4"
    >
      <p className="text-sm text-ink-2">{STR.tips.help.assistant.intro}</p>
      <ModeSwitch mode={mode} onMode={onMode} />
      {children}
    </section>
  );
}

/**
 * Agent Space task budget grant (llm-budget-broker): shown only when the server has a budget broker. The value lives in
 * component state only — never in localStorage or the stored conversation — and goes with each question.
 */
/** While an answer streams the field is read-only (not disabled): focus stays where the person left it. */
function BudgetGrantField({
  value,
  onChange,
  busy,
}: {
  value: string;
  onChange: (v: string) => void;
  busy: boolean;
}) {
  return (
    <HelpTip action="assistant-budget-grant">
      <label className="block text-xs text-muted">
        {STR.tips.help.assistant.budgetGrant}
        <input
          data-testid="assistant-budget-grant"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={busy}
          aria-disabled={busy || undefined}
          aria-describedby="assistant-budget-grant-hint"
          className="mt-1 w-full rounded-sf border border-line bg-bg px-3 py-2 text-sm"
        />
        <span id="assistant-budget-grant-hint" className="mt-1 block">
          {STR.tips.help.assistant.budgetGrantHint}
        </span>
      </label>
    </HelpTip>
  );
}

export function AssistantChat({ mode, onMode, status, pageTopic }: Props) {
  const lang = useLang();
  const queryClient = useQueryClient();
  const [turns, setTurns] = useState<AssistantTurn[]>(() => loadStored(mode));
  const [input, setInput] = useState("");
  const [budgetGrant, setBudgetGrant] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoStarted = useRef(false);

  useEffect(() => {
    abortRef.current?.abort();
    setTurns(loadStored(mode));
    autoStarted.current = false;
  }, [mode]);

  useEffect(() => saveStored(mode, turns), [mode, turns]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function send(history: AssistantTurn[]) {
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setTurns([...history, { role: "assistant", content: "" }]);
    try {
      await streamAssistantChat({
        mode,
        lang,
        pageTopic,
        messages: history,
        budgetGrant: budgetGrant.trim() || undefined,
        signal: controller.signal,
        onDelta: (text) =>
          setTurns((prev) => {
            const last = prev[prev.length - 1]!;
            return [...prev.slice(0, -1), { ...last, content: last.content + text }];
          }),
      });
    } catch (e) {
      if (!controller.signal.aborted) setError(errorText(e));
    } finally {
      setBusy(false);
      abortRef.current = null;
      setTurns((prev) =>
        prev.at(-1)?.role === "assistant" && !prev.at(-1)?.content ? prev.slice(0, -1) : prev,
      );
      void queryClient.invalidateQueries({ queryKey: ["assistant-status"] });
    }
  }

  // Onboarding starts the conversation itself: the assistant asks about the user's goal first.
  useEffect(() => {
    if (!status.available || mode !== "onboarding" || turns.length > 0 || autoStarted.current)
      return;
    autoStarted.current = true;
    void send([]);
  }, [status.available, mode, turns.length]);

  if (!status.available) {
    return (
      <Shell mode={mode} onMode={onMode}>
        <SignIn />
      </Shell>
    );
  }

  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    void send([...turns, { role: "user", content: text }]);
  };

  return (
    <Shell mode={mode} onMode={onMode}>
      {status.budget_grant ? (
        <BudgetGrantField value={budgetGrant} onChange={setBudgetGrant} busy={busy} />
      ) : null}
      {mode === "onboarding" ? (
        <p className="text-xs text-muted">{STR.tips.help.assistant.onboardingHint}</p>
      ) : null}
      <div className="space-y-2" aria-live="polite">
        {turns.map((t, i) => (
          <Message key={i} turn={t} pending={busy && i === turns.length - 1} />
        ))}
      </div>
      {error ? (
        <p data-testid="assistant-error" role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          data-testid="assistant-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          maxLength={4000}
          rows={3}
          placeholder={STR.tips.help.assistant.placeholder}
          className="w-full rounded-sf border border-line bg-bg px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          {busy ? (
            <HelpTip action="assistant-stop">
              <button
                type="button"
                data-testid="assistant-stop"
                onClick={() => abortRef.current?.abort()}
                className="inline-flex items-center gap-1.5 rounded-sf border border-line px-3 py-1.5 text-sm"
              >
                <Square size={14} aria-hidden="true" />
                {STR.tips.help.assistant.stop}
              </button>
            </HelpTip>
          ) : (
            <HelpTip action="assistant-send">
              <button
                type="submit"
                data-testid="assistant-send"
                disabled={!input.trim()}
                className="inline-flex items-center gap-1.5 rounded-sf bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                <Send size={14} aria-hidden="true" />
                {STR.tips.help.assistant.send}
              </button>
            </HelpTip>
          )}
          <HelpTip action="assistant-new">
            <Button
              type="button"
              data-testid="assistant-new"
              pending={busy}
              onClick={() => {
                setTurns([]);
                setError(null);
                autoStarted.current = mode !== "onboarding";
              }}
              className="inline-flex items-center gap-1.5 rounded-sf border border-line px-3 py-1.5 text-sm text-ink-2 disabled:opacity-50"
            >
              <RotateCcw size={14} aria-hidden="true" />
              {STR.tips.help.assistant.newChat}
            </Button>
          </HelpTip>
          {typeof status.remaining_today === "number" ? (
            <span className="ml-auto text-xs text-muted">
              {STR.tips.help.assistant.remaining(status.remaining_today)}
            </span>
          ) : null}
        </div>
      </form>
      <p className="text-xs text-muted">{STR.tips.help.assistant.disclaimer}</p>
    </Shell>
  );
}
