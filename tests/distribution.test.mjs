// Acceptance tests for the distribution marketplace.
// Requires `npm run build` and the system `tar`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { unzipSync } from "fflate";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { startServer, api as rawApi, login, createUser, loadDir, toB64, FIXTURES, ADMIN_PASSWORD } from "./lib/client.mjs";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
let srv;
let base;
let admin;
let rita;
const api = (method, path, body, auth) => rawApi(base, method, path, body, auth ?? { cookie: admin.cookie });

async function fetchBytes(path, headers = {}) {
  const r = await fetch(`${base}${path}`, { headers });
  return { status: r.status, headers: r.headers, bytes: Buffer.from(await r.arrayBuffer()) };
}

/** Unpacking: tar.gz with the system tar, zip with fflate (a hoisted server dependency). */
function extractTo(archiveBytes, ext) {
  const dir = mkdtempSync(join(tmpdir(), "skillforge-dist-"));
  const out = join(dir, "out");
  mkdirSync(out, { recursive: true });
  if (ext === "zip") {
    const entries = unzipSync(new Uint8Array(archiveBytes));
    for (const [name, bytes] of Object.entries(entries)) {
      if (name.endsWith("/")) continue;
      const target = join(out, ...name.split("/"));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, Buffer.from(bytes));
    }
    return { dir, out };
  }
  // GNU tar on Windows takes "C:\..." for a remote host — run with cwd and relative paths.
  writeFileSync(join(dir, `a.${ext}`), archiveBytes);
  execFileSync("tar", ["-xzf", `a.${ext}`, "-C", "out"], { cwd: dir, stdio: "pipe" });
  return { dir, out };
}

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-dist-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  await createUser(base, admin.cookie, { username: "rita", password: "rita-pw-123", role: "reviewer" });
  rita = await login(base, "rita", "rita-pw-123");
  for (const [type, dir, extra] of [
    ["skill", "skill-standard", {}],
    ["skill", "skill-e2e", {}],
    ["command", "command-propose", {}],
    ["agent", "agent-executor", {}],
    ["hook", "hook-guard", { name: "destructive-guard" }],
  ]) {
    const r = await api("POST", "/api/v1/artifacts", { type, ...extra, files: toB64(loadDir(join(FIXTURES, dir))) });
    assert.equal(r.status, 201, `seed ${type}/${dir}: ${JSON.stringify(r.data)}`);
  }
  for (const [type, name] of [["hook", "destructive-guard"], ["skill", "pdf-tools-e2e"]]) {
    const t = await api("POST", `/api/v1/artifacts/${type}/${name}/transitions`, { to: "active" }, { cookie: rita.cookie });
    assert.equal(t.status, 200, JSON.stringify(t.data));
  }
});

after(async () => {
  if (srv?.up) await srv.stop();
});

test("marketplace.json: format, active only, stable names, absolute URLs, both paths", async () => {
  for (const path of ["/marketplace.json", "/api/v1/marketplace.json"]) {
    const r = await fetchBytes(path);
    assert.equal(r.status, 200, path);
    assert.match(r.headers.get("content-type") ?? "", /^application\/json/);
    const m = JSON.parse(r.bytes.toString("utf8"));
    assert.equal(m.name, "skillforge");
    assert.equal(m.owner.name, "SkillForge");
    assert.ok(m.metadata && typeof m.metadata.version === "string");
    assert.deepEqual(m.plugins.map((p) => p.name).sort(), ["destructive-guard-hook", "pdf-tools-e2e"]);
    for (const p of m.plugins) {
      // Previously `source.type = "url"` + tar.gz — a form Claude Code does not accept.
      // The stand at http://127.0.0.1 → `command` source; the full contract —
      // tests/marketplace-sources.test.mjs.
      assert.equal(p.source.source, "command");
      assert.ok(p.source.command.startsWith(`skillforge plugin-dir ${p.category}/`), p.source.command);
      assert.ok(p.source.command.endsWith(`@${p.version} --url ${base}`), p.source.command);
      assert.equal(p.version, "0.1.0");
      assert.ok(typeof p.description === "string" && p.description.length > 0);
      assert.ok(["skill", "command", "agent", "hook", "plugin"].includes(p.category), `category ${p.category} is not part of the marketplace (settings are excluded)`);
      assert.ok(Array.isArray(p.keywords));
      assert.ok(p.homepage.startsWith(`${base}/artifacts/`));
    }
    const hook = m.plugins.find((p) => p.name === "destructive-guard-hook");
    assert.equal(hook.category, "hook");
    assert.equal(hook.source.command, `skillforge plugin-dir hook/destructive-guard@0.1.0 --url ${base}`);
  }
});

