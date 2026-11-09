import type { ParsedArtifact } from "../artifact/types.ts";
import { HOOK_EVENTS } from "../artifact/types.ts";
import { contentToString } from "../artifact/frontmatter.ts";
import { extractPluginRootScripts } from "../artifact/hook.ts";
import type { QualityHit } from "./types.ts";

export const HOOK_HANDLER_TYPES = ["command", "http", "prompt", "agent"] as const;
export type HookHandlerType = (typeof HOOK_HANDLER_TYPES)[number];

export type HookBlocking = "block" | "ask" | "none" | "unknown";

export const HOOK_RISK_LABELS = [
  "blocks_tools",
  "blocks_prompts",
  "writes_files",
  "network",
  "every_prompt",
  "llm_hook",
] as const;
export type HookRiskLabel = (typeof HOOK_RISK_LABELS)[number];

export type HookRow = {
  event: string;
  matcher: string | null;
  type: HookHandlerType;
  action: string;
  timeout: number | null;
  script: string | null;
  blocking: HookBlocking;
  runtimes: string[];
};

export type HookRisk = { label: HookRiskLabel; rows: number[] };

export type HookAnalysis = { rows: HookRow[]; risks: HookRisk[] };

export type HookRuntime = {
  runtime: string;
  events: readonly string[];
  types: readonly HookHandlerType[];
};

export const HOOK_RUNTIMES: readonly HookRuntime[] = [
  { runtime: "claude-code", events: HOOK_EVENTS, types: HOOK_HANDLER_TYPES },
];

export const HOOKS_JSON_PATH = "hooks/hooks.json";
export const HOOK_ACTION_MAX = 200;
export const HOOK_INLINE_MAX = 200;

const BLOCKING_EVENTS = new Set([
  "PreToolUse",
  "PermissionRequest",
  "UserPromptSubmit",
  "PostToolUse",
  "Stop",
  "SubagentStop",
]);
const TOOL_EVENTS = new Set(["PreToolUse", "PostToolUse", "PermissionRequest"]);
const HANDLER_TYPES = new Set<string>(HOOK_HANDLER_TYPES);

const ACTION_FIELD: Record<HookHandlerType, string> = {
  command: "command",
  http: "url",
  prompt: "prompt",
  agent: "agent",
};

const BLOCK_RE = /\bexit\s+2\b|"decision"\s*:\s*"block"|"permissionDecision"\s*:\s*"deny"/;
const ASK_RE = /"decision"\s*:\s*"ask"|"permissionDecision"\s*:\s*"ask"/;
const JQ_BLOCK_RE = /--arg\s+\w+\s+(?:block|deny)\b/;
const DECISION_RE = /decision/i;
const EXIT_VAR_RE = /\bexit\s+\$[\w{]/;
const DYN_DECISION_RE = /decision[\\"']*\s*:\s*\$[\w{]/;

const QUOTED_RE = /"(?:[^"\\]|\\.)*"|'[^']*'/g;
const REDIRECT_RE = /(?<![=<>-])>>?(?![>&=])(?!\s*\/dev\/null\b)/;
const WRITE_RE =
  /\b(?:tee|rm|mv|cp|touch|mkdir)\s|\bsed\s+-i\b|\bgit\s+(?:commit|push|reset|rebase|merge)\b|Set-Content|Add-Content|Out-File|Remove-Item|New-Item|writeFile/i;
