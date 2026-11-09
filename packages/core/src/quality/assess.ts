import { scanSecurity } from "./security.ts";
import { NO_CONTEXT, contextCostOf, sumContextCosts, type ContextCost } from "./context-cost.ts";
import type { ArtifactType, ParsedArtifact } from "../artifact/types.ts";
import { artifactTypeDef } from "../artifact/index.ts";
import { contentToString } from "../artifact/frontmatter.ts";
import { collectRefs } from "../artifact/skill.ts";
import {
  BODY_TOKENS_LIMIT,
  DESCRIPTION_MIN_WORDS,
  MAX_HITS,
  QUALITY_ALGORITHM,
  QUALITY_CODES,
  QUALITY_SEVERITY,
} from "./types.ts";
import type {
  QualityComponent,
  QualityCheck,
  QualityCode,
  QualityGrade,
  QualityHit,
  QualityMetrics,
  QualityReport,
} from "./types.ts";
import {
  bodyOf,
  dirname,
  excerptOf,
  hasExampleHeading,
  parseMarkdown,
  resolveRef,
  type MarkdownFile,
} from "./markdown.ts";
import { parseSkill } from "../artifact/skill.ts";
import { parseCommand } from "../artifact/command.ts";
import { parseAgent } from "../artifact/agent.ts";
import { parseHook } from "../artifact/hook.ts";
import { sha256Hex, bundleDigest, compareUtf8Paths } from "../digest.ts";
import {
  analyzeHook,
  checkHookBroadMatcher,
  checkHookHardBlock,
  checkHookInlineLong,
  checkHookNoTimeout,
  HOOK_INLINE_MAX,
  type HookContext,
} from "./hook.ts";

const HOOK_CODES = new Set<QualityCode>([
  "Q_HOOK_NO_TIMEOUT",
  "Q_HOOK_HARD_BLOCK",
  "Q_HOOK_BROAD_MATCHER",
  "Q_HOOK_INLINE_LONG",
]);
const SETTINGS_CODES = new Set<QualityCode>([
  "Q_SETTINGS_BYPASS",
  "Q_SETTINGS_BROAD_ALLOW",
  "Q_SETTINGS_API_KEY_HELPER",
  "Q_SETTINGS_HOOKS",
]);
const GENERAL_CODES = (Object.keys(QUALITY_CODES) as QualityCode[]).filter(
  (c) => !HOOK_CODES.has(c) && !SETTINGS_CODES.has(c),
);

const APPLICABLE: Record<ArtifactType, ReadonlySet<QualityCode>> = {
  skill: new Set(GENERAL_CODES),
  command: new Set(GENERAL_CODES.filter((c) => c !== "Q_REF_DEEP")),
  agent: new Set(GENERAL_CODES.filter((c) => c !== "Q_REF_DEEP" && c !== "Q_NO_EXAMPLE")),
  hook: new Set<QualityCode>(["Q_TIME_SENSITIVE", "Q_WINDOWS_PATH", ...HOOK_CODES]),
  plugin: new Set<QualityCode>(),
  settings: new Set(SETTINGS_CODES),
  // An MCP server descriptor is not read by the model as instructions: only description and docs hygiene apply.
  "mcp-server": new Set<QualityCode>([
    "Q_DESC_SHORT",
    "Q_DESC_PERSON",
    "Q_TIME_SENSITIVE",
    "Q_WINDOWS_PATH",
  ]),
};

const TRIGGER_PHRASES = [
  "use when",
  "use whenever",
  "use for",
  "use if",
  "use it when",
  "use this when",
  "use this skill when",
  "use after",
  "use before",
  "when the user",
  "when a user",
  "when asked",
  "when you need",
  "when working",
  "invoke when",
  "triggers on",
  "trigger when",
];

const BOUNDARY_PHRASES = [
  "do not use",
  "don't use",
  "not for",
  "not intended for",
  "not meant for",
  "instead use",
  "use instead",
  "skip when",
  "skip for",
  "unless",
];