test("marketplace.json: status/type filters, ETag and 304, ETag changes after publication", async () => {
  const all = await fetchBytes("/marketplace.json?status=candidate,active");
  const names = JSON.parse(all.bytes.toString("utf8")).plugins.map((p) => p.name).sort();
  assert.deepEqual(names, ["destructive-guard-hook", "handoff-executor-agent", "pdf-tools", "pdf-tools-e2e", "propose-command"]);
  const skills = await fetchBytes("/marketplace.json?type=skill");
  assert.deepEqual(JSON.parse(skills.bytes.toString("utf8")).plugins.map((p) => p.name), ["pdf-tools-e2e"]);

  const first = await fetchBytes("/marketplace.json");
  const etag = first.headers.get("etag");
  assert.ok(etag, "no ETag");
  const cached = await fetchBytes("/marketplace.json", { "if-none-match": etag });
  assert.equal(cached.status, 304);
  const files = loadDir(join(FIXTURES, "skill-e2e")).map((f) => (f.path.endsWith("SKILL.md") ? { path: f.path, content: Buffer.from(f.content.toString("utf8") + "\nMore.\n") } : f));
  const pub = await api("POST", "/api/v1/artifacts", { type: "skill", version: "0.2.0", files: toB64(files) });
  assert.equal(pub.status, 201, JSON.stringify(pub.data));
  const second = await fetchBytes("/marketplace.json");
  assert.notEqual(second.headers.get("etag"), etag, "ETag did not change after a new version of the active artifact");
  const m = JSON.parse(second.bytes.toString("utf8"));
  assert.equal(m.plugins.find((p) => p.name === "pdf-tools-e2e").version, "0.2.0");
  const stale = await fetchBytes("/marketplace.json", { "if-none-match": etag });
  assert.equal(stale.status, 200);
});

