import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { parsePluginSpec } from "../src/commands/plugin-dir.ts";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI_DIST = path.join(PKG_ROOT, "dist", "index.js");
const CLI = fs.existsSync(CLI_DIST) ? CLI_DIST : path.join(PKG_ROOT, "src", "index.ts");
const enc = (s: string) => new TextEncoder().encode(s);

const GOOD = zipSync({
  ".claude-plugin/plugin.json": enc('{"name":"demo-skill","version":"0.1.0"}\n'),
  "skills/demo-skill/SKILL.md": enc("---\nname: demo-skill\ndescription: d\n---\n"),
});
const ESCAPE = zipSync({
  ".claude-plugin/plugin.json": enc("{}\n"),
  "../escaped.txt": enc("x"),
});

/** Registry stub: serves the plugin zips by path, counts requests. */
async function stub(): Promise<{ base: string; server: Server; hits: () => number }> {
  let hits = 0;
  const server = createServer((req, res) => {
    hits += 1;
    const routes: Record<string, Uint8Array> = {
      "/api/v1/plugins/skill/demo-skill/0.1.0.zip": GOOD,
      "/api/v1/plugins/skill/evil/0.1.0.zip": ESCAPE,
    };
    const body = routes[req.url ?? ""];
    if (!body) {
      res.writeHead(404, { "content-type": "application/json" }).end('{"error":"not_found"}');
      return;
    }
    res.writeHead(200, { "content-type": "application/zip" }).end(Buffer.from(body));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  assert.ok(addr && typeof addr !== "string");
  return { base: `http://127.0.0.1:${addr.port}`, server, hits: () => hits };
}

function run(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: PKG_ROOT,
      env: { ...process.env, SKILLFORGE_URL: "", SKILLFORGE_TOKEN: "", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const kill = setTimeout(() => child.kill(), 30_000);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("exit", (code) => {
      clearTimeout(kill);
      resolve({ code, stdout, stderr });
    });
  });
}

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skillforge-plugin-dir-"));
  const cache = path.join(root, "cache");
  const env = { SKILLFORGE_CACHE_DIR: cache, SKILLFORGE_CONFIG: path.join(root, "config.json") };
  return { root, cache, env, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("parsePluginSpec: exact version only, settings and unsafe parts rejected", () => {
  assert.deepEqual(parsePluginSpec("skill/pdf-tools@1.2.0"), {
    type: "skill",
    name: "pdf-tools",
    version: "1.2.0",
  });
  assert.deepEqual(parsePluginSpec("plugin/team-kit@1.0.0-beta.1"), {
    type: "plugin",
    name: "team-kit",
    version: "1.0.0-beta.1",
  });
  for (const bad of [
    "skill/pdf-tools",
    "skill/pdf-tools@latest",
    "settings/team-baseline@0.1.0",
    "widget/x@0.1.0",
    "skill/../x@0.1.0",
    "skill/Pdf@0.1.0",
    "skill/x@0.1.0/..",
    "skill/x@1.0.0-a..b",
  ]) {
    assert.throws(() => parsePluginSpec(bad), /expected <type>\/<name>@<version>/, bad);
  }
});

test(
  "plugin-dir: one stdout line, plugin unpacked, second run works without the network",
  { timeout: 60_000 },
  async () => {
    const sb = sandbox();
    const reg = await stub();
    try {
      const first = await run(["plugin-dir", "skill/demo-skill@0.1.0", "--url", reg.base], sb.env);
      assert.equal(first.code, 0, first.stderr);
      const lines = first.stdout.split(/\r?\n/).filter(Boolean);
      assert.equal(lines.length, 1, JSON.stringify(first.stdout));
      const dir = lines[0]!;
      assert.ok(path.isAbsolute(dir) && dir.startsWith(sb.cache), dir);
      assert.ok(fs.existsSync(path.join(dir, ".claude-plugin", "plugin.json")));
      assert.ok(fs.existsSync(path.join(dir, "skills", "demo-skill", "SKILL.md")));
      assert.deepEqual(
        fs.readdirSync(dir).sort(),
        [".claude-plugin", "skills"],
        "readiness marker must not be inside the plugin dir",
      );
      const hitsAfterFirst = reg.hits();
      await new Promise<void>((r) => reg.server.close(() => r()));
      const second = await run(["plugin-dir", "skill/demo-skill@0.1.0", "--url", reg.base], sb.env);
      assert.equal(second.code, 0, second.stderr);
      assert.equal(second.stdout, first.stdout);
      assert.equal(reg.hits(), hitsAfterFirst);
    } finally {
      reg.server.close();
      sb.done();
    }
  },
);

test("plugin-dir: 404 → exit 6, empty stdout, no directory", { timeout: 60_000 }, async () => {
  const sb = sandbox();
  const reg = await stub();
  try {
    const r = await run(["plugin-dir", "skill/nope@0.1.0", "--url", reg.base], sb.env);
    assert.equal(r.code, 6, r.stderr);
    assert.equal(r.stdout, "");
    assert.equal(
      fs.existsSync(path.join(sb.cache)) &&
        fs.readdirSync(sb.cache, { recursive: true }).some((p) => String(p).includes("nope")),
      false,
    );
  } finally {
    reg.server.close();
    sb.done();
  }
});

test(
  "plugin-dir: an archive path escaping the directory is rejected, nothing written",
  { timeout: 60_000 },
  async () => {
    const sb = sandbox();
    const reg = await stub();
    try {
      const r = await run(["plugin-dir", "skill/evil@0.1.0", "--url", reg.base], sb.env);
      assert.notEqual(r.code, 0);
      assert.equal(r.stdout, "");
      const all = fs.existsSync(sb.cache)
        ? fs.readdirSync(sb.cache, { recursive: true }).map(String)
        : [];
      assert.ok(!all.some((p) => p.includes("escaped.txt") || p.endsWith(".ok")), all.join(", "));
      assert.ok(
        !all.some((p) => /[\\/]0\.1\.0$/.test(p) && p.includes("evil")),
        `plugin dir must not appear: ${all.join(", ")}`,
      );
    } finally {
      reg.server.close();
      sb.done();
    }
  },
);