const PERSON_PHRASES = [
  "i can",
  "i will",
  "i'll",
  "i help",
  "we can",
  "we will",
  "you can use this",
];

const MONTH =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const YEAR = "20\\d{2}";

const TIME_SENSITIVE_RE = new RegExp(
  [
    `\\bas of (?:${MONTH}|${YEAR})\\b`,
    `\\b(?:before|after|until|since) (?:${MONTH} )?${YEAR}\\b`,
    `\\b(?:latest|newest|most recent) (?:version|release|model)\\b`,
    `\\b(?:this|next|last) year\\b`,
    `\\b(?:currently|recently) (?:released|available|supported|deprecated)\\b`,
  ].join("|"),
  "i",
);

const WINDOWS_PATH_RE =
  /\b[a-z]:\\[^\s"'<>|]*|\\\\[\w.-]+(?:\\[\w.-]+)+|%[A-Z0-9_]+%\\[^\s"'<>|]*|\b[\w.-]+(?:\\[\w.-]+)*\\[\w-]+\.[a-z0-9]+\b/i;

const PATH_LANGS = new Set(["powershell", "pwsh", "ps1", "cmd", "bat", "batch"]);

const DANGEROUS_BASH = new Set([
  "rm",
  "dd",
  "mkfs",
  "sudo",
  "chmod",
  "chown",
  "chgrp",
  "curl",
  "wget",
  "nc",
  "sh",
  "bash",
  "zsh",
  "eval",
]);

function isUnboundedTool(entry: string): boolean {
  if (entry === "*") return true;
  const m = /^bash(?:\((.*)\))?$/i.exec(entry);
  if (!m) return false;
  if (m[1] === undefined) return true; // plain "Bash" — no command filter at all
  const raw = m[1].trim();
  const inner = raw.replace(/\s+/g, "");
  if (inner === "" || inner === "*" || inner === ":*" || inner === "*:*") return true;
  if (!inner.includes("*")) return false;
  // A wildcarded command filter: the head word before the first separator decides risk,
  // so `rm -rf:*`, `rm *`, `sudo apt-get:*` are flagged while `ls:*` is not.
  const head = raw.split(/[\s:(*]/)[0]?.toLowerCase() ?? "";
  return DANGEROUS_BASH.has(head);
}

type Context = {
  artifact: ParsedArtifact;
  main: MarkdownFile | null;
  mdFiles: MarkdownFile[];
  body: string;
  description: string;
  hook: HookContext | null;
};

function mainPathFor(artifact: ParsedArtifact): string | null {
  // Hook quality looks at README.md (intentional special case; table mainFile is hooks.json).
  if (artifact.type === "hook") return "README.md";
  return artifactTypeDef(artifact.type).mainFile(artifact.name);
}

function pickMain(artifact: ParsedArtifact, mdFiles: MarkdownFile[]): MarkdownFile | null {
  const wanted = mainPathFor(artifact);
  return (
    mdFiles.find((f) => f.path === wanted) ??
    mdFiles.find((f) => f.path.endsWith(`/${wanted}`)) ??
    mdFiles[0] ??
    null
  );
}

function descriptionHit(ctx: Context): QualityHit[] {
  const excerpt = excerptOf(ctx.description);
  if (!ctx.main) return [];
  const fmLine = ctx.main.lines
    .slice(0, ctx.main.bodyStart)
    .find((l) => /^description\s*:/i.test(l.text));
  return [
    fmLine ? { path: ctx.main.path, line: fmLine.line, excerpt } : { path: ctx.main.path, excerpt },
  ];
}

function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

const WORD_EDGE = "\\p{L}\\p{N}_'";

function phraseRe(phrases: string[]): RegExp {
  const alts = phrases.map((p) =>
    p
      .split(/\s+/)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+"),
  );
  return new RegExp(`(?<![${WORD_EDGE}])(?:${alts.join("|")})(?![${WORD_EDGE}])`, "iu");
}

const TRIGGER_RE = phraseRe(TRIGGER_PHRASES);
const BOUNDARY_RE = phraseRe(BOUNDARY_PHRASES);
const PERSON_RE = phraseRe(PERSON_PHRASES);

function checkDescShort(ctx: Context): QualityHit[] | null {
  const n = wordsOf(ctx.description).length;
  return n < DESCRIPTION_MIN_WORDS ? descriptionHit(ctx) : null;
}

function checkDescNoTrigger(ctx: Context): QualityHit[] | null {
  return TRIGGER_RE.test(ctx.description) ? null : descriptionHit(ctx);
}

function checkDescNoBoundary(ctx: Context): QualityHit[] | null {
  return BOUNDARY_RE.test(ctx.description) ? null : descriptionHit(ctx);
}

function checkDescPerson(ctx: Context): QualityHit[] | null {
  const lower = ctx.description.toLowerCase();
  const starts = lower.startsWith("i ") || lower.startsWith("we ");
  return starts || PERSON_RE.test(ctx.description) ? descriptionHit(ctx) : null;
}

function checkBodyLong(ctx: Context): QualityHit[] | null {
  if (tokensEst(ctx.body) <= BODY_TOKENS_LIMIT || !ctx.main) return null;
  return [{ path: ctx.main.path }];
}

const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯]/gu;
const CYRILLIC_RE = /[\u0400-\u04FF]/gu;

function tokensEst(body: string): number {
  const cjk = body.match(CJK_RE)?.length ?? 0;
  const cyr = body.match(CYRILLIC_RE)?.length ?? 0;
  return cjk + Math.ceil(cyr / 2) + Math.ceil((body.length - cjk - cyr) / 4);
}

type RefGraph = { depth: number; deepFiles: string[] };

function referenceGraph(ctx: Context): RefGraph {
  if (!ctx.main) return { depth: 0, deepFiles: [] };
  const byPath = new Map(ctx.mdFiles.map((f) => [f.path, f]));
  const allPaths = new Set(ctx.artifact.canonical.map((c) => c.path));
  const rootDir = dirname(ctx.main.path);

  const firstLevel = collectRefs(ctx.body)
    .map((r) => resolveRef(rootDir, r))
    .filter((p): p is string => p !== null && p !== ctx.main!.path && allPaths.has(p));
  if (firstLevel.length === 0) return { depth: 0, deepFiles: [] };

  const mdTargets = (path: string): string[] => {
    const file = byPath.get(path);
    if (!file) return [];
    return collectRefs(file.text)
      .map((r) => resolveRef(dirname(path), r))
      .filter(
        (p): p is string =>
          p !== null && p !== path && byPath.has(p) && p.toLowerCase().endsWith(".md"),
      );
  };

  const deepFiles = [...new Set(firstLevel)].filter((p) => mdTargets(p).length > 0);

  const visited = new Set<string>([ctx.main.path]);
  let frontier = [...new Set(firstLevel)];
  let depth = 1;
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const path of frontier) {
      if (visited.has(path)) continue;
      visited.add(path);
      next.push(...mdTargets(path).filter((t) => !visited.has(t)));
    }
    if (next.length === 0) break;
    depth++;
    frontier = [...new Set(next)];
  }
  return { depth, deepFiles };
}

