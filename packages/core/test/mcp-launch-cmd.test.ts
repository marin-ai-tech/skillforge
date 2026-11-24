// fix-mcp-scan-cmd-wrapper (#183): on Windows Claude Code needs `cmd /c` for stdio servers started through npx. The
// launcher, package and version belong to the wrapped command, not to `cmd`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMcpConfig } from "../src/mcp/index.ts";

function observe(command: string, args: string[]) {
  const r = parseMcpConfig(
    { dialect: "claude-mcp-json", scope: "project" },
    JSON.stringify({ mcpServers: { s: { command, args } } }),
  );
  assert.equal(r.servers.length, 1, JSON.stringify(r));
  const s = r.servers[0]!;
  return { launcher: s.launcher, package: s.package, version: s.version, pinned: s.pinned };
}

test("npx behind cmd /c is pinned with its package and version", () => {
  assert.deepEqual(
    observe("cmd", ["/c", "npx", "-y", "@colbymchenry/codegraph@1.6.4", "serve", "--mcp"]),
    { launcher: "npx", package: "@colbymchenry/codegraph", version: "1.6.4", pinned: true },
  );
});

test("cmd.exe with a path and /C, and one quoted argument after /c", () => {
  assert.deepEqual(
    observe("C:\\Windows\\System32\\cmd.exe", ["/C", "uvx", "mcp-server-git==0.6.2"]),
    {
      launcher: "uvx",
      package: "mcp-server-git",
      version: "0.6.2",
      pinned: true,
    },
  );
  assert.deepEqual(observe("cmd", ["/c", "npx -y tickets-mcp@1.0.0"]), {
    launcher: "npx",
    package: "tickets-mcp",
    version: "1.0.0",
    pinned: true,
  });
  assert.deepEqual(observe("CMD", ["/k", "npx", "-y", "tickets-mcp@1.0.0"]), {
    launcher: "npx",
    package: "tickets-mcp",
    version: "1.0.0",
    pinned: true,
  });
});

test("negative: a wrapped program without a package, an unpinned package, no /c", () => {
  assert.deepEqual(observe("cmd", ["/c", "echo", "hi"]), {
    launcher: "echo",
    package: null,
    version: null,
    pinned: false,
  });
  assert.deepEqual(observe("cmd", ["/c", "npx", "-y", "tickets-mcp"]), {
    launcher: "npx",
    package: "tickets-mcp",
    version: null,
    pinned: false,
  });
  assert.deepEqual(observe("cmd", ["/s", "npx", "-y", "tickets-mcp@1.0.0"]), {
    launcher: "cmd",
    package: null,
    version: null,
    pinned: false,
  });
});

test("without a wrapper nothing changes", () => {
  assert.deepEqual(observe("npx", ["-y", "@colbymchenry/codegraph@1.6.4", "serve", "--mcp"]), {
    launcher: "npx",
    package: "@colbymchenry/codegraph",
    version: "1.6.4",
    pinned: true,
  });
});
