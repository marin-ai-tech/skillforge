import type { McpDialect, McpValueKind } from "./types.ts";

/** Names that hold credentials; `-` is read as `_` so that `X-Api-Key` matches `API_KEY`. */
const SECRET_NAME_RE =
  /TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|AUTH|CREDENTIAL|BEARER|COOKIE|SESSION/i;
const SECRET_VALUE_RE = /^(?:sk-|ghp_|github_pat_|glpat-|xox|AKIA|Bearer\s)/;
const URL_WITH_PASSWORD_RE = /^[a-z][a-z0-9+.-]*:\/\/[^/@\s:]+:[^/@\s]+@/i;
const SECRET_QUERY_NAMES = new Set([
  "key",
  "token",
  "secret",
  "password",
  "auth",
  "sig",
  "api_key",
]);
const SECRET_FLAG_RE = /key|token|secret|password/i;
const AUTH_SCHEME_RE = /^(?:Bearer|Basic|Token)$/i;

/** Reference syntax of each dialect; Codex has none (variables are named in separate fields). */
const REFERENCE_RE: Record<McpDialect, RegExp | null> = {
  "claude-mcp-json": /\$\{[A-Za-z_][A-Za-z0-9_]*(?::-[^}]*)?\}/g,
  "claude-user-json": /\$\{[A-Za-z_][A-Za-z0-9_]*(?::-[^}]*)?\}/g,
  "cursor-json": /\$\{env:[A-Za-z_][A-Za-z0-9_]*\}/g,
  "opencode-jsonc": /\{(?:env|file):[^}]+\}/g,
  "codex-toml": null,
};

export function isSecretName(name: string): boolean {
  return SECRET_NAME_RE.test(name.replace(/-/g, "_"));
}

export function isSecretValue(value: unknown): boolean {
  return (
    typeof value === "string" && (SECRET_VALUE_RE.test(value) || URL_WITH_PASSWORD_RE.test(value))
  );
}

/** True when the written value is a variable reference in this dialect, possibly after an auth scheme word. */
function isReference(dialect: McpDialect, value: string): boolean {
  const re = REFERENCE_RE[dialect];
  if (!re || value.match(re) === null) return false;
  const rest = value.replace(re, "").trim();
  return rest === "" || AUTH_SCHEME_RE.test(rest);
}

export function valueKind(dialect: McpDialect, value: unknown): McpValueKind {
  if (value === null || value === undefined || value === "") return "empty";
  if (typeof value === "string" && isReference(dialect, value)) return "reference";
  return "literal";
}

export function secretLike(name: string, kind: McpValueKind, value: unknown): boolean {
  return isSecretName(name) || (kind === "literal" && isSecretValue(value));
}

/** Userinfo or a credential-named query parameter in a URL; an unparsable URL counts as no secret here. */
export function urlHasSecret(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.username !== "" || u.password !== "") return true;
  return [...u.searchParams.keys()].some((k) => SECRET_QUERY_NAMES.has(k.toLowerCase()));
}

/** `scheme://host[:port]` without userinfo, path, query or fragment; null when the URL does not parse. */
export function urlOrigin(url: string): string | null {
  try {
    const u = new URL(url);
    return u.host ? `${u.protocol}//${u.host}` : null;
  } catch {
    return null;
  }
}

/** `--api-key=<literal>` or `--token <literal>` among the arguments. */
export function argsHaveSecret(dialect: McpDialect, args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(args[i]!);
    if (!m || !SECRET_FLAG_RE.test(m[1]!)) continue;
    const value = m[2] ?? args[i + 1];
    if (value === undefined || (m[2] === undefined && value.startsWith("-"))) continue;
    if (valueKind(dialect, value) === "literal") return true;
  }
  return false;
}
