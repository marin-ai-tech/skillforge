import type { McpScope, McpTransport, RawServer } from "./types.ts";

type Obj = Record<string, unknown>;

export function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function pairs(v: unknown): Array<{ name: string; value: unknown }> {
  return isObj(v) ? Object.entries(v).map(([name, value]) => ({ name, value })) : [];
}

function blank(name: string, scope: McpScope): RawServer {
  return {
    name,
    scope,
    transport: "unknown",
    command: null,
    args: [],
    url: null,
    env: [],
    headers: [],
    envRefs: [],
    headerRefs: [],
    oauthSecret: undefined,
    enabled: true,
  };
}

/** A server entry is usable when it has a program or an address; otherwise the caller reports it. */
export type Read = RawServer | { invalid: string };

function finish(raw: RawServer): Read {
  return raw.command === null && raw.url === null ? { invalid: raw.name } : raw;
}

const CLAUDE_TYPES: Record<string, McpTransport> = {
  stdio: "stdio",
  http: "http",
  "streamable-http": "http",
  sse: "sse",
  ws: "ws",
};

function claudeTransport(e: Obj): McpTransport {
  const type = str(e.type);
  if (type) return CLAUDE_TYPES[type] ?? "unknown";
  return str(e.command) ? "stdio" : "unknown";
}

/** Claude Code `.mcp.json` / `~/.claude.json` entry. */
export function readClaude(name: string, scope: McpScope, e: Obj): Read {
  const raw = blank(name, scope);
  raw.transport = claudeTransport(e);
  const remote = raw.transport !== "stdio";
  raw.command = remote ? null : str(e.command);
  raw.args = remote ? [] : strings(e.args);
  raw.url = remote ? str(e.url) : null;
  raw.env = pairs(e.env);
  raw.headers = remote ? pairs(e.headers) : [];
  return finish(raw);
}

/** Cursor `mcp.json` entry: `url` means remote; `type` is optional. */
export function readCursor(name: string, scope: McpScope, e: Obj): Read {
  const raw = blank(name, scope);
  raw.url = str(e.url);
  raw.transport = raw.url ? "http" : str(e.command) ? "stdio" : "unknown";
  raw.command = raw.url ? null : str(e.command);
  raw.args = raw.url ? [] : strings(e.args);
  raw.env = pairs(e.env);
  raw.headers = raw.url ? pairs(e.headers) : [];
  raw.oauthSecret = isObj(e.auth) ? e.auth.CLIENT_SECRET : undefined;
  return finish(raw);
}

/** OpenCode V1 (`mcp.<name>`) or V2 (`mcp.servers.<name>`) entry; an entry without `type` is skipped by OpenCode. */
export function readOpencode(name: string, scope: McpScope, e: Obj): Read {
  const raw = blank(name, scope);
  const command = strings(e.command);
  if (e.type === "local" && command.length > 0) {
    raw.transport = "stdio";
    raw.command = command[0]!;
    raw.args = command.slice(1);
  } else if (e.type === "remote") {
    raw.transport = "http";
    raw.url = str(e.url);
    raw.headers = pairs(e.headers);
  }
  raw.env = pairs(e.environment);
  raw.oauthSecret = isObj(e.oauth) ? (e.oauth.clientSecret ?? e.oauth.client_secret) : undefined;
  raw.enabled = e.enabled !== false && e.disabled !== true;
  return finish(raw);
}

function envVarNames(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x : isObj(x) ? str(x.name) : null))
    .filter((x): x is string => x !== null);
}

/** Codex `[mcp_servers.<name>]` table: `url` means streamable HTTP; variables are named, never interpolated. */
export function readCodex(name: string, scope: McpScope, e: Obj): Read {
  const raw = blank(name, scope);
  raw.url = str(e.url);
  raw.transport = raw.url ? "http" : str(e.command) ? "stdio" : "unknown";
  raw.command = raw.url ? null : str(e.command);
  raw.args = raw.url ? [] : strings(e.args);
  raw.env = pairs(e.env);
  raw.envRefs = envVarNames(e.env_vars);
  raw.headers = pairs(e.http_headers);
  raw.headerRefs = [
    ...Object.keys(isObj(e.env_http_headers) ? e.env_http_headers : {}),
    ...(str(e.bearer_token_env_var) ? ["Authorization"] : []),
  ];
  raw.oauthSecret = isObj(e.oauth) ? e.oauth.client_secret : undefined;
  raw.enabled = e.enabled !== false;
  return finish(raw);
}
