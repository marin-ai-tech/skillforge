// Acceptance tests for metadata and purge, part B (CLI): metadata set, purge, install/sync behavior for a purged version.
// Requires `npm run build`.
// Exit codes follow the existing CLI contract: 0 success, 1 validation/input (and not_owner), 2 conflict, 3 registry not set, 4 not logged in / no permission, 6 not found.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, FIXTURES, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const V1 = join(FIXTURES, "skill-standard", "pdf-tools");
let srv;
let work;
let v2dir;
const T = {};

const cli = (args, who) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: work,
      env: { ...process.env, SKILLFORGE_CONFIG: join(work, "config.json"), NO_COLOR: "1", SKILLFORGE_URL: srv.base, SKILLFORGE_TOKEN: T[who] },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), 60000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
const card = async () => (await api(srv.base, "GET", "/api/v1/artifacts/skill/pdf-tools", undefined, { token: T.alice })).data.artifact;
const lockOf = (dir) => JSON.parse(readFileSync(join(dir, ".skillforge-lock.json"), "utf8")).artifacts["skill/pdf-tools"];

before(async () => {
  assert.ok(existsSync(CLI), `built CLI not found: ${CLI} — run npm run build`);
  srv = await startServer({}, { prefix: "skillforge-purge-cli-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  const admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  T.admin = (await api(srv.base, "POST", "/api/v1/me/tokens", { name: "cli" }, { cookie: admin.cookie })).data.token;
  for (const u of ["alice", "bob"]) {
    await createUser(srv.base, admin.cookie, { username: u, password: `${u}-pw-123`, role: "contributor" });
    const s = await login(srv.base, u, `${u}-pw-123`);
    T[u] = (await api(srv.base, "POST", "/api/v1/me/tokens", { name: "cli" }, { cookie: s.cookie })).data.token;
  }
  work = mkdtempSync(join(tmpdir(), "skillforge-purge-cli-work-"));
  v2dir = join(work, "v2", "pdf-tools");
  mkdirSync(join(work, "v2"), { recursive: true });
  cpSync(V1, v2dir, { recursive: true });
  appendFileSync(join(v2dir, "SKILL.md"), "\nSecond version.\n");
  let r = await cli(["publish", V1, "--type", "skill", "--version", "0.1.0", "--json"], "alice");
  assert.equal(r.code, 0, r.stdout + r.stderr);
  r = await cli(["publish", v2dir, "--type", "skill", "--version", "0.2.0", "--json"], "alice");
  assert.equal(r.code, 0, r.stdout + r.stderr);
});

after(async () => {
  await srv?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("metadata set: edit without a version, reset, bounds, permissions, codes", async () => {
  const versions = (await api(srv.base, "GET", "/api/v1/artifacts/skill/pdf-tools/versions", undefined, { token: T.alice })).data.items.length;
  let r = await cli(["metadata", "set", "skill/pdf-tools", "--display-name", "PDF Tools", "--description", "Curated description", "--tags", "curated,team-a", "--json"], "alice");
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const a = await card();
  assert.equal(a.display_name, "PDF Tools");
  assert.equal(a.description, "Curated description");
  assert.deepEqual([...a.tags].sort(), ["curated", "team-a"]);
  assert.equal((await api(srv.base, "GET", "/api/v1/artifacts/skill/pdf-tools/versions", undefined, { token: T.alice })).data.items.length, versions, "no versions were added");

  r = await cli(["metadata", "set", "skill/pdf-tools", "--reset", "description", "--json"], "alice");
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.notEqual((await card()).description, "Curated description", "the override was cleared");
  assert.equal((await card()).display_name, "PDF Tools", "other fields untouched");

  assert.equal((await cli(["metadata", "set", "skill/pdf-tools", "--tags", "Bad Tag"], "alice")).code, 1, "invalid tag is an input error");
  assert.equal((await cli(["metadata", "set", "skill/pdf-tools"], "alice")).code, 1, "nothing to change");
  assert.equal((await cli(["metadata", "set", "skill/pdf-tools", "--description", "hack"], "bob")).code, 1, "not the owner: not_owner -> 1");
  assert.equal((await cli(["metadata", "set", "skill/nope", "--description", "x"], "alice")).code, 6);
  assert.notEqual((await card()).description, "hack");
});

test("purge: permissions, required reason and confirmation, result, install/sync of a purged version", async () => {
  // install BEFORE purge: the local copy of the purged version stays on disk
  const D = join(work, "proj", ".claude");
  mkdirSync(D, { recursive: true });
  let r = await cli(["install", "skill/pdf-tools@0.1.0", "--into", D], "alice");
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(lockOf(D).version, "0.1.0");

  const P = ["purge", "skill/pdf-tools@0.1.0", "--reason", "leaked API key in SKILL.md", "--confirm", "skill/pdf-tools@0.1.0", "--json"];
  assert.equal((await cli(P, "alice")).code, 4, "the owner is not admin: no permission");
  assert.equal((await cli(["purge", "skill/pdf-tools@0.1.0", "--reason", "short", "--confirm", "skill/pdf-tools@0.1.0"], "admin")).code, 1, "reason shorter than 10 characters");
  assert.equal((await cli(["purge", "skill/pdf-tools@0.1.0", "--reason", "leaked API key in SKILL.md", "--confirm", "skill/pdf-tools@0.2.0"], "admin")).code, 1, "wrong confirmation");
  assert.equal((await cli(["purge", "skill/pdf-tools@0.1.0", "--reason", "leaked API key in SKILL.md"], "admin")).code, 1, "without --confirm");
  assert.equal((await cli(["purge", "skill/nope@0.1.0", "--reason", "leaked API key in SKILL.md", "--confirm", "skill/nope@0.1.0"], "admin")).code, 6);

  r = await cli(P, "admin");
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.purged, "0.1.0");
  assert.equal(typeof out.blobs_deleted, "number");
  assert.ok(Array.isArray(out.backups_predating));
  const human = await cli(["purge", "skill/pdf-tools@0.1.0", "--reason", "leaked API key in SKILL.md", "--confirm", "skill/pdf-tools@0.1.0"], "admin");
  assert.notEqual(human.code, 0, "purging the same version again is a conflict, not a success");

  // install of a purged version: code 6 and a clear message
  r = await cli(["install", "skill/pdf-tools@0.1.0", "--into", join(work, "proj2", ".claude")], "alice");
  assert.equal(r.code, 6, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /purged/i);
  r = await cli(["install", "skill/pdf-tools", "--into", join(work, "proj3", ".claude")], "alice");
  assert.equal(r.code, 0, "latest (0.2.0) installs");

  // sync: a locally installed purged version gives a warning, then an update to a non-purged one
  r = await cli(["sync", "--into", D, "--json"], "alice");
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stderr + r.stdout, /purged/i, "warning about a purged version in the lock");
  assert.equal(lockOf(D).version, "0.2.0");

  // purge of an artifact from the CLI
  const art = await cli(["purge", "skill/pdf-tools", "--reason", "whole artifact is compromised", "--confirm", "skill/pdf-tools", "--json"], "admin");
  assert.equal(art.code, 0, art.stdout + art.stderr);
  assert.equal((await cli(["info", "skill/pdf-tools"], "alice")).code, 6, "a purged artifact is not visible to a regular user");
  const help = await cli(["--help"], "alice");
  assert.ok(help.stdout.includes("metadata") && help.stdout.includes("purge"), help.stdout);
});
