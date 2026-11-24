// fix-mcp-token-snippet (#184), fix-mcp-client-snippets (#193): help and docs must not advise a client command or config
// entry that writes the MCP token into a client config file (the MCP inventory then reports a literal secret). They name
// the variable of each client and how to replace an old entry.
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
// Any value after "Bearer" except a variable reference (${VAR}, ${env:VAR}, {env:VAR}): <token>, <MCP token>, a real token.
const VALUE = String.raw`Bearer (?!\$\{|\{env:)`;
/** A client command that writes the token into a config file: claude/opencode/qwen/... mcp add ... Bearer <value>. */
const LITERAL_COMMAND = new RegExp(String.raw`\bmcp add\b[^\n` + "`" + String.raw`|]*` + VALUE);
/** A config entry with the token itself: "Authorization": "Bearer <value>". */
const LITERAL_ENTRY = new RegExp(String.raw`"Authorization"\s*:\s*"` + VALUE);
/** Codex reading the MCP token from the variable the CLI takes as its regular token. */
const CLI_VARIABLE = /--bearer-token-env-var SKILLFORGE_TOKEN\b/;

/** Every markdown file under a directory (help topics, docs): the old command must not survive anywhere. */
function markdown(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => join(e.parentPath ?? e.path, e.name));
}

test("no client snippet with a literal token, and no SKILLFORGE_TOKEN for Codex, in help and docs", () => {
  // docs/backlog.md records the defects themselves and quotes the old commands.
  const docs = markdown(join(ROOT, "docs")).filter((f) => !f.endsWith("backlog.md"));
  const found = [];
  for (const f of [...markdown(HELP), ...docs]) {
    const text = readFileSync(f, "utf8");
    for (const re of [LITERAL_COMMAND, LITERAL_ENTRY, CLI_VARIABLE]) {
      const m = re.exec(text);
      if (m) found.push(`${f}: ${text.slice(m.index, m.index + 90).split("\n")[0]}`);
    }
  }
  assert.deepEqual(found, []);
});

test("negative: a prose description of the header is not a snippet", () => {
  const prose = "Every MCP request must carry `Authorization: Bearer <token>`.";
  for (const re of [LITERAL_COMMAND, LITERAL_ENTRY, CLI_VARIABLE]) assert.doesNotMatch(prose, re);
  assert.match('opencode mcp add skillforge --url <server>/mcp --header "Authorization=Bearer <token>"', LITERAL_COMMAND);
  assert.match('{"headers":{"Authorization":"Bearer <token>"}}', LITERAL_ENTRY);
  assert.doesNotMatch('{"headers":{"Authorization":"Bearer ${env:SKILLFORGE_MCP_TOKEN}"}}', LITERAL_ENTRY);
});

test("the topics that show the HTTP connection name the variable of each client and how to replace an old entry", () => {
  for (const f of FILES) {
    const text = readFileSync(f, "utf8");
    const need = ["${SKILLFORGE_MCP_TOKEN}", "{env:SKILLFORGE_MCP_TOKEN}", "--bearer-token-env-var SKILLFORGE_MCP_TOKEN"];
    if (!f.includes("mcp-snippet")) need.push("claude mcp remove skillforge", "qwen mcp remove -s user skillforge");
    for (const s of need) assert.ok(text.includes(s), `${f}: no ${s}`);
  }
});

test("negative: the stdio commands of the other clients stay as documented", () => {
  const en = readFileSync(join(HELP, "topics", "getting-started", "mcp.md"), "utf8");
  assert.match(en, /codex mcp add skillforge --url <server>\/mcp --bearer-token-env-var SKILLFORGE_MCP_TOKEN/);
  assert.ok(en.includes("opencode mcp add skillforge -- skillforge mcp"));
  assert.ok(en.includes("qwen mcp add -s user skillforge skillforge mcp"));
});

// Independent oracle (task 4.2 of fix-mcp-token-snippet, extended by fix-mcp-client-snippets): each snippet is read by the
// same parser as the MCP inventory of `agent scan --mcp`. The former snippets produced entries the inventory flags as a
// literal secret; the new ones must not. Qwen is not read by the inventory: its oracle is the real client (real-client-mcp).
const TOKEN = "sf_AbCdEfGh_0123456789abcdef0123456789abcdef";
const BASE = "http://127.0.0.1:8787";

/** The config entry OpenCode writes for `opencode mcp add skillforge --url U --header "K=V"` (checked with OpenCode 1.18). */
function opencodeEntry(command) {
  const url = /--url (\S+)/.exec(command)?.[1];
  const header = /--header "([^"=]+)=([^"]*)"/.exec(command);
  assert.ok(url && header, command);
  return JSON.stringify({ mcp: { skillforge: { type: "remote", url, headers: { [header[1]]: header[2] } } } });
}

test("the HTTP snippets pass the MCP inventory: a variable reference, no literal secret", async () => {
  const { mcpConnectSnippets } = await import("../packages/web/src/lib/mcp-connect.ts");
  const { parseMcpConfig } = await import("../packages/core/src/mcp/index.ts");
  const cases = [
    ["claude-code", "claude-mcp-json", (s) => s.http, "${SKILLFORGE_MCP_TOKEN}"],
    ["cursor", "cursor-json", (s) => s.http, "${env:SKILLFORGE_MCP_TOKEN}"],
    ["opencode", "opencode-jsonc", (s) => opencodeEntry(s.http), "{env:SKILLFORGE_MCP_TOKEN}"],
  ];
  for (const [client, dialect, entry, ref] of cases) {
    const text = entry(mcpConnectSnippets(client, { baseUrl: BASE, token: TOKEN }));
    const r = parseMcpConfig({ dialect, scope: "user" }, text);
    assert.equal(r.servers.length, 1, `${client}: ${JSON.stringify(r)}`);
    assert.equal(r.servers[0].literal_secret, false, `${client}: ${JSON.stringify(r.servers[0])}`);
    assert.ok(!JSON.stringify(r).includes(TOKEN));
    // negative: the same entry with the token itself is flagged, so the oracle can tell the two apart
    assert.ok(text.includes(ref), `${client}: ${text}`);
    const bad = parseMcpConfig({ dialect, scope: "user" }, text.replace(ref, TOKEN));
    assert.equal(bad.servers[0].literal_secret, true, `${client}: ${JSON.stringify(bad.servers[0])}`);
  }
});