function scanLines(
  ctx: Context,
  matcher: (text: string, lang: string | null) => boolean,
): QualityHit[] {
  const hits: QualityHit[] = [];
  for (const file of ctx.mdFiles) {
    for (const l of file.lines) {
      if (matcher(l.text, l.codeLang)) {
        hits.push({ path: file.path, line: l.line, excerpt: excerptOf(l.text) });
      }
    }
  }
  return hits;
}

function checkTimeSensitive(ctx: Context): QualityHit[] | null {
  const hits = scanLines(ctx, (text, lang) => lang === null && TIME_SENSITIVE_RE.test(text));
  return hits.length > 0 ? hits : null;
}

function checkWindowsPath(ctx: Context): QualityHit[] | null {
  const hits = scanLines(
    ctx,
    (text, lang) => (lang === null || !PATH_LANGS.has(lang)) && WINDOWS_PATH_RE.test(text),
  );
  return hits.length > 0 ? hits : null;
}

function toolEntries(raw: unknown): string[] {
  if (typeof raw === "string") return raw.split(",");
  if (Array.isArray(raw)) return raw.flatMap((x) => String(x).split(","));
  return [];
}

function checkToolsUnbounded(ctx: Context): QualityHit[] | null {
  const key = ctx.artifact.type === "agent" ? "tools" : "allowed-tools";
  const entries = toolEntries(ctx.artifact.frontmatter?.[key]).map((e) => e.trim());
  const bad = entries.filter(isUnboundedTool);
  if (bad.length === 0) return null;
  if (!ctx.main) return [];
  const fmLine = ctx.main.lines
    .slice(0, ctx.main.bodyStart)
    .find((l) => new RegExp(`^${key}\\s*:`, "i").test(l.text));
  const excerpt = excerptOf(`${key}: ${bad.join(", ")}`);
  return [
    fmLine ? { path: ctx.main.path, line: fmLine.line, excerpt } : { path: ctx.main.path, excerpt },
  ];
}

