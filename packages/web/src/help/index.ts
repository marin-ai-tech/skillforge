import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useLang, type Lang } from "../i18n/index.ts";
import { topicsFromModules, type HelpTopic } from "./topic.ts";

export type { HelpArea, HelpTopic } from "./topic.ts";

const enTopics = topicsFromModules(
  import.meta.glob("./topics/**/*.md", { query: "?raw", import: "default", eager: true }) as Record<
    string,
    string
  >,
  "./topics/",
  "en",
);

export function getTopic(id: string): HelpTopic | undefined {
  return enTopics.get(id);
}

export function listTopics(): HelpTopic[] {
  return [...enTopics.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function search(topics: HelpTopic[], query: string): HelpTopic[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return topics.filter(
    (t) =>
      t.id.toLowerCase().includes(q) ||
      t.title.toLowerCase().includes(q) ||
      t.summary.toLowerCase().includes(q) ||
      t.body.toLowerCase().includes(q),
  );
}

export function searchTopics(query: string): HelpTopic[] {
  return search(listTopics(), query);
}

// Translated topics: a module `help/topics-<code>.ts` per language, each a separate chunk loaded on demand.
const LOADERS = import.meta.glob<{ topics: Map<string, HelpTopic> }>("./topics-*.ts");
const loaderOf = (lang: Lang) => LOADERS[`./topics-${lang}.ts`];
const translated = new Map<Lang, Map<string, HelpTopic>>();
const loading = new Set<Lang>();
const listeners = new Set<() => void>();

function loadTopics(lang: Lang): void {
  const load = loaderOf(lang);
  if (!load || translated.has(lang) || loading.has(lang)) return;
  loading.add(lang);
  load().then(
    (m) => {
      loading.delete(lang);
      translated.set(lang, m.topics);
      for (const l of listeners) l();
    },
    () => {
      // The chunk failed to load (network): allow a retry; English topics with the language note stay visible.
      loading.delete(lang);
      translated.set(lang, new Map());
      for (const l of listeners) l();
    },
  );
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export type HelpTopics = {
  /** True while the topics of the interface language are still loading. */
  loading: boolean;
  /** All topics, each in the interface language when translated (`lang` says which). */
  list: HelpTopic[];
  get: (id: string) => HelpTopic | undefined;
  search: (query: string) => HelpTopic[];
};

/** Help topics in the interface language, with English topics where a translation is missing. */
export function useHelpTopics(): HelpTopics {
  const lang = useLang();
  useEffect(() => loadTopics(lang), [lang]);
  const local = useSyncExternalStore(subscribe, () => translated.get(lang) ?? null);
  const pending = !!loaderOf(lang) && local === null;
  return useMemo(() => {
    const get = (id: string) => local?.get(id) ?? enTopics.get(id);
    const list = listTopics().map((t) => local?.get(t.id) ?? t);
    return {
      loading: pending,
      list,
      get,
      search: (query: string) => search(list, query),
    };
  }, [local, pending]);
}
