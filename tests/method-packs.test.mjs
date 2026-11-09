// Acceptance tests for method packs. A "team method" pack is a versioned set of roles, each with artifacts at pinned versions
// (skills, commands, agents, hooks); one CLI command installs a pack or a role and pins the versions in the lock file,
// so sync does not bump them.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, toB64, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const P = "/api/v1/packs";
let srv;
const auth = {};
let work;
const call = (method, path, body, who = auth.lena) => api(srv.base, method, path, body, who ? { cookie: who.cookie } : {});

async function skill(name, version, rev = "", activate = true) {
  const md = `---\nname: ${name}\ndescription: Pack probe ${name}. Use when testing packs.\n---\n\n# ${name}\n\nSteps.${rev}\n`;
  const r = await call("POST", "/api/v1/artifacts", { type: "skill", version, files: toB64([{ path: `${name}/SKILL.md`, content: md }]) });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  if (activate) assert.equal((await call("POST", `/api/v1/artifacts/skill/${name}/transitions`, { to: "active", reason: "pack test" }, auth.rita)).status, 200);
}

const PACK = {
  name: "team-method",
  version: "1.0.0",
  title: "Team method",
  description: "How our team plans, builds and reviews.",
  roles: [
    { name: "developer", description: "Builds features", items: [{ type: "skill", name: "plan-it", version: "0.1.0" }, { type: "skill", name: "build-it", version: "0.1.0" }] },
    { name: "reviewer", description: "Reviews changes", items: [{ type: "skill", name: "review-it", version: "0.1.0" }] },
  ],
};

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-packs-" });
  assert.ok(srv.up, srv.stderr);
  auth.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [["rita", "reviewer"], ["lena", "contributor"], ["oscar", "contributor"]]) {
    await createUser(srv.base, auth.admin.cookie, { username: u, password: `${u}-pw-123456`, role });
    auth[u] = await login(srv.base, u, `${u}-pw-123456`);
  }
  await skill("plan-it", "0.1.0");
  await skill("build-it", "0.1.0");
  await skill("review-it", "0.1.0");
  await skill("draft-it", "0.1.0", "", false);
  work = mkdtempSync(join(tmpdir(), "skillforge-packs-work-"));
});

after(async () => {
  await srv?.stop();
});

test("pack publishing: only existing active versions; versions increase; only the owner publishes a new version", async () => {
  const bad = (patch) => call("POST", P, { ...PACK, ...patch });
  assert.equal((await bad({ name: "Bad Name" })).status, 400);
  assert.equal((await bad({ roles: [] })).status, 400);
  const ghost = await bad({ roles: [{ name: "x", items: [{ type: "skill", name: "no-such", version: "0.1.0" }] }] });
  assert.deepEqual([ghost.status, ghost.data.error], [422, "unknown_item"]);
  const wrongVersion = await bad({ roles: [{ name: "x", items: [{ type: "skill", name: "plan-it", version: "9.9.9" }] }] });
  assert.deepEqual([wrongVersion.status, wrongVersion.data.error], [422, "unknown_item"]);
  const draft = await bad({ roles: [{ name: "x", items: [{ type: "skill", name: "draft-it", version: "0.1.0" }] }] });
  assert.deepEqual([draft.status, draft.data.error], [422, "item_not_active"]);
  const ok = await call("POST", P, PACK);
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal((await call("POST", P, PACK)).status, 409, "the same version");
  assert.equal((await call("POST", P, { ...PACK, version: "0.9.0" })).status, 409, "a version lower than the latest");
  assert.equal((await call("POST", P, { ...PACK, version: "1.1.0" }, auth.oscar)).status, 403, "not the owner");
});

test("pack versions are immutable: a new artifact version does not change the pinned one", async () => {
  await skill("plan-it", "0.2.0", " v2", false); // already active: a new version needs no transition
  const r = await call("GET", `${P}/team-method`, undefined, auth.oscar);
  assert.equal(r.status, 200);
  assert.equal(r.data.pack.latest_version, "1.0.0");
  const dev = r.data.latest.roles.find((x) => x.name === "developer");
  assert.deepEqual(dev.items.find((i) => i.name === "plan-it").version, "0.1.0");
  const list = await call("GET", P, undefined, auth.oscar);
  assert.ok(list.data.items.some((p) => p.name === "team-method" && p.title === "Team method"));
});

test("CLI: a role installs with one command at pinned versions; sync does not bump them; other roles are not installed", async () => {
  {
    const token = (await call("POST", "/api/v1/me/tokens", { name: "packs" }, auth.oscar)).data.token;
    const env = { ...process.env, SKILLFORGE_URL: srv.base, SKILLFORGE_TOKEN: token, SKILLFORGE_CONFIG: join(work, "cli.json"), NO_COLOR: "1" };
    const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { env, encoding: "utf8", timeout: 60_000 });
    const into = join(work, "agent");
    const r = cli("pack", "install", "team-method", "--role", "developer", "--into", into, "--json");
    assert.equal(r.status, 0, r.stderr);
    const res = JSON.parse(r.stdout);
    assert.deepEqual(res.installed.map((i) => `${i.key}@${i.version}`).sort(), ["skill/build-it@0.1.0", "skill/plan-it@0.1.0"]);
    assert.ok(!existsSync(join(into, "skills", "review-it")), "another role is not installed");
    const lock = JSON.parse(readFileSync(join(into, ".skillforge-lock.json"), "utf8"));
    assert.equal(lock.artifacts["skill/plan-it"].pin, "0.1.0");
    const s = cli("sync", "--into", into);
    assert.equal(s.status, 0, s.stderr);
    const after = JSON.parse(readFileSync(join(into, ".skillforge-lock.json"), "utf8"));
    assert.equal(after.artifacts["skill/plan-it"].version, "0.1.0", "sync did not bump the pinned version");
    const all = cli("pack", "install", "team-method@1.0.0", "--into", join(work, "all"), "--json");
    assert.equal(all.status, 0, all.stderr);
    assert.equal(JSON.parse(all.stdout).installed.length, 3, "without --role: all roles");
    const unknownRole = cli("pack", "install", "team-method", "--role", "nobody", "--into", into);
    assert.notEqual(unknownRole.status, 0);
  }
});
