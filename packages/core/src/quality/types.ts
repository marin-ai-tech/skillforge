import type { HookAnalysis } from "./hook.ts";
import type { SecurityReport } from "./security.ts";
import type { ContextCost } from "./context-cost.ts";

/** 4: the report carries a security section (content-security-scan). 5: a context cost section (context-cost). */
export const QUALITY_ALGORITHM = 5;

export const QUALITY_CODES = {
  Q_DESC_SHORT: "Q_DESC_SHORT",
  Q_DESC_NO_TRIGGER: "Q_DESC_NO_TRIGGER",
  Q_DESC_NO_BOUNDARY: "Q_DESC_NO_BOUNDARY",
  Q_DESC_PERSON: "Q_DESC_PERSON",
  Q_BODY_LONG: "Q_BODY_LONG",
  Q_REF_DEEP: "Q_REF_DEEP",
  Q_TIME_SENSITIVE: "Q_TIME_SENSITIVE",
  Q_WINDOWS_PATH: "Q_WINDOWS_PATH",
  Q_TOOLS_UNBOUNDED: "Q_TOOLS_UNBOUNDED",
  Q_NO_EXAMPLE: "Q_NO_EXAMPLE",
  Q_HOOK_NO_TIMEOUT: "Q_HOOK_NO_TIMEOUT",
  Q_HOOK_HARD_BLOCK: "Q_HOOK_HARD_BLOCK",
  Q_HOOK_BROAD_MATCHER: "Q_HOOK_BROAD_MATCHER",
  Q_HOOK_INLINE_LONG: "Q_HOOK_INLINE_LONG",
  Q_SETTINGS_BYPASS: "Q_SETTINGS_BYPASS",
  Q_SETTINGS_BROAD_ALLOW: "Q_SETTINGS_BROAD_ALLOW",
  Q_SETTINGS_API_KEY_HELPER: "Q_SETTINGS_API_KEY_HELPER",
  Q_SETTINGS_HOOKS: "Q_SETTINGS_HOOKS",
} as const;

export type QualityCode = keyof typeof QUALITY_CODES;

export type QualitySeverity = "warn" | "info";

export const QUALITY_SEVERITY: Record<QualityCode, QualitySeverity> = {
  Q_DESC_SHORT: "warn",
  Q_DESC_NO_TRIGGER: "warn",
  Q_DESC_NO_BOUNDARY: "info",
  Q_DESC_PERSON: "info",
  Q_BODY_LONG: "warn",
  Q_REF_DEEP: "warn",
  Q_TIME_SENSITIVE: "info",
  Q_WINDOWS_PATH: "warn",
  Q_TOOLS_UNBOUNDED: "warn",
  Q_NO_EXAMPLE: "info",
  Q_HOOK_NO_TIMEOUT: "warn",
  Q_HOOK_HARD_BLOCK: "info",
  Q_HOOK_BROAD_MATCHER: "warn",
  Q_HOOK_INLINE_LONG: "info",
  Q_SETTINGS_BYPASS: "warn",
  Q_SETTINGS_BROAD_ALLOW: "warn",
  Q_SETTINGS_API_KEY_HELPER: "info",
  Q_SETTINGS_HOOKS: "info",
};

export type QualityHit = {
  path: string;
  line?: number;
  excerpt?: string;
};

export type QualityCheck = {
  code: QualityCode;
  severity: QualitySeverity;
  message: string;
  hits: QualityHit[];
};

export type QualityMetrics = {
  description_chars: number;
  description_words: number;
  body_chars: number;
  body_tokens_est: number;
  markdown_files: number;
  reference_depth: number;
  code_blocks: number;
};

export type QualityGrade = "A" | "B" | "C" | "D";

export type QualityComponent = {
  type: string;
  name: string;
  grade: QualityGrade;
  score: number;
};

export type QualityReport = {
  algorithm: typeof QUALITY_ALGORITHM;
  score: number;
  grade: QualityGrade;
  checks: QualityCheck[];
  metrics: QualityMetrics;
  hook?: HookAnalysis;
  /** Present for type=plugin: per-component grades (skills/commands/agents/hooks). */
  components?: QualityComponent[];
  /** Built-in content scan; separate from the grade: quality and risk are different axes. */
  security?: SecurityReport;
  /** Tokens the artifact puts into the agent's context, and when. */
  context?: ContextCost;
};

export const MAX_HITS = 20;
export const MAX_EXCERPT = 80;
export const BODY_TOKENS_LIMIT = 5000;
export const DESCRIPTION_MIN_WORDS = 10;
