/**
 * Recurring rules in past work (skill-harvest): sentences that read like a rule — "always…", "never…", "avoid…" —
 * and recur in several sources (pull requests, session files). Code blocks and quotes are dropped first, so an
 * example in a comment is not a rule. Pure functions: callers decide where the text comes from.
 */
export type HarvestItem = { text: string; source: string; ref: string };
export type HarvestRule = { text: string; count: number; sources: number; evidence: string[] };

const LEAD = /^(?:please|pls|nit|nb|note|also|and|so|ok|okay)[\s,:]+/i;
const MARKERS = /^(?:always|never|don'?t|do not|avoid|use|prefer|make sure|must|should)\b/i;
const MAX_EVIDENCE = 20;

function stripCode(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith(">"))
    .join("\n");
}

function sentences(text: string): string[] {
  return stripCode(text)
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4 && s.length <= 200);
}

/** The sentence without lead-in words, or null when it does not read like a rule. */
function ruleOf(sentence: string): string | null {
  let s = sentence;
  for (let i = 0; i < 3 && LEAD.test(s); i++) s = s.replace(LEAD, "");
  return MARKERS.test(s) ? s : null;
}

function keyOf(rule: string): string {
  return rule
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function harvestRules(
  items: readonly HarvestItem[],
  opts: { minCount?: number; minSources?: number } = {},
): HarvestRule[] {
  const minCount = opts.minCount ?? 3;
  const minSources = opts.minSources ?? 2;
  const groups = new Map<
    string,
    { text: string; count: number; sources: Set<string>; refs: string[] }
  >();
  for (const item of items) {
    for (const sentence of sentences(item.text)) {
      const rule = ruleOf(sentence);
      if (!rule) continue;
      const key = keyOf(rule);
      const g = groups.get(key) ?? { text: rule, count: 0, sources: new Set<string>(), refs: [] };
      g.count++;
      g.sources.add(item.source);
      if (!g.refs.includes(item.ref) && g.refs.length < MAX_EVIDENCE) g.refs.push(item.ref);
      groups.set(key, g);
    }
  }
  return [...groups.values()]
    .filter((g) => g.count >= minCount && g.sources.size >= minSources)
    .map((g) => ({ text: g.text, count: g.count, sources: g.sources.size, evidence: g.refs }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
}

/** Rule list and evidence lines of a draft. */
function draftLists(rules: readonly HarvestRule[]): { list: string; evidence: string } {
  return {
    list: rules.map((r) => `- ${r.text.replace(/\s+/g, " ")}. (${r.count} times)`).join("\n"),
    evidence: rules.flatMap((r) => r.evidence.map((e) => `- ${e}`)).join("\n"),
  };
}

/** rules/<name>.md of a draft rule (rule-artifacts): the rules and their evidence, reviewed before it is used. */
export function draftRuleMarkdown(
  name: string,
  rules: readonly HarvestRule[],
  origin: string,
): string {
  const { list, evidence } = draftLists(rules);
  return [
    "---",
    `name: ${name}`,
    `description: Rules that recur in ${origin}.`,
    "---",
    "",
    `Rules collected from ${origin}; each one recurred in several places. Review them before relying on them.`,
    "",
    list,
    "",
    "## Evidence",
    "",
    evidence,
    "",
  ].join("\n");
}

/** SKILL.md of a draft: the rules and where they came from, for a human to review before it is used. */
export function draftSkillMarkdown(
  name: string,
  rules: readonly HarvestRule[],
  origin: string,
): string {
  const list = rules.map((r) => `- ${r.text.replace(/\s+/g, " ")}. (${r.count} times)`).join("\n");
  const evidence = rules.flatMap((r) => r.evidence.map((e) => `- ${e}`)).join("\n");
  return [
    "---",
    `name: ${name}`,
    `description: Rules that recur in ${origin}. Use when writing or reviewing work there.`,
    "---",
    "",
    `# ${name}`,
    "",
    `Rules collected from ${origin}; each one recurred in several places. Review them before relying on the skill.`,
    "",
    "## Rules",
    "",
    list,
    "",
    "## Evidence",
    "",
    evidence,
    "",
  ].join("\n");
}