function checkNoExample(ctx: Context): QualityHit[] | null {
  const hasBlock = ctx.mdFiles.some((f) => f.codeBlocks > 0);
  const hasHeading = ctx.mdFiles.some(hasExampleHeading);
  if (hasBlock || hasHeading) return null;
  return ctx.main ? [{ path: ctx.main.path }] : [];
}

const MESSAGES: Record<QualityCode, string> = {
  Q_DESC_SHORT: `Description has fewer than ${DESCRIPTION_MIN_WORDS} words`,
  Q_DESC_NO_TRIGGER: 'Description does not say when to use the artifact (e.g. "Use when ...")',
  Q_DESC_NO_BOUNDARY:
    'Description does not say when not to use the artifact (e.g. "Do not use for ...")',
  Q_DESC_PERSON: "Description is written in the first person instead of describing the artifact",
  Q_BODY_LONG: `Body is longer than ~${BODY_TOKENS_LIMIT} tokens`,
  Q_REF_DEEP: "Referenced files link to further files (references deeper than one level)",
  Q_TIME_SENSITIVE: "Text contains time-sensitive wording that will go stale",
  Q_WINDOWS_PATH: "Text contains a Windows path outside a PowerShell/cmd code block",
  Q_TOOLS_UNBOUNDED: "Tool list allows unrestricted tools (*, Bash without a filter)",
  Q_NO_EXAMPLE: "No code block or Example section found",
  Q_HOOK_NO_TIMEOUT: "Hook handler (command/http) has no timeout; a hung hook blocks the agent",
  Q_HOOK_HARD_BLOCK: 'Hook blocks outright (exit 2 / "block" / "deny"); prefer "ask"',
  Q_HOOK_BROAD_MATCHER: "Tool hook has no matcher (or `*`) and runs on every tool call",
  Q_HOOK_INLINE_LONG: `Inline command longer than ${HOOK_INLINE_MAX} characters; move it to a bundle script`,
  Q_SETTINGS_BYPASS: "permissions.defaultMode is bypassPermissions",
  Q_SETTINGS_BROAD_ALLOW: "permissions.allow includes a broad pattern (*, Bash, Bash(*), Bash(:*))",
  Q_SETTINGS_API_KEY_HELPER: "Profile sets apiKeyHelper (command that prints an API key)",
  Q_SETTINGS_HOOKS: "Profile embeds hooks; prefer a dedicated hook artifact for risk analysis",
};

