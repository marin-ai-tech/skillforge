// fix-mcp-token-snippet (#184): help and docs must not advise a Claude Code command that writes the MCP token into a
// config file (the MCP inventory then reports a literal secret). They name the variable and how to remove an old entry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/client.mjs";

const HELP = join(ROOT, "packages", "web", "src", "help");
// The second-language topics live only in the lang-local tree; the public tree checks the English ones.
const FILES = [
  ...["topics", "topics-ru"]
    .filter((dir) => existsSync(join(HELP, dir)))
    .flatMap((dir) =>
      ["getting-started/mcp.md", "pages/tokens.md", "actions/tokens/mcp-snippet.md"].map((t) => join(HELP, dir, t)),
    ),
  join(ROOT, "docs", "en", "13-mcp.md"),
];
// Any value after "Bearer" except a variable reference: <token>, <MCP token>, a real token.
const LITERAL = /claude mcp add --transport http[^\n`|]*Authorization: Bearer (?!\$\{)/;

/** Every markdown file under a directory (help topics, docs): the old command must not survive anywhere. */
function markdown(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => join(e.parentPath ?? e.path, e.name));
}

test("no Claude Code command with a literal token in help and docs", () => {
  // docs/backlog.md records the defect itself and quotes the old command.
  const docs = markdown(join(ROOT, "docs")).filter((f) => !f.endsWith("backlog.md"));
  for (const f of [...markdown(HELP), ...docs]) {
    const text = readFileSync(f, "utf8");
    assert.doesNotMatch(text, LITERAL, f);
  }
});

test("the topics that show the Claude Code HTTP connection name the variable and the removal of an old entry", () => {
  for (const f of FILES.filter((p) => !p.includes("mcp-snippet"))) {
    const text = readFileSync(f, "utf8");
    assert.ok(text.includes("${SKILLFORGE_MCP_TOKEN}"), `${f}: no \${SKILLFORGE_MCP_TOKEN}`);
    assert.ok(text.includes("claude mcp remove skillforge"), `${f}: no claude mcp remove skillforge`);
  }
});

test("negative: other clients keep their documented commands", () => {
  const en = readFileSync(join(HELP, "topics", "getting-started", "mcp.md"), "utf8");
  assert.match(en, /codex mcp add skillforge --url <server>\/mcp --bearer-token-env-var/);
  assert.match(en, /qwen mcp add -s user -t http/);
});

// Independent oracle (task 4.2): the snippet is read by the same parser as the MCP inventory of `agent scan --mcp`.
// The former command produced an entry the inventory flags as a literal secret; the block must not.
test("the Claude Code block passes the MCP inventory: a variable reference, no literal secret", async () => {
  const { mcpConnectSnippets } = await import("../packages/web/src/lib/mcp-connect.ts");
  const { parseMcpConfig } = await import("../packages/core/src/mcp/index.ts");
  const token = "sf_AbCdEfGh_0123456789abcdef0123456789abcdef";
  const { http } = mcpConnectSnippets("claude-code", { baseUrl: "http://127.0.0.1:8787", token });
  const r = parseMcpConfig({ dialect: "claude-mcp-json", scope: "project" }, http);
  assert.equal(r.servers.length, 1, JSON.stringify(r));
  assert.equal(r.servers[0].literal_secret, false, JSON.stringify(r.servers[0]));
  assert.ok(!JSON.stringify(r).includes(token));
  // negative: the same entry with the token itself is flagged, so the oracle can tell the two apart
  const literal = http.replace("${SKILLFORGE_MCP_TOKEN}", token);
  const bad = parseMcpConfig({ dialect: "claude-mcp-json", scope: "project" }, literal);
  assert.equal(bad.servers[0].literal_secret, true, JSON.stringify(bad.servers[0]));
});