const NETWORK_RE =
  /(?<![-\w])(?:curl|wget|nc)\b|Invoke-WebRequest|Invoke-RestMethod|https?:\/\/|fetch\(|requests\./i;

/** Handler rows with the `hooks.json` location of each, for `hits` excerpts. */
export type HookRowsWithPaths = {
  rows: HookRow[];
  paths: string[];
  /** Primary text per row: resolved script content, else the inline action. Used for `blocking`. */
  texts: string[];
  /** Action + transitively referenced bundle scripts. Used for risk labels. */
  riskTexts: string[];
};

export function cleanHookText(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n")
    .replace(QUOTED_RE, (q) => `${q[0]}_${q[0]}`);
}

export function truncateAction(action: string): string {
  if (action.length <= HOOK_ACTION_MAX) return action;
  return `${action.slice(0, HOOK_ACTION_MAX - 1)}…`;
}

function blockingOf(event: string, type: HookHandlerType, text: string): HookBlocking {
  if (!BLOCKING_EVENTS.has(event)) return "none";
  if (type !== "command") return "unknown";
  if (BLOCK_RE.test(text)) return "block";
  if (JQ_BLOCK_RE.test(text) && DECISION_RE.test(text)) return "block";
  if (ASK_RE.test(text)) return "ask";
  if (EXIT_VAR_RE.test(text) || DYN_DECISION_RE.test(text)) return "unknown";
  return "none";
}

function isBroad(matcher: string | null): boolean {
  return matcher === null || matcher.trim() === "*";
}

function hooksJson(artifact: ParsedArtifact): Record<string, unknown> | null {
  const file = artifact.canonical.find((c) => c.path === HOOKS_JSON_PATH);
  if (!file) return null;
  try {
    const parsed: unknown = JSON.parse(contentToString(file.content));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const hooks = (parsed as Record<string, unknown>).hooks;
    if (typeof hooks !== "object" || hooks === null || Array.isArray(hooks)) return null;
    return hooks as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function collectRiskText(action: string, files: Map<string, Uint8Array>): string {
  const parts = [action];
  const seen = new Set<string>();
  let frontier = extractPluginRootScripts(action).filter((rel) => files.has(rel));
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const rel of frontier) {
      if (seen.has(rel)) continue;
      seen.add(rel);
      const text = contentToString(files.get(rel)!);
      parts.push(text);
      next.push(...extractPluginRootScripts(text));
    }
    frontier = next;
  }
  return parts.join("\n");
}

export function hookRows(artifact: ParsedArtifact): HookRowsWithPaths {
  const out: HookRowsWithPaths = { rows: [], paths: [], texts: [], riskTexts: [] };
  const hooks = hooksJson(artifact);
  if (!hooks) return out;
  const files = new Map(artifact.canonical.map((c) => [c.path, c.content]));

  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    groups.forEach((group, gi) => {
      if (!isRecord(group) || !Array.isArray(group.hooks)) return;
      const matcher =
        typeof group.matcher === "string" && group.matcher !== "" ? group.matcher : null;
      group.hooks.forEach((entry, ei) => {
        if (!isRecord(entry) || typeof entry.type !== "string" || !HANDLER_TYPES.has(entry.type)) {
          return;
        }
        const type = entry.type as HookHandlerType;
        const raw = entry[ACTION_FIELD[type]];
        const action = typeof raw === "string" ? raw : "";
        const timeout =
          typeof entry.timeout === "number" && Number.isFinite(entry.timeout)
            ? entry.timeout
            : null;
        let script: string | null = null;
        if (type === "command") {
          script = extractPluginRootScripts(action).find((rel) => files.has(rel)) ?? null;
        }
        const text =
          type === "command"
            ? script !== null
              ? contentToString(files.get(script)!)
              : action
            : "";
        out.rows.push({
          event,
          matcher,
          type,
          action: truncateAction(action),
          timeout,
          script,
          blocking: blockingOf(event, type, text),
          runtimes: HOOK_RUNTIMES.filter(
            (r) => r.events.includes(event) && r.types.includes(type),
          ).map((r) => r.runtime),
        });
        out.paths.push(`hooks.${event}[${gi}].hooks[${ei}]`);
        out.texts.push(text);
        out.riskTexts.push(type === "command" ? collectRiskText(action, files) : "");
      });
    });
  }
  return out;
}

export function hookRisks(rows: HookRow[], riskTexts: string[]): HookRisk[] {
  const cleaned = riskTexts.map((t) => (t ? cleanHookText(t) : ""));
  const rule: Record<HookRiskLabel, (row: HookRow, i: number) => boolean> = {
    blocks_tools: (r) =>
      r.blocking === "block" && (r.event === "PreToolUse" || r.event === "PermissionRequest"),
    blocks_prompts: (r) => r.blocking === "block" && r.event === "UserPromptSubmit",
    writes_files: (r, i) =>
      r.type === "command" && (REDIRECT_RE.test(cleaned[i]!) || WRITE_RE.test(cleaned[i]!)),
    network: (r, i) => r.type === "http" || (r.type === "command" && NETWORK_RE.test(cleaned[i]!)),
    every_prompt: (r) =>
      r.event === "UserPromptSubmit" ||
      r.event === "SessionStart" ||
      ((r.event === "PreToolUse" || r.event === "PostToolUse") && isBroad(r.matcher)),
    llm_hook: (r) => r.type === "prompt" || r.type === "agent",
  };
  const risks: HookRisk[] = [];
  for (const label of HOOK_RISK_LABELS) {
    const idx = rows.map((r, i) => (rule[label](r, i) ? i : -1)).filter((i) => i >= 0);
    if (idx.length > 0) risks.push({ label, rows: idx });
  }
  return risks;
}

export type HookContext = HookRowsWithPaths & { analysis: HookAnalysis };

export function analyzeHook(artifact: ParsedArtifact): HookContext {
  const rp = hookRows(artifact);
  return { ...rp, analysis: { rows: rp.rows, risks: hookRisks(rp.rows, rp.riskTexts) } };
}

const hitsWhere = (
  ctx: HookContext,
  pred: (row: HookRow, i: number) => boolean,
): QualityHit[] | null => {
  const hits: QualityHit[] = [];
  ctx.rows.forEach((row, i) => {
    if (pred(row, i)) hits.push({ path: HOOKS_JSON_PATH, excerpt: ctx.paths[i]! });
  });
  return hits.length > 0 ? hits : null;
};

export const checkHookNoTimeout = (ctx: HookContext): QualityHit[] | null =>
  hitsWhere(ctx, (r) => (r.type === "command" || r.type === "http") && r.timeout === null);

export const checkHookHardBlock = (ctx: HookContext): QualityHit[] | null =>
  hitsWhere(ctx, (r) => r.blocking === "block");

export const checkHookBroadMatcher = (ctx: HookContext): QualityHit[] | null =>
  hitsWhere(ctx, (r) => TOOL_EVENTS.has(r.event) && isBroad(r.matcher));

export const checkHookInlineLong = (ctx: HookContext): QualityHit[] | null =>
  hitsWhere(
    ctx,
    (r, i) => r.type === "command" && r.script === null && ctx.texts[i]!.length > HOOK_INLINE_MAX,
  );
