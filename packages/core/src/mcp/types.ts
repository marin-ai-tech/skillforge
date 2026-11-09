/** Config dialects SkillForge reads MCP servers from (checked against each agent's docs, see sources.ts). */
export type McpDialect =
  "claude-mcp-json" | "claude-user-json" | "codex-toml" | "cursor-json" | "opencode-jsonc";

export type McpScope = "project" | "user" | "local";

export type McpTransport = "stdio" | "http" | "sse" | "ws" | "unknown";

/** How a value is written: a reference to a variable, a literal, or nothing. The value itself is never kept. */
export type McpValueKind = "reference" | "literal" | "empty";

export type McpNamedValue = { name: string; kind: McpValueKind; secret_like: boolean };

/**
 * What the registry may learn about one configured MCP server. Built from a whitelist of fields: no values of
 * variables, headers or OAuth fields, no arguments, no program path, no URL path, query or userinfo.
 */
export type McpServerObservation = {
  name: string;
  scope: McpScope;
  transport: McpTransport;
  launcher: string | null;
  package: string | null;
  pinned: boolean;
  version: string | null;
  origin: string | null;
  env: McpNamedValue[];
  headers: McpNamedValue[];
  literal_secret: boolean;
  enabled: boolean;
};

export type McpIssue = {
  code: "mcp_config_invalid" | "mcp_server_invalid";
  message: string;
  server?: string;
};

export type McpParseResult = { servers: McpServerObservation[]; issues: McpIssue[] };

/** One server entry after the dialect is read, before values are reduced to kinds. Never leaves the module. */
export type RawServer = {
  name: string;
  scope: McpScope;
  transport: McpTransport;
  command: string | null;
  args: string[];
  url: string | null;
  env: Array<{ name: string; value: unknown }>;
  headers: Array<{ name: string; value: unknown }>;
  /** Names given only by reference (Codex `env_vars`, `env_http_headers`, `bearer_token_env_var`). */
  envRefs: string[];
  headerRefs: string[];
  oauthSecret: unknown;
  enabled: boolean;
};
