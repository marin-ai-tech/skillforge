// Starter pack of nine MIT-licensed CodeAlive-AI skills shipped with the server: attribution, validation, admin install.
// Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, loadDir, toB64, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const PACK_DIR = join(ROOT, "packages", "server", "starter-packs", "codealive");
const EXPECTED = [
  "bug-fix-protocol",
  "code-that-fits-in-your-head",
  "hooks-management",
  "investigating-repository-history",
  "plan-mode",
  "pragmatic-orchestration",
  "prompt-engineering",
  "settings-management",
  "skills-management",
];
const REPOS = ["CodeAlive-AI/ai-driven-development", "CodeAlive-AI/pragmatic-orchestration"];

const readPack = () => JSON.parse(readFileSync(join(PACK_DIR, "pack.json"), "utf8"));
const skillFiles = (entry) => toB64(loadDir(join(PACK_DIR, entry.path)).map((f) => ({ path: `${entry.name}/${f.path}`, content: f.content })));

let srv;
let base;
let admin;
let alice;

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-pack-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  await createUser(base, admin.cookie, { username: "alice", password: "alice-pw-1", role: "contributor" });
  alice = await login(base, "alice", "alice-pw-1");
});

after(async () => {
  if (srv?.up) await srv.stop();
});

test("pack contents, origin, license, attribution; the packs directory in the image", () => {
  assert.ok(existsSync(join(PACK_DIR, "pack.json")), `no ${PACK_DIR}/pack.json`);
  const pack = readPack();
  assert.equal(pack.id, "codealive");
  assert.equal(pack.license, "MIT");
  assert.ok(typeof pack.title === "string" && pack.title.length > 0);
  assert.deepEqual(pack.artifacts.map((a) => a.name).sort(), EXPECTED);
  for (const r of pack.source_repositories) {
    assert.ok(REPOS.includes(r.repo), `unexpected repository ${r.repo}`);
    assert.match(r.commit, /^[0-9a-f]{40}$/);
  }
  const notice = readFileSync(join(PACK_DIR, "NOTICE.md"), "utf8");
  for (const a of pack.artifacts) {
    assert.equal(a.type, "skill");
    assert.ok(REPOS.includes(a.repo), `${a.name}: repository ${a.repo}`);
    assert.match(a.commit, /^[0-9a-f]{40}$/, `${a.name}: commit`);
    assert.ok(typeof a.source_path === "string" && a.source_path.length > 0);
    assert.ok(existsSync(join(PACK_DIR, a.path, "SKILL.md")), `${a.name}: no SKILL.md in ${a.path}`);
    for (const needle of [a.name, a.repo, a.commit]) assert.ok(notice.includes(needle), `NOTICE.md: missing "${needle}"`);
  }
  const license = readFileSync(join(PACK_DIR, "LICENSE"), "utf8");
  assert.ok(license.includes("MIT License"), "LICENSE: no MIT text");
  assert.match(license, /Copyright \(c\)/i);
  assert.ok(readFileSync(join(ROOT, "Dockerfile"), "utf8").includes("packages/server/starter-packs"), "Dockerfile: packs are not copied into the image");
});

test("pack skills contain text only; differences from the source are recorded in NOTICE.md", () => {
  const binary = [];
  for (const entry of readPack().artifacts) {
    for (const f of loadDir(join(PACK_DIR, entry.path))) {
      const bytes = Buffer.from(f.content);
      let text = true;
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        text = false;
      }
      if (!text || bytes.includes(0)) binary.push(`${entry.name}/${f.path}`);
    }
  }
  assert.deepEqual(binary, []);
  const notice = readFileSync(join(PACK_DIR, "NOTICE.md"), "utf8");
  assert.match(notice, /## Local changes/);
  assert.match(notice, /assets\/pragmatic-orchestration-cover\.png/);
  assert.match(notice, /ui\/public\/brand\/porch-mark\.png/);
});

test("every pack skill passes validation and gets a quality report", async () => {
  for (const entry of readPack().artifacts) {
    const r = await api(base, "POST", "/api/v1/artifacts/validate", { type: "skill", files: skillFiles(entry) }, { cookie: admin.cookie });
    assert.equal(r.status, 200, `${entry.name}: ${r.status}`);
    assert.deepEqual(r.data.errors, [], `${entry.name}: ${JSON.stringify(r.data.errors)}`);
    assert.equal(r.data.artifact.name, entry.name);
    assert.ok(["A", "B", "C", "D"].includes(r.data.quality?.grade), `${entry.name}: no quality report`);
  }
});