function gradeOf(score: number): QualityGrade {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  return "D";
}

function buildSubArtifact(
  type: "skill" | "command" | "agent" | "hook",
  name: string,
  description: string,
  frontmatter: Record<string, unknown> | null,
  tags: string[],
  canonical: Array<{ path: string; content: Uint8Array }>,
): ParsedArtifact {
  const files = canonical.map((c) => ({
    path: c.path,
    sha256: sha256Hex(c.content),
    size: c.content.byteLength,
  }));
  return {
    type,
    name,
    description,
    displayName: null,
    tags,
    frontmatter,
    files,
    canonical: [...canonical].sort((a, b) => compareUtf8Paths(a.path, b.path)),
    digest: bundleDigest(files.map(({ path, sha256 }) => ({ path, sha256 }))),
  };
}

type ComponentPair = {
  component: { type: string; name: string; path: string };
  artifact: ParsedArtifact;
};

function skillComponentArtifact(
  plugin: ParsedArtifact,
  c: { type: string; name: string; path: string },
): ComponentPair | null {
  const prefix = `skills/${c.name}/`;
  const skillFiles = plugin.canonical
    .filter((f) => f.path.startsWith(prefix))
    .map((f) => ({
      path: f.path.slice(prefix.length),
      content: f.content,
      size: f.content.byteLength,
    }));
  const typed = parseSkill(skillFiles, c.name, { type: "skill", files: skillFiles });
  if (typed.errors.length > 0) return null;
  return {
    component: c,
    artifact: buildSubArtifact(
      "skill",
      typed.name,
      typed.description,
      typed.frontmatter,
      typed.tags,
      typed.canonical,
    ),
  };
}

function mdComponentArtifact(
  plugin: ParsedArtifact,
  c: { type: string; name: string; path: string },
  kind: "command" | "agent",
  parse: (
    files: Array<{ path: string; content: Uint8Array; size: number }>,
    input: {
      type: "command" | "agent";
      files: Array<{ path: string; content: Uint8Array; size: number }>;
    },
  ) => {
    name: string;
    description: string;
    frontmatter: Record<string, unknown> | null;
    tags: string[];
    canonical: Array<{ path: string; content: Uint8Array }>;
    errors: unknown[];
  },
): ComponentPair | null {
  const file = plugin.canonical.find((f) => f.path === c.path);
  if (!file) return null;
  const base = c.path.includes("/") ? c.path.slice(c.path.lastIndexOf("/") + 1) : c.path;
  const files = [{ path: base, content: file.content, size: file.content.byteLength }];
  const typed = parse(files, { type: kind, files });
  if (typed.errors.length > 0) return null;
  return {
    component: c,
    artifact: buildSubArtifact(
      kind,
      typed.name,
      typed.description,
      typed.frontmatter,
      typed.tags,
      typed.canonical,
    ),
  };
}

function isHookRelatedPath(p: string): boolean {
  return (
    p === "hooks/hooks.json" ||
    p.startsWith("hooks/") ||
    p === "scripts" ||
    p.startsWith("scripts/") ||
    p === "README.md" ||
    p.toLowerCase() === "readme.md"
  );
}

function hookComponentArtifact(
  plugin: ParsedArtifact,
  c: { type: string; name: string; path: string },
): ComponentPair | null {
  const hookFiles = plugin.canonical
    .filter((f) => isHookRelatedPath(f.path))
    .map((f) => ({
      path: f.path === "hooks/hooks.json" ? "hooks.json" : f.path,
      content: f.content,
      size: f.content.byteLength,
    }));
  const typed = parseHook(hookFiles, null, {
    type: "hook",
    files: hookFiles,
    name: plugin.name,
    description: plugin.description,
  });
  if (typed.errors.length > 0) return null;
  return {
    component: c,
    artifact: buildSubArtifact(
      "hook",
      typed.name,
      typed.description,
      typed.frontmatter,
      typed.tags,
      typed.canonical,
    ),
  };
}

