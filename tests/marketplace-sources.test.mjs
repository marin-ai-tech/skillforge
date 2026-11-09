// Acceptance tests for marketplace plugin sources in marketplace.json.
// Requires `npm run build`.
// The `source` shape follows the Claude Code 2.1.288 schema: `{ source: "archive", url, sha256 }` | `{ source: "command", command }`.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { startServer, api, login, createUser, loadDir, toB64, FIXTURES, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const KIT = join(ROOT, "tests", "fixtures", "cc-plugins", "team-kit");
const BASELINE = join(ROOT, "tests", "fixtures", "settings", "team-baseline");
const ACTIVE = [
  { type: "skill", name: "pdf-tools", plugin: "pdf-tools", version: "0.1.0" },
  { type: "command", name: "propose", plugin: "propose-command", version: "0.1.0" },
  { type: "agent", name: "handoff-executor", plugin: "handoff-executor-agent", version: "0.1.0" },
  { type: "hook", name: "destructive-guard", plugin: "destructive-guard-hook", version: "0.1.0" },
  { type: "plugin", name: "team-kit", plugin: "team-kit", version: "1.2.0" },
];
const stands = [];

after(async () => {
  for (const s of stands) if (s.up) await s.stop();
});

/** A stand with five active plugins of all types, an active settings profile and the candidate `pdf-tools-e2e`. */
async function seededStand(env) {
  const srv = await startServer(env, { prefix: "skillforge-mkt-src-" });
  stands.push(srv);
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  const admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  await createUser(srv.base, admin.cookie, { username: "rita", password: "rita-pw-123", role: "reviewer" });
  const rita = await login(srv.base, "rita", "rita-pw-123");
  const publish = async (body) => {
    const r = await api(srv.base, "POST", "/api/v1/artifacts", body, { cookie: admin.cookie });
    assert.equal(r.status, 201, `publish ${body.type}: ${JSON.stringify(r.data)}`);
  };
  await publish({ type: "skill", files: toB64(loadDir(join(FIXTURES, "skill-standard"))) });
  await publish({ type: "skill", files: toB64(loadDir(join(FIXTURES, "skill-e2e"))) });
  await publish({ type: "command", files: toB64(loadDir(join(FIXTURES, "command-propose"))) });
  await publish({ type: "agent", files: toB64(loadDir(join(FIXTURES, "agent-executor"))) });
  await publish({ type: "hook", name: "destructive-guard", files: toB64(loadDir(join(FIXTURES, "hook-guard"))) });
  await publish({ type: "plugin", files: toB64(loadDir(KIT).map((f) => ({ path: `team-kit/${f.path}`, content: f.content }))) });
  await publish({ type: "settings", files: toB64(loadDir(BASELINE)) });
  for (const [type, name] of [...ACTIVE.map((a) => [a.type, a.name]), ["settings", "team-baseline"]]) {
    const t = await api(srv.base, "POST", `/api/v1/artifacts/${type}/${name}/transitions`, { to: "active" }, { cookie: rita.cookie });
    assert.equal(t.status, 200, `active ${type}/${name}: ${JSON.stringify(t.data)}`);
  }
  return srv;
}

async function getBytes(base, path) {
  const r = await fetch(`${base}${path}`);
  return { status: r.status, headers: r.headers, bytes: Buffer.from(await r.arrayBuffer()) };
}

async function marketplace(base) {
  const r = await getBytes(base, "/marketplace.json");
  assert.equal(r.status, 200);
  return { raw: r.bytes.toString("utf8"), doc: JSON.parse(r.bytes.toString("utf8")) };
}

/** Shared negative assertions: no old shape, no profile, no candidate. */
function assertNoLegacy(raw, doc) {
  assert.deepEqual(doc.plugins.map((p) => p.name).sort(), ACTIVE.map((a) => a.plugin).sort(), "only the five active plugins are in the storefront");
  assert.ok(!raw.includes(".tar.gz"), "marketplace.json must contain no .tar.gz links");
  for (const p of doc.plugins) {
    assert.equal(typeof p.source, "object", `${p.name}: source is an object`);
    assert.ok(!("type" in p.source), `${p.name}: source must not have a type key (old shape): ${JSON.stringify(p.source)}`);
    assert.notEqual(p.category, "settings");
    assert.notEqual(p.name, "pdf-tools-e2e", "the candidate must not appear in the storefront");
  }
}

function zipEntries(bytes) {
  return Object.keys(unzipSync(new Uint8Array(bytes))).filter((n) => !n.endsWith("/"));
}

test("local stand (http://127.0.0.1): command source, the string fits the client schema", { timeout: 120_000 }, async () => {
  const srv = await seededStand({});
  const { raw, doc } = await marketplace(srv.base);
  assertNoLegacy(raw, doc);
  for (const a of ACTIVE) {
    const p = doc.plugins.find((x) => x.name === a.plugin);
    assert.ok(p, `missing ${a.plugin}`);
    assert.deepEqual(p.source, {
      source: "command",
      command: `skillforge plugin-dir ${a.type}/${a.name}@${a.version} --url ${srv.base}`,
    });
    assert.match(p.source.command, /^[\x20-\x7E]+$/, "printable ASCII");
    assert.ok(!/ {4,}/.test(p.source.command), "no 4 consecutive spaces");
    assert.ok(p.source.command.length <= 500, "at most 500 long");
    assert.equal(p.version, a.version);
  }
});

