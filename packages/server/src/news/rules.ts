// news: pure decisions — which registry events are news. The single place for the rules of the spec
// (the news spec, "News and automatic events"); record.ts only gathers the facts.

/** Every kind of a news item; checked here once, not by a CHECK in the schema that would repeat the list. */
export const NEWS_KINDS = ["new_artifact", "new_version", "status_change", "post"] as const;
export type NewsKind = (typeof NEWS_KINDS)[number];
export type AutoNewsKind = Exclude<NewsKind, "post">;

export function isNewsKind(value: unknown): value is NewsKind {
  return typeof value === "string" && (NEWS_KINDS as readonly string[]).includes(value);
}

/** A status change of an artifact, with what is known of its past. */
export type TransitionFacts = {
  from: string;
  to: string;
  /** The artifact has been `active` before this transition. */
  wasActiveBefore: boolean;
};

/**
 * `new_artifact` — first time `active`; `status_change` — to `zombie` or `retired`, or back to `active` of an
 * artifact that has been active (from `aging`, `zombie`, or through `candidate` after `retired`). Nothing for
 * `aging` and nothing for events of a `candidate` (`candidate` → `retired`, `retired` → `candidate`).
 */
export function transitionNewsKind(facts: TransitionFacts): AutoNewsKind | null {
  const { from, to } = facts;
  if (to === "active") {
    const before = facts.wasActiveBefore || from === "aging" || from === "zombie";
    return before ? "status_change" : "new_artifact";
  }
  if (from === "candidate") return null;
  return to === "zombie" || to === "retired" ? "status_change" : null;
}

/** A version that lands in a channel (publication or a channel change). */
export type VersionFacts = {
  channel: string;
  /** Status of the artifact at the moment of the event. */
  status: string;
  /** Another version of the artifact was already `stable`. */
  hadStableBefore: boolean;
};

/** `new_version` — a version becomes `stable`, not the first stable one, of an artifact neither candidate nor retired. */
export function versionNewsKind(facts: VersionFacts): AutoNewsKind | null {
  if (facts.channel !== "stable") return null;
  if (facts.status === "candidate" || facts.status === "retired") return null;
  return facts.hadStableBefore ? "new_version" : null;
}

/** Automatic news is kept this long; posts are never removed automatically. */
export const AUTO_NEWS_RETENTION_DAYS = 365;