function componentArtifacts(plugin: ParsedArtifact): ComponentPair[] {
  const out: ComponentPair[] = [];
  const comps = plugin.components ?? [];
  for (const c of comps) {
    if (c.type === "mcp_server") continue;
    let pair: ComponentPair | null = null;
    if (c.type === "skill") {
      pair = skillComponentArtifact(plugin, c);
    } else if (c.type === "command") {
      pair = mdComponentArtifact(plugin, c, "command", parseCommand);
    } else if (c.type === "agent") {
      pair = mdComponentArtifact(plugin, c, "agent", parseAgent);
    } else if (c.type === "hook") {
      pair = hookComponentArtifact(plugin, c);
    }
    if (pair) out.push(pair);
  }
  return out;
}

function mergePluginChecks(reports: QualityReport[]): {
  checks: QualityCheck[];
  hook?: QualityReport["hook"];
} {
  const byCode = new Map<QualityCode, QualityCheck>();
  let hook: QualityReport["hook"];
  for (const report of reports) {
    if (report.hook) hook = report.hook;
    for (const check of report.checks) {
      const existing = byCode.get(check.code);
      if (!existing) {
        byCode.set(check.code, {
          code: check.code,
          severity: check.severity,
          message: check.message,
          hits: [...check.hits],
        });
      } else {
        const seen = new Set(
          existing.hits.map((h) => `${h.path}:${h.line ?? ""}:${h.excerpt ?? ""}`),
        );
        for (const hit of check.hits) {
          const key = `${hit.path}:${hit.line ?? ""}:${hit.excerpt ?? ""}`;
          if (!seen.has(key)) {
            existing.hits.push(hit);
            seen.add(key);
          }
        }
        existing.hits = existing.hits.slice(0, MAX_HITS);
      }
    }
  }
  return { checks: [...byCode.values()], ...(hook ? { hook } : {}) };
}

function assessPluginQuality(artifact: ParsedArtifact): QualityReport {
  const subs = componentArtifacts(artifact);
  const reports = subs.map((s) => assessQuality(s.artifact));
  const qualityComponents: QualityComponent[] = subs.map((s, i) => ({
    type: s.component.type,
    name: s.component.name,
    grade: reports[i]!.grade,
    score: reports[i]!.score,
  }));
  const merged = mergePluginChecks(reports);
  const warn = merged.checks.filter((c) => c.severity === "warn").length;
  const info = merged.checks.filter((c) => c.severity === "info").length;
  const score = Math.max(0, 100 - 15 * warn - 5 * info);
  const mdFiles = artifact.canonical.filter((c) => c.path.toLowerCase().endsWith(".md")).length;
  const report: QualityReport = {
    algorithm: QUALITY_ALGORITHM,
    score,
    grade: gradeOf(score),
    checks: merged.checks,
    metrics: {
      description_chars: artifact.description.length,
      description_words: artifact.description.split(/\s+/).filter((w) => w.length > 0).length,
      body_chars: 0,
      body_tokens_est: 0,
      markdown_files: mdFiles,
      reference_depth: 0,
      code_blocks: 0,
    },
    components: qualityComponents,
  };
  if (merged.hook) report.hook = merged.hook;
  return report;
}

const BROAD_ALLOW = new Set(["*", "Bash", "Bash(*)", "Bash(:*)"]);

function settingsJsonPath(artifact: ParsedArtifact): string {
  return `settings/${artifact.name}/settings.json`;
}

