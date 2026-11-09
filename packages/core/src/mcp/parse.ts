import { parse as parseToml } from "smol-toml";
import { isObj, readClaude, readCodex, readCursor, readOpencode, type Read } from "./dialects.ts";
import { parseJsonc } from "./jsonc.ts";
import { analyzeLaunch } from "./launch.ts";
import { argsHaveSecret, secretLike, urlHasSecret, urlOrigin, valueKind } from "./secrets.ts";
import type {
  McpDialect,
  McpIssue,
  McpNamedValue,
  McpParseResult,
  McpScope,
  McpServerObservation,
  RawServer,
} from "./types.ts";

type Entry = { name: string; scope: McpScope; entry: Record<string, unknown> };
type Reader = (name: string, scope: McpScope, e: Record<string, unknown>) => Read;

const READERS: Record<McpDialect, Reader> = {
  "claude-mcp-json": readClaude,
  "claude-user-json": readClaude,
  "codex-toml": readCodex,
  "cursor-json": readCursor,
  "opencode-jsonc": readOpencode,
};

function parseRoot(dialect: McpDialect, text: string): unknown {
  if (dialect === "codex-toml") return parseToml(text);
  if (dialect === "opencode-jsonc") return parseJsonc(text);
  return JSON.parse(text);
}

function entriesOf(map: unknown, scope: McpScope): Entry[] {
  if (!isObj(map)) return [];
  return Object.entries(map)
    .filter((e): e is [string, Record<string, unknown>] => isObj(e[1]))
    .map(([name, entry]) => ({ name, scope, entry }));
}

/** Server entries of a parsed config; for `~/.claude.json` project paths are dropped, only `local` remains. */
function collect(dialect: McpDialect, root: Record<string, unknown>, scope: McpScope): Entry[] {
  if (dialect === "codex-toml") return entriesOf(root.mcp_servers, scope);
  if (dialect === "opencode-jsonc") return opencodeEntries(root.mcp, scope);
  if (dialect !== "claude-user-json") return entriesOf(root.mcpServers, scope);
  const local = isObj(root.projects)
    ? Object.values(root.projects).flatMap((p) =>
        isObj(p) ? entriesOf(p.mcpServers, "local") : [],
      )
    : [];
  return [...entriesOf(root.mcpServers, "user"), ...local];
}

/** V2 servers under `mcp.servers`; every other object under `mcp` is a V1 server. */
function opencodeEntries(mcp: unknown, scope: McpScope): Entry[] {
  if (!isObj(mcp)) return [];
  const v1 = entriesOf(mcp, scope).filter((e) => !(e.name === "servers" && !("type" in e.entry)));
  return [...entriesOf(mcp.servers, scope), ...v1];
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function named(dialect: McpDialect, values: RawServer["env"], refs: string[]): McpNamedValue[] {
  const out = new Map<string, McpNamedValue>();
  for (const { name, value } of values) {
    const kind = valueKind(dialect, value);
    out.set(name, { name, kind, secret_like: secretLike(name, kind, value) });
  }
  for (const name of refs) {
    if (!out.has(name))
      out.set(name, { name, kind: "reference", secret_like: secretLike(name, "reference", null) });
  }
  return [...out.values()].sort(byName);
}

function hasLiteralSecret(
  dialect: McpDialect,
  raw: RawServer,
  env: McpNamedValue[],
  headers: McpNamedValue[],
): boolean {
  const literalSecret = (v: McpNamedValue) => v.kind === "literal" && v.secret_like;
  return (
    env.some(literalSecret) ||
    headers.some(literalSecret) ||
    (raw.url !== null && urlHasSecret(raw.url)) ||
    argsHaveSecret(dialect, raw.args) ||
    valueKind(dialect, raw.oauthSecret) === "literal"
  );
}

/** The whitelist: only these fields leave the parser, never a value, argument, path or URL beyond its origin. */
function observe(dialect: McpDialect, raw: RawServer): McpServerObservation {
  const launch = raw.command
    ? analyzeLaunch(raw.command, raw.args)
    : { launcher: null, package: null, pinned: false, version: null };
  const env = named(dialect, raw.env, raw.envRefs);
  const headers = named(dialect, raw.headers, raw.headerRefs);
  return {
    name: raw.name,
    scope: raw.scope,
    transport: raw.transport,
    launcher: launch.launcher,
    package: launch.package,
    pinned: launch.pinned,
    version: launch.version,
    origin: raw.url ? urlOrigin(raw.url) : null,
    env,
    headers,
    literal_secret: hasLiteralSecret(dialect, raw, env, headers),
    enabled: raw.enabled,
  };
}

const FORMAT: Record<McpDialect, string> = {
  "claude-mcp-json": "JSON",
  "claude-user-json": "JSON",
  "codex-toml": "TOML",
  "cursor-json": "JSON",
  "opencode-jsonc": "JSONC",
};

/**
 * Reads one agent config into observations without values. Never throws; the parser's own error text is not
 * passed on because it may quote the config.
 */
export function parseMcpConfig(
  source: { dialect: McpDialect; scope: "project" | "user" },
  text: string,
): McpParseResult {
  let root: unknown;
  try {
    root = parseRoot(source.dialect, text);
  } catch {
    return {
      servers: [],
      issues: [{ code: "mcp_config_invalid", message: `not valid ${FORMAT[source.dialect]}` }],
    };
  }
  if (!isObj(root)) return { servers: [], issues: [] };
  const servers: McpServerObservation[] = [];
  const issues: McpIssue[] = [];
  for (const { name, scope, entry } of collect(source.dialect, root, source.scope)) {
    const read = READERS[source.dialect](name, scope, entry);
    if ("invalid" in read) {
      issues.push({
        code: "mcp_server_invalid",
        message: `MCP server "${name}" has no command or url`,
        server: name,
      });
      continue;
    }
    servers.push(observe(source.dialect, read));
  }
  servers.sort((a, b) => byName(a, b) || (a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0));
  return { servers, issues };
}
