import type { ChatMessage } from "./client.ts";
import type { CorpusTopic, HelpLang } from "./corpus.ts";
import { topTopics } from "./retrieval.ts";

/**
 * Model context for the help assistant. The system message is in English
 * (models follow it most reliably) and demands the interface language. It holds the rules, the user's role, a map of
 * all help topics and the full text of the topics closest to the question. No other registry data goes in.
 */
export type AssistantMode = "onboarding" | "consult";

/** English name of the interface language, for the instruction to the model ("Answer in German"). */
function languageName(lang: HelpLang): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(lang) ?? lang;
  } catch {
    return lang;
  }
}
const BODY_LIMIT = 6000;
/** Onboarding starts from the basics even before the user says anything. */
const ONBOARDING_TOPICS = [
  "getting-started/overview",
  "getting-started/roles",
  "getting-started/install",
];

const RULES = [
  "Answer only about SkillForge, using the help topics below. If the help does not cover the question, say so and suggest the closest topic.",
  "Link help topics as markdown links with the path, for example [Lifecycle statuses](/help/getting-started/lifecycle). Never invent pages, buttons or settings that the topics do not describe.",
  "If the question is ambiguous or you lack facts about the user's goal, first ask one or two short clarifying questions.",
  "You are read-only: you cannot perform any action, change data or call tools. Explain how the user can do it themselves.",
  "Never ask for, accept or repeat secrets, API tokens or passwords. If the user pastes one, tell them to revoke it.",
  "Keep answers short and practical: steps, then links.",
];

const MODE_RULES: Record<AssistantMode, string> = {
  onboarding:
    "Mode: onboarding. Help a newcomer get started. If you do not yet know what the user wants to achieve, begin by asking 1-3 clarifying questions (their task in SkillForge and which coding agent they use; their role is known). Then give a short step-by-step path through the help with links.",
  consult:
    "Mode: consultation. Answer the user's question. If it can be read in several ways, ask a clarifying question first.",
};

function topicBlock(t: CorpusTopic): string {
  const body = t.body.length > BODY_LIMIT ? `${t.body.slice(0, BODY_LIMIT)}\n…` : t.body;
  return `### ${t.title} (/help/${t.id})\n${t.summary}\n\n${body}`;
}

type BuildOpts = {
  mode: AssistantMode;
  lang: HelpLang;
  role: string;
  pageTopic: string | null;
  messages: ChatMessage[];
  corpus: CorpusTopic[];
  contextTopics: number;
};

/** Topics for the context: the current page first, onboarding basics, then the closest to the recent user turns. */
function pickTopics(o: BuildOpts): CorpusTopic[] {
  const byId = new Map(o.corpus.map((t) => [t.id, t]));
  const query = o.messages
    .filter((m) => m.role === "user")
    .slice(-2)
    .map((m) => m.content)
    .join("\n");
  const pinned = [o.pageTopic, ...(o.mode === "onboarding" ? ONBOARDING_TOPICS : [])]
    .map((id) => (id ? byId.get(id) : undefined))
    .filter((t): t is CorpusTopic => !!t);
  const found = topTopics(o.corpus, query, o.contextTopics);
  const out: CorpusTopic[] = [];
  for (const t of [...pinned, ...found])
    if (!out.includes(t) && out.length < o.contextTopics + pinned.length) out.push(t);
  return out;
}

export function buildMessages(o: BuildOpts): ChatMessage[] {
  const topics = pickTopics(o);
  const system = [
    "You are the SkillForge help assistant inside the SkillForge web app (an internal registry of skills, commands, agents, hooks, plugins and settings profiles for AI coding agents).",
    MODE_RULES[o.mode],
    `Always answer in ${languageName(o.lang)}, the language of the user's interface. Keep product terms that the help keeps in English (statuses, roles, codes, commands).`,
    ...RULES,
    `The user's role: ${o.role}.`,
    "## Map of help topics",
    o.corpus.map((t) => `- /help/${t.id} — ${t.title}`).join("\n"),
    "## Relevant help topics",
    topics.map(topicBlock).join("\n\n"),
  ].join("\n\n");
  const turns = o.messages.length
    ? o.messages
    : [
        {
          role: "user" as const,
          content: "(The user opened the onboarding assistant and has not written anything yet.)",
        },
      ];
  return [{ role: "system", content: system }, ...turns];
}
