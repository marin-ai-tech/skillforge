// English terms that stay in English in every translated interface (a decision of the UI i18n design:
// do not translate if a translation would distort the meaning or diverge from the API, CLI and documentation).
// Used by the dictionary check (`tests/ui-i18n.test.mjs`) and e2e (`tests/e2e/zzz-i18n.spec.ts`).
// Comparison is case-insensitive, word by word.
export const TERMS = [
  // product, protocols and formats
  "SkillForge", "MCP", "CLI", "API", "SSO", "OIDC", "LDAP", "URL", "HTTP", "HTTPS", "stdio", "JSON", "YAML", "Markdown",
  "Authorization", "Bearer", "README", "SKILL", "md", "git", "GitHub", "zip", "tar", "gz", "tgz", "semver", "UTC", "KiB", "MiB", "GiB",
  // agents and clients
  "Claude", "Code", "Codex", "Cursor", "OpenCode", "Qwen", "Gemini", "Devin", "Reckon",
  // API and CLI values: statuses, roles, visibility, channels
  "candidate", "active", "aging", "zombie", "retired", "admin", "reviewer", "contributor", "viewer", "org", "team",
  "stable", "beta",
  // domain terms
  "digest", "provenance", "evidence", "Transfer", "Rate", "Token", "Efficiency", "ablation", "uplift", "holdout",
  "eval", "evals", "gate", "marketplace", "frontmatter", "runtime", "scope", "hook", "hooks", "plugin", "agentspace",
  "dreamteam", "human", "import",
];

const LOWER = new Set(TERMS.map((t) => t.toLowerCase()));

/** True when every Latin word of `text` (3+ letters) is a kept term. */
export function onlyTerms(text) {
  const words = text.match(/[A-Za-z][A-Za-z'’-]*[A-Za-z]|[A-Za-z]/g) ?? [];
  return words.every((w) => w.length < 3 || LOWER.has(w.toLowerCase()) || /^[A-Z0-9_]+$/.test(w));
}

/** Latin words of `text` (3+ letters) that are not kept terms and are not CODE_LIKE identifiers. */
export function foreignWords(text) {
  const words = text.match(/[A-Za-z][A-Za-z'’-]*[A-Za-z]/g) ?? [];
  return words.filter((w) => w.length >= 3 && !LOWER.has(w.toLowerCase()) && !/^[A-Z0-9_]+$/.test(w));
}
