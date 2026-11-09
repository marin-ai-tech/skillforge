import type { RuntimeId } from "../runtimes/table.ts";
import type { McpDialect } from "./types.ts";

export type McpConfigSource = {
  runtime: RuntimeId;
  /** `project`: path from the project root; `user`: path from the home directory. */
  scope: "project" | "user";
  path: string;
  dialect: McpDialect;
};

/** Date the sources below were checked against each agent's documentation (links in mcp-config-formats design). */
export const MCP_CONFIG_SOURCES_CHECKED = "2026-11-09";

/**
 * Where each agent keeps MCP servers. Gemini CLI and Qwen Code are documented but not
 * read yet; managed and plugin configs are out of scope.
 */
export const MCP_CONFIG_SOURCES: readonly McpConfigSource[] = [
  { runtime: "claude-code", scope: "project", path: ".mcp.json", dialect: "claude-mcp-json" },
  { runtime: "claude-code", scope: "user", path: ".claude.json", dialect: "claude-user-json" },
  { runtime: "codex", scope: "project", path: ".codex/config.toml", dialect: "codex-toml" },
  { runtime: "codex", scope: "user", path: ".codex/config.toml", dialect: "codex-toml" },
  { runtime: "cursor", scope: "project", path: ".cursor/mcp.json", dialect: "cursor-json" },
  { runtime: "cursor", scope: "user", path: ".cursor/mcp.json", dialect: "cursor-json" },
  { runtime: "opencode", scope: "project", path: "opencode.json", dialect: "opencode-jsonc" },
  { runtime: "opencode", scope: "project", path: "opencode.jsonc", dialect: "opencode-jsonc" },
  {
    runtime: "opencode",
    scope: "project",
    path: ".opencode/opencode.json",
    dialect: "opencode-jsonc",
  },
  {
    runtime: "opencode",
    scope: "project",
    path: ".opencode/opencode.jsonc",
    dialect: "opencode-jsonc",
  },
  {
    runtime: "opencode",
    scope: "user",
    path: ".config/opencode/opencode.json",
    dialect: "opencode-jsonc",
  },
  {
    runtime: "opencode",
    scope: "user",
    path: ".config/opencode/opencode.jsonc",
    dialect: "opencode-jsonc",
  },
];
