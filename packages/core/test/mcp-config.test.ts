// Parsing of agents' MCP configs into observations without values. Fixtures and the expected result live in
// tests/fixtures/mcp-configs (formats checked against the agents' documentation, 09.11.2026). Main negative case:
// no FAKE-SECRET- string ends up in the result.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MCP_CONFIG_SOURCES,
  MCP_CONFIG_SOURCES_CHECKED,
  parseMcpConfig,
} from "../src/mcp/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DIR = join(ROOT, "tests", "fixtures", "mcp-configs");
type Expected = {
  dialect: string;
  scope: "project" | "user";
  issues: Array<{ code: string; server?: string }>;
  servers: unknown[];
};
const EXPECTED = JSON.parse(readFileSync(join(DIR, "expected.json"), "utf8")) as {
  files: Record<string, Expected>;
};

for (const [file, exp] of Object.entries(EXPECTED.files)) {
  test(`${file}: observations match expected.json, no secrets`, () => {
    const text = readFileSync(join(DIR, file), "utf8");
    const r = parseMcpConfig({ dialect: exp.dialect as never, scope: exp.scope }, text);
    assert.deepEqual(r.servers, exp.servers);
    assert.deepEqual(
      r.issues.map((i) => (i.server ? { code: i.code, server: i.server } : { code: i.code })),
      exp.issues,
    );
    const out = JSON.stringify(r);
    assert.ok(!out.includes("FAKE-SECRET-"), `the result contains a value from the config: ${out}`);
    // Paths and arguments do not leak: no URL paths, no program paths, no project paths.
    for (const s of [
      "/s/",
      "db.js",
      "C:/Users/dev",
      "tools\\\\",
      "--api-key",
      "sentry.dev/mcp",
      "example.com/mcp",
      "/sse",
      "acme_mcp",
    ]) {
      assert.ok(!out.includes(s), `the result contains "${s}": ${out}`);
    }
  });
}

test("source table: four agents, Gemini and Qwen are not parsed", () => {
  assert.equal(MCP_CONFIG_SOURCES_CHECKED, "2026-11-09");
  const rows = MCP_CONFIG_SOURCES.map(
    (s) => `${s.runtime}|${s.scope}|${s.path}|${s.dialect}`,
  ).sort();
  assert.deepEqual(
    rows,
    [
      "claude-code|project|.mcp.json|claude-mcp-json",
      "claude-code|user|.claude.json|claude-user-json",
      "codex|project|.codex/config.toml|codex-toml",
      "codex|user|.codex/config.toml|codex-toml",
      "cursor|project|.cursor/mcp.json|cursor-json",
      "cursor|user|.cursor/mcp.json|cursor-json",
      "opencode|project|.opencode/opencode.json|opencode-jsonc",
      "opencode|project|.opencode/opencode.jsonc|opencode-jsonc",
      "opencode|project|opencode.json|opencode-jsonc",
      "opencode|project|opencode.jsonc|opencode-jsonc",
      "opencode|user|.config/opencode/opencode.json|opencode-jsonc",
      "opencode|user|.config/opencode/opencode.jsonc|opencode-jsonc",
    ].sort(),
  );
});

function one(dialect: string, server: Record<string, unknown>) {
  const text =
    dialect === "opencode-jsonc"
      ? JSON.stringify({ mcp: { s: server } })
      : JSON.stringify({ mcpServers: { s: server } });
  const r = parseMcpConfig({ dialect: dialect as never, scope: "project" }, text);
  assert.equal(r.servers.length, 1, JSON.stringify(r));
  return r.servers[0]!;
}

test("version pinning by launch method", () => {
  const hex = "ab".repeat(32);
  const cases: Array<[string[], boolean, string | null, string | null]> = [
    [
      ["npx", "-y", "@modelcontextprotocol/server-github@2025.4.8"],
      true,
      "@modelcontextprotocol/server-github",
      "2025.4.8",
    ],
    [
      ["npx", "-y", "@modelcontextprotocol/server-github"],
      false,
      "@modelcontextprotocol/server-github",
      null,
    ],
    [["npx", "tickets-mcp@^1.2.0"], false, "tickets-mcp", null],
    [["npx", "--package=tickets-mcp@1.0.0", "tickets"], true, "tickets-mcp", "1.0.0"],
    [["pnpm", "dlx", "tickets-mcp@1.0.0"], true, "tickets-mcp", "1.0.0"],
    [["uvx", "mcp-server-git==0.6.2"], true, "mcp-server-git", "0.6.2"],
    [["uvx", "--from", "mcp-server-git==0.6.2", "mcp-server-git"], true, "mcp-server-git", "0.6.2"],
    [["uvx", "mcp-server-git"], false, "mcp-server-git", null],
    [
      ["docker", "run", "-i", "--rm", `ghcr.io/acme/mcp@sha256:${hex}`],
      true,
      "ghcr.io/acme/mcp",
      `sha256:${hex}`,
    ],
    [
      ["docker", "run", "-i", "--rm", "-e", "TOKEN", "ghcr.io/acme/mcp:latest"],
      false,
      "ghcr.io/acme/mcp",
      null,
    ],
    [["node", "server.js"], false, null, null],
  ];
  for (const [argv, pinned, pkg, version] of cases) {
    const s = one("claude-mcp-json", { command: argv[0], args: argv.slice(1) }) as Record<
      string,
      unknown
    >;
    assert.deepEqual([s.pinned, s.package, s.version], [pinned, pkg, version], argv.join(" "));
  }
});

