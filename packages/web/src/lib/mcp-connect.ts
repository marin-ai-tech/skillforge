// Connect commands (and config blocks) for MCP clients on /me/tokens.
// Pure module: no DOM, no JSX, no app imports - Node tests and the real-client oracle import it directly.
// The oracle splits each command on spaces and "double quotes" and runs it without a shell, so commands use
// no single quotes, carets or line continuations.

export const MCP_CLIENTS = ["claude-code", "codex", "cursor", "opencode", "qwen"] as const;

export type McpClient = (typeof MCP_CLIENTS)[number];

export interface McpConnectInput {
  baseUrl: string;
  token: string;
}

export interface McpConnectSnippets {
  http: string;
  stdio: string;
  notes: string[];
}

const TOKEN_RE = /^sf_[A-Za-z0-9_-]+$/;
/** Same alphabet as `commandSafeBaseUrl`: nothing a shell (cmd.exe, sh, PowerShell) treats specially. */
const BASE_URL_RE = /^https?:\/\/[A-Za-z0-9.:/_~-]+$/;

export function isMcpClient(value: unknown): value is McpClient {
  return typeof value === "string" && (MCP_CLIENTS as readonly string[]).includes(value);
}

function safeBaseUrl(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("mcp-connect: baseUrl must be a string");
  const base = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  if (!BASE_URL_RE.test(base)) {
    throw new Error(
      "mcp-connect: baseUrl must be http(s):// without spaces, quotes or shell characters",
    );
  }
  return base;
}

function safeToken(raw: unknown): string {
  if (typeof raw !== "string" || !TOKEN_RE.test(raw)) {
    throw new Error("mcp-connect: token must match ^sf_[A-Za-z0-9_-]+$");
  }
  return raw;
}

/** The command that saves a token with MCP consent for the stdio bridge (no token in it). */
export function mcpTokenSaveCommand(base: string): string {
  return `skillforge login --url ${base} --mcp-token-stdin`;
}

function stdioNote(base: string): string {
  return `The stdio bridge (skillforge mcp) uses the MCP token saved by: ${mcpTokenSaveCommand(base)}`;
}

/**
 * Commands that connect `client` to the SkillForge MCP endpoint at `baseUrl`; the MCP token itself goes into the
 * SKILLFORGE_MCP_TOKEN environment variable, never into a snippet or a client config file.
 * Throws on an unknown client or on input that is unsafe to put into a shell command.
 */
export function mcpConnectSnippets(client: McpClient, input: McpConnectInput): McpConnectSnippets {
  if (!isMcpClient(client)) throw new Error("mcp-connect: unknown client");
  const base = safeBaseUrl(input?.baseUrl);
  // The token is checked but never written into a snippet: every client reads it from SKILLFORGE_MCP_TOKEN.
  safeToken(input?.token);
  const url = `${base}/mcp`;
  const STDIO_NOTE = stdioNote(base);
  switch (client) {
    case "claude-code":
      // A project .mcp.json block: Claude Code expands ${SKILLFORGE_MCP_TOKEN} itself at start, so no file keeps the
      // token. A command line would not do: bash and PowerShell expand ${...} before Claude Code saves it.
      return {
        http: JSON.stringify(
          {
            mcpServers: {
              skillforge: {
                type: "http",
                url,
                headers: { Authorization: "Bearer ${SKILLFORGE_MCP_TOKEN}" },
              },
            },
          },
          null,
          2,
        ),
        stdio: "claude mcp add skillforge -- skillforge mcp",
        notes: [
          `Recommended: stdio, with no token in any file. ${STDIO_NOTE}`,
          "Put this block into the project .mcp.json and set SKILLFORGE_MCP_TOKEN to the MCP token in the environment Claude Code starts from; the file keeps only the variable name.",
          "An old entry made by the former claude mcp add --transport http command keeps the token in ~/.claude.json: remove it with claude mcp remove skillforge",
        ],
      };
    case "codex":
      return {
        http: `codex mcp add skillforge --url ${url} --bearer-token-env-var SKILLFORGE_MCP_TOKEN`,
        stdio: `codex mcp add skillforge --env SKILLFORGE_URL=${base} -- skillforge mcp`,
        notes: [
          "Set SKILLFORGE_MCP_TOKEN to the MCP token in the environment Codex starts from; config.toml keeps only the variable name.",
          "An entry made by the former command reads another variable: run the command again to replace it.",
          `Recommended: stdio. Save the MCP token with ${mcpTokenSaveCommand(base)}; the server URL is passed with --env SKILLFORGE_URL.`,
        ],
      };
    case "cursor":
      return {
        http: JSON.stringify(
          {
            mcpServers: {
              skillforge: { url, headers: { Authorization: "Bearer ${env:SKILLFORGE_MCP_TOKEN}" } },
            },
          },
          null,
          2,
        ),
        stdio: JSON.stringify(
          { mcpServers: { skillforge: { command: "skillforge", args: ["mcp"] } } },
          null,
          2,
        ),
        notes: [
          "Add this JSON to your user-level ~/.cursor/mcp.json and set SKILLFORGE_MCP_TOKEN to the MCP token in the environment Cursor starts from; the file keeps only the variable name.",
          "An entry with the token itself in the Authorization header: replace the token with ${env:SKILLFORGE_MCP_TOKEN}.",
          `Recommended: stdio, with no token in the file. ${STDIO_NOTE}`,
        ],
      };
    case "opencode":
      // OpenCode expands {env:NAME} in its config at start; no shell (bash, PowerShell, cmd.exe) touches {env:...}.
      return {
        http: `opencode mcp add skillforge --url ${url} --header "Authorization=Bearer {env:SKILLFORGE_MCP_TOKEN}"`,
        stdio: "opencode mcp add skillforge -- skillforge mcp",
        notes: [
          "Set SKILLFORGE_MCP_TOKEN to the MCP token in the environment OpenCode starts from; the config keeps only the variable name.",
          "An entry made by the former command keeps the token in the OpenCode config: running this command again replaces it.",
          STDIO_NOTE,
        ],
      };
    case "qwen":
      // A block, not a command: bash and PowerShell expand $VAR inside double quotes before Qwen Code saves it.
      return {
        http: JSON.stringify(
          {
            mcpServers: {
              skillforge: {
                httpUrl: url,
                headers: { Authorization: "Bearer ${SKILLFORGE_MCP_TOKEN}" },
              },
            },
          },
          null,
          2,
        ),
        stdio: "qwen mcp add -s user skillforge skillforge mcp",
        notes: [
          "Add this block to mcpServers in your user-level ~/.qwen/settings.json and set SKILLFORGE_MCP_TOKEN to the MCP token in the environment Qwen Code starts from; the file keeps only the variable name.",
          "An entry made by the former qwen mcp add command keeps the token in ~/.qwen/settings.json: remove it first with qwen mcp remove -s user skillforge",
          STDIO_NOTE,
        ],
      };
  }
}