test("plugin tar.gz: headers, structure, plugin.json, determinism, script permissions, latest, 404", async () => {
  const a = await fetchBytes("/api/v1/plugins/skill/pdf-tools-e2e/0.2.0.tar.gz");
  assert.equal(a.status, 200);
  assert.match(a.headers.get("content-type") ?? "", /^application\/gzip/);
  assert.match(a.headers.get("content-disposition") ?? "", /attachment; filename="pdf-tools-e2e-0\.2\.0\.tar\.gz"/);
  assert.match(a.headers.get("cache-control") ?? "", /immutable/);
  assert.ok(a.headers.get("etag"));
  assert.match(a.headers.get("x-skillforge-digest") ?? "", /^[0-9a-f]{64}$/);
  const b = await fetchBytes("/api/v1/plugins/skill/pdf-tools-e2e/0.2.0.tar.gz");
  assert.equal(sha256(a.bytes), sha256(b.bytes), "archive is non-deterministic");
  const latest = await fetchBytes("/api/v1/plugins/skill/pdf-tools-e2e/latest.tar.gz");
  assert.equal(sha256(latest.bytes), sha256(a.bytes), "latest differs from 0.2.0");

  const { dir, out } = extractTo(a.bytes, "tar.gz");
  try {
    const pluginJson = JSON.parse(readFileSync(join(out, ".claude-plugin", "plugin.json"), "utf8"));
    assert.equal(pluginJson.name, "pdf-tools-e2e");
    assert.equal(pluginJson.version, "0.2.0");
    assert.equal(pluginJson.metadata.skillforge_type, "skill");
    assert.equal(pluginJson.metadata.skillforge_name, "pdf-tools-e2e");
    assert.equal(pluginJson.metadata.status, "active");
    assert.match(pluginJson.metadata.digest, /^[0-9a-f]{64}$/);
    assert.equal(pluginJson.author.name, "admin");
    const skill = readFileSync(join(out, "skills", "pdf-tools-e2e", "SKILL.md"), "utf8");
    assert.ok(skill.includes("name: pdf-tools-e2e") && skill.includes("More."));
    assert.ok(existsSync(join(out, "skills", "pdf-tools-e2e", "references", "REFERENCE.md")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const hook = await fetchBytes("/api/v1/plugins/hook/destructive-guard/latest.tar.gz");
  assert.equal(hook.status, 200);
  const listing = (() => {
    const d = mkdtempSync(join(tmpdir(), "skillforge-dist-"));
    writeFileSync(join(d, "h.tar.gz"), hook.bytes);
    const outText = execFileSync("tar", ["-tvzf", "h.tar.gz"], { cwd: d, stdio: "pipe" }).toString();
    rmSync(d, { recursive: true, force: true });
    return outText;
  })();
  const guardLine = listing.split(/\r?\n/).find((l) => l.endsWith("scripts/guard.sh"));
  assert.ok(guardLine, listing);
  assert.match(guardLine, /^-rwxr-xr-x/, `scripts/guard.sh lacks the execute permission: ${guardLine}`);
  const hooksLine = listing.split(/\r?\n/).find((l) => l.endsWith("hooks/hooks.json"));
  assert.match(hooksLine, /^-rw-r--r--/);

  for (const p of ["/api/v1/plugins/skill/nope/latest.tar.gz", "/api/v1/plugins/skill/pdf-tools-e2e/9.9.9.tar.gz", "/api/v1/plugins/widget/pdf-tools-e2e/latest.tar.gz"]) {
    const r = await fetchBytes(p);
    assert.equal(r.status, 404, p);
  }
});

test("bundle.zip: contents and headers", async () => {
  const z = await fetchBytes("/api/v1/artifacts/skill/pdf-tools/versions/0.1.0/bundle.zip");
  assert.equal(z.status, 200);
  assert.match(z.headers.get("content-type") ?? "", /zip/);
  assert.match(z.headers.get("content-disposition") ?? "", /filename="pdf-tools-0\.1\.0\.zip"/);
  assert.ok(z.headers.get("etag"));
  const { dir, out } = extractTo(z.bytes, "zip");
  try {
    assert.ok(existsSync(join(out, "skills", "pdf-tools", "SKILL.md")));
    assert.ok(existsSync(join(out, "skills", "pdf-tools", "references", "REFERENCE.md")));
    assert.ok(!existsSync(join(out, ".claude-plugin")), "bundle.zip must not contain plugin.json");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("download_count: incremented by tar.gz and zip, not by 304; sort=downloads; field in the summary and install info", async () => {
  const before = (await api("GET", "/api/v1/artifacts/skill/pdf-tools-e2e")).data.artifact.download_count;
  assert.equal(typeof before, "number");
  for (let i = 0; i < 3; i++) await fetchBytes("/api/v1/plugins/skill/pdf-tools-e2e/latest.tar.gz");
  await fetchBytes("/api/v1/artifacts/skill/pdf-tools-e2e/versions/latest/bundle.zip");
  const etag = (await fetchBytes("/api/v1/plugins/skill/pdf-tools-e2e/latest.tar.gz")).headers.get("etag");
  const cached = await fetchBytes("/api/v1/plugins/skill/pdf-tools-e2e/latest.tar.gz", { "if-none-match": etag });
  assert.equal(cached.status, 304);
  const card = await api("GET", "/api/v1/artifacts/skill/pdf-tools-e2e");
  assert.equal(card.data.artifact.download_count, before + 5);
  // Required install keys; other features add their own (`cli` for settings, `runtimes`).
  for (const k of ["marketplace_name", "marketplace_url", "plugin_name", "tgz_url", "zip_url"]) assert.ok(k in card.data.install, `no install.${k}`);
  assert.equal(card.data.install.plugin_name, "pdf-tools-e2e");
  assert.equal(card.data.install.marketplace_url, `${base}/marketplace.json`);
  const hookCard = await api("GET", "/api/v1/artifacts/hook/destructive-guard");
  assert.equal(hookCard.data.install.plugin_name, "destructive-guard-hook");
  const list = await api("GET", "/api/v1/artifacts?sort=downloads");
  assert.equal(list.data.items[0].name, "pdf-tools-e2e");
  const info = await api("GET", "/api/v1/install-info");
  // release-dist: no CLI package in this data dir → cli: null.
  const { signing, ...rest } = info.data;
  assert.deepEqual(rest, { marketplace_name: "skillforge", marketplace_url: `${base}/marketplace.json`, cli: null });
  // release-signing: the public key of the registry, never the private one.
  assert.equal(signing.alg, "ed25519");
  assert.ok(!JSON.stringify(info.data).includes("PRIVATE"));
});

test("configuration: marketplace name and owner from env; invalid name → error", async () => {
  const custom = await startServer({ SKILLFORGE_MARKETPLACE_NAME: "acme-skills", SKILLFORGE_MARKETPLACE_OWNER: "ACME Platform Team" }, { prefix: "skillforge-mkt-" });
  assert.ok(custom.up, custom.stderr);
  try {
    const r = await fetch(`${custom.base}/marketplace.json`);
    const m = await r.json();
    assert.equal(m.name, "acme-skills");
    assert.equal(m.owner.name, "ACME Platform Team");
    assert.deepEqual(m.plugins, []);
  } finally {
    await custom.stop();
  }
  const bad = await startServer({ SKILLFORGE_MARKETPLACE_NAME: "My Market" }, { prefix: "skillforge-mktbad-" });
  assert.equal(bad.up, false);
  assert.ok(bad.stderr.includes("SKILLFORGE_MARKETPLACE_NAME"), bad.stderr);
});