test("variable references by dialect and non-secret literals", () => {
  const env = (dialect: string, value: string) => {
    const field = dialect === "opencode-jsonc" ? "environment" : "env";
    const base =
      dialect === "opencode-jsonc"
        ? { type: "local", command: ["node", "x.js"] }
        : { command: "node" };
    return one(dialect, { ...base, [field]: { GITHUB_TOKEN: value } }) as {
      env: Array<{ kind: string }>;
      literal_secret: boolean;
    };
  };
  for (const [dialect, value] of [
    ["claude-mcp-json", "${GITHUB_TOKEN}"],
    ["claude-mcp-json", "${GITHUB_TOKEN:-}"],
    ["cursor-json", "${env:GITHUB_TOKEN}"],
    ["opencode-jsonc", "{env:GITHUB_TOKEN}"],
  ]) {
    const s = env(dialect!, value!);
    assert.equal(s.env[0]!.kind, "reference", `${dialect} ${value}`);
    assert.equal(s.literal_secret, false, `${dialect} ${value}`);
  }
  // Another dialect's syntax is a literal: `${env:X}` is not substituted in Claude Code.
  assert.equal(env("opencode-jsonc", "${GITHUB_TOKEN}").env[0]!.kind, "literal");
  assert.equal(env("claude-mcp-json", "").env[0]!.kind, "empty");
  const plain = one("claude-mcp-json", {
    type: "http",
    url: "https://h.example/mcp",
    headers: { "X-Org": "acme" },
  }) as {
    headers: Array<{ kind: string; secret_like: boolean }>;
    literal_secret: boolean;
  };
  assert.deepEqual(plain.headers, [{ name: "X-Org", kind: "literal", secret_like: false }]);
  assert.equal(plain.literal_secret, false);
});

// fix-mcp-path-secret: a `_FILE`/`_PATH` variable that holds a path names where the secret is, not the
// secret; a non-path value or a key-shaped value under such a name, and a path under a plain secret name, stay secrets.
test("a path to a secret file is not a literal secret", () => {
  const vars = (env: Record<string, string>) =>
    one("claude-mcp-json", { command: "node", args: ["server.js"], env }) as {
      env: Array<{ name: string; kind: string; secret_like: boolean }>;
      literal_secret: boolean;
    };
  const paths = vars({
    SKILLFORGE_TOKEN_FILE: "C:\\Users\\me\\.skillforge\\token",
    GITHUB_TOKEN_PATH: "~/.config/gh/token",
    "X-AUTH-DIR": "./secrets",
  });
  for (const v of paths.env) assert.equal(v.secret_like, false, v.name);
  assert.equal(paths.literal_secret, false);

  for (const [name, value] of [
    ["API_TOKEN_FILE", "abc123"],
    ["SECRET_FILE", "ghp_0123456789abcdef"],
    ["GITHUB_TOKEN", "/home/me/token"],
    ["AUTH_FILE", "a b/c"],
  ]) {
    const s = vars({ [name!]: value! });
    assert.equal(s.env[0]!.secret_like, true, `${name}=${value}`);
    assert.equal(s.literal_secret, true, `${name}=${value}`);
  }
});

test("broken and foreign text does not throw", () => {
  for (const dialect of [
    "claude-mcp-json",
    "claude-user-json",
    "codex-toml",
    "cursor-json",
    "opencode-jsonc",
  ]) {
    for (const text of [
      "",
      "null",
      "[]",
      "{",
      "mcp_servers = 5",
      '{"mcpServers": []}',
      '{"mcp": {"servers": 3}}',
    ]) {
      const r = parseMcpConfig({ dialect: dialect as never, scope: "user" }, text);
      assert.ok(Array.isArray(r.servers) && Array.isArray(r.issues), `${dialect}: ${text}`);
    }
  }
});