test("pack list: admin only", async () => {
  const r = await api(base, "GET", "/api/v1/admin/starter-packs", undefined, { cookie: admin.cookie });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const item = r.data.items.find((i) => i.id === "codealive");
  assert.ok(item, JSON.stringify(r.data));
  assert.equal(item.artifacts, 9);
  assert.equal(item.installed, 0);
  assert.equal(item.license, "MIT");
  assert.equal((await api(base, "GET", "/api/v1/admin/starter-packs", undefined, { cookie: alice.cookie })).status, 403);
  assert.equal((await api(base, "GET", "/api/v1/admin/starter-packs")).status, 401);
  assert.equal((await api(base, "POST", "/api/v1/admin/starter-packs/codealive/install", {}, { cookie: alice.cookie })).status, 403);
});

test("install: nine candidates with import provenance; repeat — exists with no new versions", async () => {
  const r = await api(base, "POST", "/api/v1/admin/starter-packs/codealive/install", {}, { cookie: admin.cookie });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.results.map((x) => x.name).sort(), EXPECTED);
  for (const res of r.data.results) {
    assert.equal(res.status, "created", JSON.stringify(res));
    assert.equal(res.type, "skill");
    assert.ok(res.version && res.quality && ["A", "B", "C", "D"].includes(res.quality.grade), JSON.stringify(res));
  }
  const pack = readPack();
  for (const name of EXPECTED) {
    const card = await api(base, "GET", `/api/v1/artifacts/skill/${name}`, undefined, { cookie: admin.cookie });
    assert.equal(card.status, 200);
    assert.equal(card.data.artifact.status, "candidate", "the reviewer gate is not bypassed");
    assert.equal(card.data.latest.provenance.source, "import");
    const entry = pack.artifacts.find((a) => a.name === name);
    assert.equal(card.data.latest.provenance.ref, `${entry.repo}@${entry.commit}:${entry.source_path}`);
  }
  const again = await api(base, "POST", "/api/v1/admin/starter-packs/codealive/install", {}, { cookie: admin.cookie });
  assert.equal(again.status, 200);
  assert.ok(again.data.results.every((x) => x.status === "exists"), JSON.stringify(again.data.results));
  const card = await api(base, "GET", "/api/v1/artifacts/skill/plan-mode", undefined, { cookie: admin.cookie });
  assert.equal(card.data.versions.length, 1, "a repeated install creates no versions");
  const list = await api(base, "GET", "/api/v1/admin/starter-packs", undefined, { cookie: admin.cookie });
  assert.equal(list.data.items.find((i) => i.id === "codealive").installed, 9);
});

test("unknown pack and a path substitution in :id → 404", async () => {
  for (const id of ["nope", "..%2F..%2Fetc", "codealive%2F..%2F.."]) {
    const r = await api(base, "POST", `/api/v1/admin/starter-packs/${id}/install`, {}, { cookie: admin.cookie });
    assert.equal(r.status, 404, `${id}: ${r.status}`);
  }
});

test("a pack with an outward path in pack.json is neither shown nor installed; a broken pack.json does not crash startup", async () => {
  const dir = mkdtempSync(join(tmpdir(), "skillforge-packs-"));
  let s2;
  try {
    mkdirSync(join(dir, "outside", "evil-skill"), { recursive: true });
    writeFileSync(join(dir, "outside", "evil-skill", "SKILL.md"), "---\nname: evil-skill\ndescription: Should never be installed from a pack. Use when testing.\n---\n\nEvil.\n");
    mkdirSync(join(dir, "packs", "evil"), { recursive: true });
    writeFileSync(
      join(dir, "packs", "evil", "pack.json"),
      JSON.stringify({ id: "evil", title: "Evil", description: "x", license: "MIT", source_repositories: [], artifacts: [{ type: "skill", name: "evil-skill", path: "../../outside/evil-skill", repo: "x/y", commit: "0".repeat(40), source_path: "x" }] }),
    );
    mkdirSync(join(dir, "packs", "broken"), { recursive: true });
    writeFileSync(join(dir, "packs", "broken", "pack.json"), "{ not json");
    cpSync(PACK_DIR, join(dir, "packs", "codealive"), { recursive: true });
    s2 = await startServer({ SKILLFORGE_STARTER_PACKS_DIR: join(dir, "packs") }, { prefix: "skillforge-pack-evil-" });
    assert.ok(s2.up, `a broken pack.json must not crash startup: ${s2.stderr}`);
    const a2 = await login(s2.base, "admin", ADMIN_PASSWORD);
    const list = await api(s2.base, "GET", "/api/v1/admin/starter-packs", undefined, { cookie: a2.cookie });
    assert.equal(list.status, 200);
    assert.deepEqual(list.data.items.map((i) => i.id).sort(), ["codealive"]);
    const evil = await api(s2.base, "POST", "/api/v1/admin/starter-packs/evil/install", {}, { cookie: a2.cookie });
    assert.equal(evil.status, 404);
    const card = await api(s2.base, "GET", "/api/v1/artifacts/skill/evil-skill", undefined, { cookie: a2.cookie });
    assert.equal(card.status, 404, "a skill outside the pack directory is not published");
  } finally {
    if (s2?.up) await s2.stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
