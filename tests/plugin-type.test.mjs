// The `plugin` artifact type — a self-contained Claude Code plugin (`.claude-plugin/plugin.json` + components),
// the type table in the API, distribution, MCP and CLI. Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { startServer, api, login, loadDir, toB64, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const KIT = join(ROOT, "tests", "fixtures", "cc-plugins", "team-kit");
const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const kitFiles = (mutate = (fs) => fs) => toB64(mutate(loadDir(KIT)).map((f) => ({ path: `team-kit/${f.path}`, content: f.content })));
const replaceFile = (path, text) => (fs) => fs.map((f) => (f.path === path ? { path, content: Buffer.from(text) } : f));
const dropFiles = (pred) => (fs) => fs.filter((f) => !pred(f.path));

let srv;
let base;
let admin;

before(async () => {
  srv = await startServer({ SKILLFORGE_MARKETPLACE_NAME: "acme" }, { prefix: "skillforge-cc-plugin-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
});

after(async () => {
  if (srv?.up) await srv.stop();
});

const validate = (files, type) => api(base, "POST", "/api/v1/artifacts/validate", { ...(type ? { type } : {}), files }, { cookie: admin.cookie });
const codes = (r) => (r.data.errors ?? []).map((e) => e.code);

/** Parses tar (ustar) without dependencies: { path: Buffer }. */
function untar(buf) {
  const out = {};
  let pos = 0;
  while (pos + 512 <= buf.length) {
    const header = buf.subarray(pos, pos + 512);
    if (header.every((b) => b === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/s, "");
    const size = parseInt(header.subarray(124, 136).toString("utf8").replace(/\0.*$/s, "").trim() || "0", 8);
    const type = String.fromCharCode(header[156]);
    const full = prefix ? `${prefix}/${name}` : name;
    if (type === "0" || type === "\0") out[full] = buf.subarray(pos + 512, pos + 512 + size);
    pos += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

test("type table in the API: types in order (the seventh is mcp-server), with labels", async () => {
  const r = await api(base, "GET", "/api/v1/artifact-types");
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.items.map((t) => t.id), ["skill", "command", "agent", "hook", "plugin", "settings", "mcp-server"]);
  const plugin = r.data.items.find((t) => t.id === "plugin");
  assert.equal(plugin.label, "Plugin");
  assert.equal(plugin.plural, "Plugins");
  for (const t of r.data.items) assert.ok(t.label && t.plural, JSON.stringify(t));
});

test("a plugin is detected by .claude-plugin/plugin.json and validated as a whole: components, name and description from the manifest", async () => {
  const r = await validate(kitFiles());
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.detected_type, "plugin");
  assert.deepEqual(r.data.errors, [], JSON.stringify(r.data.errors));
  assert.equal(r.data.artifact.name, "team-kit");
  assert.match(r.data.artifact.description, /Release tooling/);
  assert.deepEqual(r.data.artifact.components, [
    { type: "mcp_server", name: "release-db", path: ".mcp.json" },
    { type: "agent", name: "release-reviewer", path: "agents/release-reviewer.md" },
    { type: "command", name: "ship", path: "commands/ship.md" },
    { type: "hook", name: "team-kit", path: "hooks/hooks.json" },
    { type: "skill", name: "changelog-lint", path: "skills/changelog-lint" },
    { type: "skill", name: "release-notes", path: "skills/release-notes" },
  ]);
  const q = r.data.quality;
  assert.ok(q && ["A", "B", "C", "D"].includes(q.grade), "the plugin has a quality report");
  assert.deepEqual(q.components.map((c) => `${c.type}/${c.name}`).sort(), ["agent/release-reviewer", "command/ship", "hook/team-kit", "skill/changelog-lint", "skill/release-notes"]);
  for (const c of q.components) assert.ok(["A", "B", "C", "D"].includes(c.grade));
  assert.equal(q.hook.rows.length, 1, "analysis of the plugin hooks");
  assert.equal(q.hook.rows[0].blocking, "ask");
});

test("component errors come with a path inside the plugin; the manifest, an empty plugin and .mcp.json are checked", async () => {
  const badSkill = await validate(kitFiles(replaceFile("skills/changelog-lint/SKILL.md", "---\nname: changelog-lint\n---\n\n# No description\n")), "plugin");
  assert.equal(badSkill.status, 200);
  assert.ok(badSkill.data.errors.some((e) => e.code === "E_DESCRIPTION_MISSING" && String(e.path).startsWith("skills/changelog-lint/")), JSON.stringify(badSkill.data.errors));

  const noManifest = await validate(kitFiles(dropFiles((p) => p.startsWith(".claude-plugin/"))), "plugin");
  assert.ok(codes(noManifest).includes("E_PLUGIN_MANIFEST_MISSING"), JSON.stringify(noManifest.data.errors));

  const badManifest = await validate(kitFiles(replaceFile(".claude-plugin/plugin.json", '{ "name": "Team Kit!" }')), "plugin");
  assert.ok(codes(badManifest).includes("E_PLUGIN_MANIFEST_INVALID"), JSON.stringify(badManifest.data.errors));

  const empty = await validate(kitFiles(dropFiles((p) => !p.startsWith(".claude-plugin/") && p !== "README.md")), "plugin");
  assert.ok(codes(empty).includes("E_PLUGIN_EMPTY"), JSON.stringify(empty.data.errors));

  const badMcp = await validate(kitFiles(replaceFile(".mcp.json", "{ not json")), "plugin");
  assert.ok(codes(badMcp).includes("E_PLUGIN_MCP_INVALID"), JSON.stringify(badMcp.data.errors));

  const badHook = await validate(kitFiles(replaceFile("hooks/hooks.json", '{ "hooks": { "PreToolUse": "oops" } }')), "plugin");
  assert.ok(badHook.data.errors.some((e) => e.code === "E_HOOK_ENTRY_INVALID"), JSON.stringify(badHook.data.errors));
});

test("publish: plugin files as is, components in the version, list by type", async () => {
  const pub = await api(base, "POST", "/api/v1/artifacts", { files: kitFiles() }, { cookie: admin.cookie });
  assert.equal(pub.status, 201, JSON.stringify(pub.data));
  assert.equal(pub.data.artifact.type, "plugin");
  assert.equal(pub.data.version.version, "1.2.0", "without an explicit version in the request, the publish version comes from the plugin manifest");
  const card = await api(base, "GET", "/api/v1/artifacts/plugin/team-kit");
  assert.equal(card.status, 200);
  const paths = card.data.latest.files.map((f) => f.path).sort();
  assert.ok(paths.includes(".claude-plugin/plugin.json") && paths.includes("skills/release-notes/references/GUIDE.md") && paths.includes("scripts/push-guard.sh"), JSON.stringify(paths));
  assert.equal(card.data.latest.components.length, 6);
  const list = await api(base, "GET", "/api/v1/artifacts?type=plugin");
  assert.deepEqual(list.data.items.map((a) => a.name), ["team-kit"]);
});

test("distribution: marketplace.json and the plugin archive with the original manifest and SkillForge metadata", async () => {
  const t = await api(base, "POST", "/api/v1/artifacts/plugin/team-kit/transitions", { to: "active", reason: "plugin test" }, { cookie: admin.cookie });
  assert.equal(t.status, 200, JSON.stringify(t.data));
  const mp = await api(base, "GET", "/marketplace.json");
  const entry = mp.data.plugins.find((p) => p.name === "team-kit");
  assert.ok(entry, "the plugin is in the marketplace under its own name, without a type suffix");
  assert.equal(entry.category, "plugin");
  // The source in marketplace.json is no longer a link to a tar.gz — the archive is fetched by route.
  const tgz = await fetch(`${base}/api/v1/plugins/plugin/team-kit/${entry.version}.tar.gz`);
  assert.equal(tgz.status, 200);
  const files = untar(gunzipSync(Buffer.from(await tgz.arrayBuffer())));
  const names = Object.keys(files).map((n) => n.replace(/^[^/]+\//, ""));
  for (const p of [".claude-plugin/plugin.json", "skills/release-notes/SKILL.md", "commands/ship.md", "agents/release-reviewer.md", "hooks/hooks.json", "scripts/push-guard.sh", ".mcp.json"]) {
    assert.ok(names.includes(p), `the archive has no ${p}: ${names.join(", ")}`);
  }
  const manifestKey = Object.keys(files).find((n) => n.endsWith(".claude-plugin/plugin.json"));
  const manifest = JSON.parse(files[manifestKey].toString("utf8"));
  assert.equal(manifest.name, "team-kit");
  assert.equal(manifest.author.name, "Platform Team", "the original manifest fields are preserved");
  assert.equal(manifest.version, "1.2.0", "the manifest version matches the publish version");
  assert.equal(entry.version, "1.2.0");
  assert.equal(manifest.metadata.skillforge_type, "plugin");
  const install = await api(base, "GET", "/api/v1/artifacts/plugin/team-kit", undefined, { cookie: admin.cookie });
  assert.equal(install.data.install.plugin_name, "team-kit");
});

test("MCP: the main file of a plugin is the manifest", async () => {
  const tok = await api(base, "POST", "/api/v1/me/tokens", { name: "agent", mcp: true }, { cookie: admin.cookie });
  const r = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${tok.data.token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_artifact", arguments: { type: "plugin", name: "team-kit" } } }),
  });
  const body = await r.json();
  assert.equal(body.result.isError, undefined, JSON.stringify(body));
  assert.equal(body.result.structuredContent.main_file.path, ".claude-plugin/plugin.json");
});

test("CLI: installing a plugin as files is not supported — the /plugin install hint, exit code 1", async () => {
  const work = mkdtempSync(join(tmpdir(), "skillforge-cc-plugin-cli-"));
  try {
    const res = await new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI, "install", "plugin/team-kit", "--url", base, "--into", join(work, ".claude")], {
        cwd: work,
        env: { ...process.env, SKILLFORGE_CONFIG: join(work, "config.json"), NO_COLOR: "1", SKILLFORGE_TOKEN: undefined },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      const timer = setTimeout(() => child.kill(), 20000);
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("exit", (code) => {
        clearTimeout(timer);
        resolve({ code, out, err });
      });
    });
    assert.equal(res.code, 1, `${res.out}\n${res.err}`);
    assert.match(res.err, /\/plugin install team-kit@acme/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