function loadSettingsObject(artifact: ParsedArtifact): Record<string, unknown> | null {
  const path = settingsJsonPath(artifact);
  const file = artifact.canonical.find((f) => f.path === path);
  if (!file) return null;
  try {
    const parsed = JSON.parse(contentToString(file.content)) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function assessSettingsQuality(artifact: ParsedArtifact): QualityReport {
  const path = settingsJsonPath(artifact);
  const obj = loadSettingsObject(artifact);
  const checks: QualityCheck[] = [];
  const hit = (excerpt?: string): QualityHit[] => [{ path, ...(excerpt ? { excerpt } : {}) }];

  if (obj) {
    const perms = obj.permissions;
    if (typeof perms === "object" && perms !== null && !Array.isArray(perms)) {
      const p = perms as Record<string, unknown>;
      if (p.defaultMode === "bypassPermissions") {
        checks.push({
          code: "Q_SETTINGS_BYPASS",
          severity: QUALITY_SEVERITY.Q_SETTINGS_BYPASS,
          message: MESSAGES.Q_SETTINGS_BYPASS,
          hits: hit("defaultMode: bypassPermissions"),
        });
      }
      const allow = p.allow;
      if (Array.isArray(allow)) {
        const broad = allow.filter((x) => typeof x === "string" && BROAD_ALLOW.has(x));
        if (broad.length > 0) {
          checks.push({
            code: "Q_SETTINGS_BROAD_ALLOW",
            severity: QUALITY_SEVERITY.Q_SETTINGS_BROAD_ALLOW,
            message: MESSAGES.Q_SETTINGS_BROAD_ALLOW,
            hits: hit(String(broad[0])),
          });
        }
      }
    }
    if (obj.apiKeyHelper !== undefined && obj.apiKeyHelper !== null && obj.apiKeyHelper !== "") {
      checks.push({
        code: "Q_SETTINGS_API_KEY_HELPER",
        severity: QUALITY_SEVERITY.Q_SETTINGS_API_KEY_HELPER,
        message: MESSAGES.Q_SETTINGS_API_KEY_HELPER,
        hits: hit(String(obj.apiKeyHelper)),
      });
    }
    if (obj.hooks !== undefined && obj.hooks !== null) {
      checks.push({
        code: "Q_SETTINGS_HOOKS",
        severity: QUALITY_SEVERITY.Q_SETTINGS_HOOKS,
        message: MESSAGES.Q_SETTINGS_HOOKS,
        hits: hit("hooks"),
      });
    }
  }

  const warn = checks.filter((c) => c.severity === "warn").length;
  const info = checks.filter((c) => c.severity === "info").length;
  const score = Math.max(0, 100 - 15 * warn - 5 * info);
  const desc = typeof artifact.description === "string" ? artifact.description : "";
  return {
    algorithm: QUALITY_ALGORITHM,
    score,
    grade: gradeOf(score),
    checks,
    metrics: {
      description_chars: desc.length,
      description_words: wordsOf(desc).length,
      body_chars: 0,
      body_tokens_est: 0,
      markdown_files: artifact.canonical.filter((c) => c.path.toLowerCase().endsWith(".md")).length,
      reference_depth: 0,
      code_blocks: 0,
    },
  };
}

export function assessQuality(artifact: ParsedArtifact): QualityReport {
  return {
    ...assessForm(artifact),
    security: scanSecurity(artifact),
    context: contextCost(artifact),
  };
}

/** Types whose name and description the agent lists on every turn. */
const LISTED_TYPES = new Set<ArtifactType>(["skill", "command", "agent"]);

function isText(content: ParsedArtifact["canonical"][number]["content"]): boolean {
  return !contentToString(content).includes("\u0000");
}

function contextCost(artifact: ParsedArtifact): ContextCost {
  if (artifact.type === "plugin") {
    return sumContextCosts(componentArtifacts(artifact).map((s) => contextCost(s.artifact)));
  }
  if (!LISTED_TYPES.has(artifact.type)) return NO_CONTEXT;
  const mdFiles = artifact.canonical
    .filter((c) => c.path.toLowerCase().endsWith(".md"))
    .map((c) => parseMarkdown(c.path, contentToString(c.content)));
  const main = pickMain(artifact, mdFiles);
  const description = typeof artifact.description === "string" ? artifact.description : "";
  const onDemand = artifact.canonical
    .filter((c) => c.path !== main?.path && isText(c.content))
    .reduce((n, c) => n + tokensEst(contentToString(c.content)), 0);
  return contextCostOf(
    tokensEst(`${artifact.name}: ${description}`),
    main ? tokensEst(bodyOf(main)) : 0,
    onDemand,
  );
}

function assessForm(artifact: ParsedArtifact): QualityReport {
  if (artifact.type === "plugin") {
    return assessPluginQuality(artifact);
  }
  if (artifact.type === "settings") {
    return assessSettingsQuality(artifact);
  }
  const mdFiles = artifact.canonical
    .filter((c) => c.path.toLowerCase().endsWith(".md"))
    .map((c) => parseMarkdown(c.path, contentToString(c.content)));
  const main = pickMain(artifact, mdFiles);
  const ctx: Context = {
    artifact,
    main,
    mdFiles,
    body: main ? bodyOf(main) : "",
    description: typeof artifact.description === "string" ? artifact.description : "",
    hook: artifact.type === "hook" ? analyzeHook(artifact) : null,
  };
  const hookRule =
    (check: (h: HookContext) => QualityHit[] | null) =>
    (c: Context): QualityHit[] | null =>
      c.hook ? check(c.hook) : null;
  const refs = referenceGraph(ctx);

  const rules: Array<[QualityCode, (c: Context) => QualityHit[] | null]> = [
    ["Q_DESC_SHORT", checkDescShort],
    ["Q_DESC_NO_TRIGGER", checkDescNoTrigger],
    ["Q_DESC_NO_BOUNDARY", checkDescNoBoundary],
    ["Q_DESC_PERSON", checkDescPerson],
    ["Q_BODY_LONG", checkBodyLong],
    [
      "Q_REF_DEEP",
      () => (refs.deepFiles.length > 0 ? refs.deepFiles.map((path) => ({ path })) : null),
    ],
    ["Q_TIME_SENSITIVE", checkTimeSensitive],
    ["Q_WINDOWS_PATH", checkWindowsPath],
    ["Q_TOOLS_UNBOUNDED", checkToolsUnbounded],
    ["Q_NO_EXAMPLE", checkNoExample],
    ["Q_HOOK_NO_TIMEOUT", hookRule(checkHookNoTimeout)],
    ["Q_HOOK_HARD_BLOCK", hookRule(checkHookHardBlock)],
    ["Q_HOOK_BROAD_MATCHER", hookRule(checkHookBroadMatcher)],
    ["Q_HOOK_INLINE_LONG", hookRule(checkHookInlineLong)],
  ];

  const applicable = APPLICABLE[artifact.type] ?? APPLICABLE.skill;
  const checks: QualityCheck[] = [];
  for (const [code, rule] of rules) {
    if (!applicable.has(code)) continue;
    const hits = rule(ctx);
    if (hits === null) continue;
    checks.push({
      code,
      severity: QUALITY_SEVERITY[code],
      message: MESSAGES[code],
      hits: hits.slice(0, MAX_HITS),
    });
  }

  const warn = checks.filter((c) => c.severity === "warn").length;
  const info = checks.filter((c) => c.severity === "info").length;
  const score = Math.max(0, 100 - 15 * warn - 5 * info);

  const metrics: QualityMetrics = {
    description_chars: ctx.description.length,
    description_words: wordsOf(ctx.description).length,
    body_chars: ctx.body.length,
    body_tokens_est: tokensEst(ctx.body),
    markdown_files: mdFiles.length,
    reference_depth: refs.depth,
    code_blocks: mdFiles.reduce((n, f) => n + f.codeBlocks, 0),
  };

  const report: QualityReport = {
    algorithm: QUALITY_ALGORITHM,
    score,
    grade: gradeOf(score),
    checks,
    metrics,
  };
  if (ctx.hook) report.hook = ctx.hook.analysis;
  return report;
}
