// Connect commands for MCP clients on /me/tokens.
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

const STDIO_NOTE =
  "The stdio bridge (skillforge mcp) uses the server URL and token saved by skillforge login.";

/**
 * Commands that connect `client` to the SkillForge MCP endpoint at `baseUrl` with `token`.
 * Throws on an unknown client or on input that is unsafe to put into a shell command.
 */
export function mcpConnectSnippets(client: McpClient, input: McpConnectInput): McpConnectSnippets {
  if (!isMcpClient(client)) throw new Error("mcp-connect: unknown client");
  const base = safeBaseUrl(input?.baseUrl);
  const token = safeToken(input?.token);
  const url = `${base}/mcp`;
  switch (client) {
    case "claude-code":
      return {
        http: `claude mcp add --transport http skillforge ${url} --header "Authorization: Bearer ${token}"`,
        stdio: "claude mcp add skillforge -- skillforge mcp",
        notes: [STDIO_NOTE],
      };
    case "codex":
      return {
        http: `codex mcp add skillforge --url ${url} --bearer-token-env-var SKILLFORGE_TOKEN`,
        stdio: `codex mcp add skillforge --env SKILLFORGE_URL=${base} -- skillforge mcp`,
        notes: [
          "Set SKILLFORGE_TOKEN=<token> in the environment Codex starts from",
          "Recommended: stdio. The token comes from skillforge login; the server URL is passed with --env SKILLFORGE_URL.",
        ],
      };
    case "cursor":
      return {
        http: JSON.stringify(
          {
            mcpServers: {
              skillforge: { url, headers: { Authorization: `Bearer ${token}` } },
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
          "Add this JSON to your user-level ~/.cursor/mcp.json.",
          "Do not commit a token: keep it out of the project .cursor/mcp.json",
          `Recommended: stdio, with no token in the file. ${STDIO_NOTE}`,
        ],
      };
    case "opencode":
      return {
        http: `opencode mcp add skillforge --url ${url} --header "Authorization=Bearer ${token}"`,
        stdio: "opencode mcp add skillforge -- skillforge mcp",
        notes: [STDIO_NOTE],
      };
    case "qwen":
      return {
        http: `qwen mcp add -s user -t http -H "Authorization: Bearer ${token}" skillforge ${url}`,
        stdio: "qwen mcp add -s user skillforge skillforge mcp",
        notes: [STDIO_NOTE],
      };
  }
}
