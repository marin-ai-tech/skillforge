import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MCP_CONFIG_SOURCES,
  parseMcpConfig,
  type McpConfigSource,
  type McpServerObservation,
} from "@skillforge/core";

/** A config larger than this is reported as unreadable instead of being read (`~/.claude.json` can grow). */
const MAX_CONFIG_BYTES = 32 * 1024 * 1024;

export type McpScanServer = McpServerObservation & { runtime: string; source: string };

/** The `mcp` field of an agent snapshot: observations without values, sources as path templates only. */
export type McpScanBody = {
  sources: Array<{ runtime: string; scope: "project" | "user"; path: string; found: boolean }>;
  servers: McpScanServer[];
  issues: Array<{ code: string; source: string; server?: string }>;
};

/** Runtimes whose MCP configs SkillForge knows how to read. */
export function mcpRuntimes(): string[] {
  return [...new Set(MCP_CONFIG_SOURCES.map((s) => s.runtime))];
}

type Where = { cwd: string; home: string; env: NodeJS.ProcessEnv };

/** Absolute file to read and the template the registry sees; `$CLAUDE_CONFIG_DIR` and `$CODEX_HOME` win. */
function locate(source: McpConfigSource, where: Where): { abs: string; template: string } {
  if (source.scope === "project") {
    return { abs: path.join(where.cwd, source.path), template: source.path };
  }
  const claudeDir = where.env.CLAUDE_CONFIG_DIR;
  if (source.runtime === "claude-code" && claudeDir) {
    return {
      abs: path.join(claudeDir, ".claude.json"),
      template: "$CLAUDE_CONFIG_DIR/.claude.json",
    };
  }
  const codexHome = where.env.CODEX_HOME;
  if (source.runtime === "codex" && codexHome) {
    return { abs: path.join(codexHome, "config.toml"), template: "$CODEX_HOME/config.toml" };
  }
  return { abs: path.join(where.home, source.path), template: `~/${source.path}` };
}

function readSmall(abs: string): { text: string } | { missing: true } | { unreadable: true } {
  let st: fs.Stats;
  try {
    st = fs.statSync(abs);
  } catch {
    return { missing: true };
  }
  if (!st.isFile()) return { missing: true };
  if (st.size > MAX_CONFIG_BYTES) return { unreadable: true };
  try {
    return { text: fs.readFileSync(abs, "utf8") };
  } catch {
    return { unreadable: true };
  }
}

/**
 * Reads the runtime's MCP configs (only called with the user's `--mcp` consent) and reduces them to observations.
 * Nothing but the observation whitelist, the templates and issue codes goes into the result.
 */
export function collectMcp(
  runtime: string,
  where: Where = { cwd: process.cwd(), home: os.homedir(), env: process.env },
): McpScanBody {
  const body: McpScanBody = { sources: [], servers: [], issues: [] };
  for (const source of MCP_CONFIG_SOURCES.filter((s) => s.runtime === runtime)) {
    const { abs, template } = locate(source, where);
    const read = readSmall(abs);
    body.sources.push({
      runtime,
      scope: source.scope,
      path: template,
      found: !("missing" in read),
    });
    if ("missing" in read) continue;
    if ("unreadable" in read) {
      body.issues.push({ code: "mcp_config_unreadable", source: template });
      continue;
    }
    const parsed = parseMcpConfig({ dialect: source.dialect, scope: source.scope }, read.text);
    for (const s of parsed.servers) body.servers.push({ ...s, runtime, source: template });
    for (const i of parsed.issues) {
      body.issues.push({
        code: i.code,
        source: template,
        ...(i.server ? { server: i.server } : {}),
      });
    }
  }
  return body;
}

function target(s: McpScanServer): string {
  if (s.package) return s.version ? `${s.package}@${s.version}` : s.package;
  return s.origin ?? s.launcher ?? "";
}

function notes(s: McpScanServer): string {
  const out: string[] = [];
  if (s.transport === "stdio" && s.package && !s.pinned) out.push("unpinned");
  if (s.literal_secret) {
    const names = [...s.env, ...s.headers]
      .filter((v) => v.kind === "literal" && v.secret_like)
      .map((v) => v.name);
    out.push(`literal secret: ${names.length > 0 ? names.join(", ") : "url, args or oauth"}`);
  }
  if (!s.enabled) out.push("disabled");
  return out.join("; ");
}

/** Summary line and table of what was observed; warnings name variables, never values. */
export function mcpReport(body: McpScanBody): { line: string; rows: string[][] } {
  const unpinned = body.servers.filter((s) => s.transport === "stdio" && s.package && !s.pinned);
  const secret = body.servers.filter((s) => s.literal_secret);
  return {
    line: `mcp: ${body.servers.length} server(s), ${unpinned.length} unpinned, ${secret.length} with literal secrets`,
    rows: body.servers.map((s) => [s.name, s.scope, s.source, s.transport, target(s), notes(s)]),
  };
}
