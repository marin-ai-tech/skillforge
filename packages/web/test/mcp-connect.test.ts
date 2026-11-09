// Acceptance tests for the MCP connection commands for five clients: exact strings
// (verified with real clients, except Cursor, which follows its documentation) and refusal of shell substitution.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MCP_CLIENTS, mcpConnectSnippets } from "../src/lib/mcp-connect.ts";

const BASE = "http://127.0.0.1:8787";
const TOKEN = "sf_AbC-1_x";

test("clients in display order", () => {
  assert.deepEqual(MCP_CLIENTS, ["claude-code", "codex", "cursor", "opencode", "qwen"]);
});

test("Claude Code: unchanged commands", () => {
  const s = mcpConnectSnippets("claude-code", { baseUrl: BASE, token: TOKEN });
  assert.equal(
    s.http,
    `claude mcp add --transport http skillforge ${BASE}/mcp --header "Authorization: Bearer ${TOKEN}"`,
  );
  assert.equal(s.stdio, "claude mcp add skillforge -- skillforge mcp");
});

test("Codex: token only via environment variable", () => {
  const s = mcpConnectSnippets("codex", { baseUrl: BASE, token: TOKEN });
  assert.equal(
    s.http,
    `codex mcp add skillforge --url ${BASE}/mcp --bearer-token-env-var SKILLFORGE_TOKEN`,
  );
  assert.equal(s.stdio, `codex mcp add skillforge --env SKILLFORGE_URL=${BASE} -- skillforge mcp`);
  assert.ok(
    !s.http.includes(TOKEN) && !s.stdio.includes(TOKEN),
    "Codex: the token does not end up in the command",
  );
  assert.ok(
    s.notes.some((n) => n.includes("SKILLFORGE_TOKEN")),
    JSON.stringify(s.notes),
  );
});

test("OpenCode: header with '='", () => {
  const s = mcpConnectSnippets("opencode", { baseUrl: BASE, token: TOKEN });
  assert.equal(
    s.http,
    `opencode mcp add skillforge --url ${BASE}/mcp --header "Authorization=Bearer ${TOKEN}"`,
  );
  assert.equal(s.stdio, "opencode mcp add skillforge -- skillforge mcp");
});

test("Qwen Code: user scope, no approval needed", () => {
  const s = mcpConnectSnippets("qwen", { baseUrl: BASE, token: TOKEN });
  assert.equal(
    s.http,
    `qwen mcp add -s user -t http -H "Authorization: Bearer ${TOKEN}" skillforge ${BASE}/mcp`,
  );
  assert.equal(s.stdio, "qwen mcp add -s user skillforge skillforge mcp");
});

test("Cursor: JSON for ~/.cursor/mcp.json and a do-not-commit warning", () => {
  const s = mcpConnectSnippets("cursor", { baseUrl: BASE, token: TOKEN });
  assert.deepEqual(JSON.parse(s.http), {
    mcpServers: {
      skillforge: { url: `${BASE}/mcp`, headers: { Authorization: `Bearer ${TOKEN}` } },
    },
  });
  assert.deepEqual(JSON.parse(s.stdio), {
    mcpServers: { skillforge: { command: "skillforge", args: ["mcp"] } },
  });
  const notes = s.notes.join("\n");
  assert.ok(notes.includes("~/.cursor/mcp.json"), notes);
  assert.match(notes, /commit/i);
  assert.ok(notes.includes(".cursor/mcp.json"), notes);
});

test("HTTPS base and trailing slash", () => {
  const s = mcpConnectSnippets("opencode", { baseUrl: "https://sf.example.com/", token: TOKEN });
  assert.ok(s.http.includes("--url https://sf.example.com/mcp "), s.http);
});

test("attack: shell metacharacters in base URL or token are rejected", () => {
  const bad: Array<{ baseUrl: string; token: string }> = [
    { baseUrl: 'http://h/"; rm -rf ~', token: TOKEN },
    { baseUrl: "http://h/ x", token: TOKEN },
    { baseUrl: "http://h/`calc`", token: TOKEN },
    { baseUrl: "http://h\\x", token: TOKEN },
    { baseUrl: "javascript:alert(1)", token: TOKEN },
    { baseUrl: BASE, token: 'sf_x" && calc' },
    { baseUrl: BASE, token: "sf_x$(calc)" },
    { baseUrl: BASE, token: "ghp_notours" },
    { baseUrl: BASE, token: "" },
  ];
  for (const client of MCP_CLIENTS) {
    for (const input of bad) {
      assert.throws(
        () => mcpConnectSnippets(client, input),
        undefined,
        `${client}: ${JSON.stringify(input)}`,
      );
    }
  }
});