test("zip route: manifest at the root for all types, determinism, 404", { timeout: 120_000 }, async () => {
  const srv = stands[0]?.up ? stands[0] : await seededStand({});
  for (const a of ACTIVE) {
    const path = `/api/v1/plugins/${a.type}/${a.name}/${a.version}.zip`;
    const first = await getBytes(srv.base, path);
    assert.equal(first.status, 200, `${path}: ${first.status}`);
    assert.match(first.headers.get("content-type") ?? "", /^application\/zip/);
    const second = await getBytes(srv.base, path);
    assert.equal(sha256(second.bytes), sha256(first.bytes), `${path}: downloading again gives different bytes`);
    const names = zipEntries(first.bytes);
    assert.ok(names.includes(".claude-plugin/plugin.json"), `${path}: the manifest is not at the root: ${names.join(", ")}`);
    assert.ok(!names.some((n) => n.startsWith(`${a.plugin}/`)), `${path}: there must be no wrapping directory: ${names.join(", ")}`);
    const manifest = JSON.parse(Buffer.from(unzipSync(new Uint8Array(first.bytes))[".claude-plugin/plugin.json"]).toString("utf8"));
    assert.equal(manifest.name, a.plugin);
    assert.equal(manifest.metadata.skillforge_type, a.type);
  }
  const kit = zipEntries((await getBytes(srv.base, "/api/v1/plugins/plugin/team-kit/1.2.0.zip")).bytes);
  assert.ok(kit.includes("commands/ship.md") && kit.includes("hooks/hooks.json"), `team-kit: ${kit.join(", ")}`);
  const latest = await getBytes(srv.base, "/api/v1/plugins/skill/pdf-tools/latest.zip");
  assert.equal(latest.status, 200);
  for (const path of ["/api/v1/plugins/settings/team-baseline/latest.zip", "/api/v1/plugins/skill/nope/latest.zip", "/api/v1/plugins/skill/pdf-tools/9.9.9.zip"]) {
    assert.equal((await getBytes(srv.base, path)).status, 404, path);
  }
  const tgz = await getBytes(srv.base, "/api/v1/plugins/skill/pdf-tools/0.1.0.tar.gz");
  assert.equal(tgz.status, 200, "the tar.gz route remains");
});

test("https deployment: archive source, sha256 matches the zip bytes", { timeout: 120_000 }, async () => {
  const PUBLIC = "https://skillforge.invalid";
  const srv = await seededStand({ SKILLFORGE_BASE_URL: PUBLIC });
  const { raw, doc } = await marketplace(srv.base);
  assertNoLegacy(raw, doc);
  for (const a of ACTIVE) {
    const p = doc.plugins.find((x) => x.name === a.plugin);
    assert.ok(p, `missing ${a.plugin}`);
    const zipPath = `/api/v1/plugins/${a.type}/${a.name}/${a.version}.zip`;
    assert.deepEqual(Object.keys(p.source).sort(), ["sha256", "source", "url"], JSON.stringify(p.source));
    assert.equal(p.source.source, "archive");
    assert.equal(p.source.url, `${PUBLIC}${zipPath}`);
    const z = await getBytes(srv.base, zipPath);
    assert.equal(z.status, 200);
    assert.equal(p.source.sha256, sha256(z.bytes), `${a.plugin}: sha256 in the marketplace does not match the archive`);
  }
});

test("source mode: explicit command on https; localhost on https gives command", { timeout: 120_000 }, async () => {
  const forced = await seededStand({ SKILLFORGE_BASE_URL: "https://skillforge.invalid", SKILLFORGE_MARKETPLACE_SOURCE: "command" });
  const a = (await marketplace(forced.base)).doc.plugins.find((p) => p.name === "pdf-tools");
  assert.deepEqual(a.source, { source: "command", command: "skillforge plugin-dir skill/pdf-tools@0.1.0 --url https://skillforge.invalid" });
  const loop = await seededStand({ SKILLFORGE_BASE_URL: "https://localhost:8443" });
  const b = (await marketplace(loop.base)).doc.plugins.find((p) => p.name === "pdf-tools");
  assert.equal(b.source.source, "command", "the client does not download archives from loopback, so command is needed");
});

test("source configuration errors: refusal at startup naming the variable", { timeout: 60_000 }, async () => {
  for (const env of [
    { SKILLFORGE_MARKETPLACE_SOURCE: "tarball" },
    { SKILLFORGE_MARKETPLACE_SOURCE: "archive" },
    { SKILLFORGE_MARKETPLACE_SOURCE: "archive", SKILLFORGE_BASE_URL: "https://127.0.0.1:8443" },
    { SKILLFORGE_MARKETPLACE_SOURCE: "command", SKILLFORGE_BASE_URL: "http://sf.example.com/a&b" },
  ]) {
    const srv = await startServer(env, { prefix: "skillforge-mkt-src-bad-" });
    stands.push(srv);
    assert.equal(srv.up, false, `the server must refuse to start: ${JSON.stringify(env)}`);
    assert.match(srv.stderr, /SKILLFORGE_MARKETPLACE_SOURCE/, `${JSON.stringify(env)}: ${srv.stderr}`);
  }
});
