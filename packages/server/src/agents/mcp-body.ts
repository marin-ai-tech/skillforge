import { z } from "zod";
import { MCP_CONFIG_SOURCES } from "@skillforge/core";

/**
 * The `mcp` field of an agent snapshot, parsed at the boundary. Strict on every level: a field that could carry a
 * value (an env value, an argument, a URL path) has no place in the schema, so even a modified client cannot get a
 * secret stored. Source paths are templates from MCP_CONFIG_SOURCES, never absolute paths.
 */
const RUNTIMES = [...new Set(MCP_CONFIG_SOURCES.map((s) => s.runtime))] as [string, ...string[]];

/** `runtime|template` pairs a client may report, e.g. `claude-code|~/.claude.json`. */
const TEMPLATES = new Set([
  ...MCP_CONFIG_SOURCES.map((s) => `${s.runtime}|${s.scope === "user" ? `~/${s.path}` : s.path}`),
  "claude-code|$CLAUDE_CONFIG_DIR/.claude.json",
  "codex|$CODEX_HOME/config.toml",
]);

function isOrigin(value: string): boolean {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  const bare = u.username === "" && u.password === "" && u.search === "" && u.hash === "";
  return bare && (u.pathname === "/" || u.pathname === "") && `${u.protocol}//${u.host}` === value;
}

const name = z.string().min(1).max(128);
const namedValue = z.strictObject({
  name,
  kind: z.enum(["reference", "literal", "empty"]),
  secret_like: z.boolean(),
});

const server = z.strictObject({
  name,
  runtime: z.enum(RUNTIMES),
  source: z.string().max(64),
  scope: z.enum(["project", "user", "local"]),
  transport: z.enum(["stdio", "http", "sse", "ws", "unknown"]),
  launcher: z.string().min(1).max(64).nullable(),
  package: z.string().min(1).max(214).nullable(),
  pinned: z.boolean(),
  version: z.string().min(1).max(128).nullable(),
  origin: z.string().max(300).refine(isOrigin, "origin must be scheme://host[:port]").nullable(),
  env: z.array(namedValue).max(50),
  headers: z.array(namedValue).max(50),
  literal_secret: z.boolean(),
  enabled: z.boolean(),
});

const source = z.strictObject({
  runtime: z.enum(RUNTIMES),
  scope: z.enum(["project", "user"]),
  path: z.string().max(64),
  found: z.boolean(),
});

const issue = z.strictObject({
  code: z.enum(["mcp_config_invalid", "mcp_server_invalid", "mcp_config_unreadable"]),
  source: z.string().max(64),
  server: name.optional(),
});

const mcpSchema = z
  .strictObject({
    sources: z.array(source).max(20),
    servers: z.array(server).max(200),
    issues: z.array(issue).max(100),
  })
  .superRefine((body, ctx) => {
    const known = (runtime: string, path: string) => TEMPLATES.has(`${runtime}|${path}`);
    body.sources.forEach((s, i) => {
      if (!known(s.runtime, s.path))
        ctx.addIssue({ code: "custom", path: ["sources", i, "path"], message: "unknown source" });
    });
    body.servers.forEach((s, i) => {
      if (!known(s.runtime, s.source))
        ctx.addIssue({ code: "custom", path: ["servers", i, "source"], message: "unknown source" });
    });
    const paths = new Set(body.sources.map((s) => s.path));
    body.issues.forEach((s, i) => {
      if (!paths.has(s.source))
        ctx.addIssue({ code: "custom", path: ["issues", i, "source"], message: "unknown source" });
    });
  });

export type McpSnapshot = z.infer<typeof mcpSchema>;
export type McpSnapshotServer = McpSnapshot["servers"][number];

/** `undefined` when the field is absent (keep stored observations); an error message when it does not parse. */
export function parseMcpSnapshot(
  raw: unknown,
): { ok: true; value: McpSnapshot | undefined } | { ok: false; message: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  const parsed = mcpSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const first = parsed.error.issues[0];
  return {
    ok: false,
    message: `invalid mcp: ${first ? `${first.path.join(".")} ${first.message}` : "bad shape"}`,
  };
}
