// Availability of an artifact by team: unavailable, available (default), installed by default, required; with several teams
// the most permissive state wins; sync installs required and default ones, prune and uninstall do not touch required ones.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, toB64, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
let srv;
let work;
const auth = {};
const call = (method, path, body, who = auth.admin) => api(srv.base, method, path, body, who ? { cookie: who.cookie } : {});
const A = (name) => `/api/v1/artifacts/skill/${name}/availability`;
const md = (name) => `---\nname: ${name}\ndescription: An availability test skill. Use when testing teams.\n---\n\n# ${name}\n\nSteps.\n`;
async function activeSkill(name) {
  const p = await call("POST", "/api/v1/artifacts", { type: "skill", files: toB64([{ path: `${name}/SKILL.md`, content: md(name) }]) });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  const t = await call("POST", `/api/v1/artifacts/skill/${name}/transitions`, { to: "active", reason: "availability test" });
  assert.equal(t.status, 200, JSON.stringify(t.data));
}

before(async () => {
  work = mkdtempSync(join(tmpdir(), "skillforge-avail-"));
  srv = await startServer({}, { prefix: "skillforge-avail-srv-" });
  assert.ok(srv.up, srv.stderr);
  auth.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [["lena", "contributor"], ["mia", "contributor"], ["oscar", "contributor"]]) {
    await createUser(srv.base, auth.admin.cookie, { username: u, password: `${u}-pw-123456`, role });
    auth[u] = await login(srv.base, u, `${u}-pw-123456`);
  }
  assert.equal((await call("POST", "/api/v1/teams", { name: "alpha", lead: "lena" })).status, 201);
  assert.equal((await call("POST", "/api/v1/teams", { name: "beta", lead: "oscar" })).status, 201);
  assert.equal((await call("POST", "/api/v1/teams/alpha/members", { username: "mia" }, auth.lena)).status, 201);
  assert.equal((await call("POST", "/api/v1/teams/beta/members", { username: "mia" }, auth.oscar)).status, 201);
  for (const n of ["must-have", "nice-default", "blocked-one", "free-one"]) await activeSkill(n);
});

after(async () => {
  await srv?.stop();
  rmSync(work, { recursive: true, force: true });
});

test("states are set by admin and the leader of the team; values are validated", async () => {
  assert.equal((await call("PUT", A("must-have"), { team: "alpha", state: "required" }, auth.lena)).status, 200);
  assert.equal((await call("PUT", A("must-have"), { team: "beta", state: "required" }, auth.lena)).status, 403, "leader of another team");
  assert.equal((await call("PUT", A("must-have"), { team: "alpha", state: "required" }, auth.mia)).status, 403, "member, not a leader");
  assert.equal((await call("PUT", A("must-have"), { team: "alpha", state: "maybe" })).status, 400);
  assert.equal((await call("PUT", A("must-have"), { team: "nope", state: "required" })).status, 422);
  assert.equal((await call("PUT", A("nice-default"), { team: "alpha", state: "default" })).status, 200);
  assert.equal((await call("PUT", A("blocked-one"), { team: "alpha", state: "unavailable" })).status, 200);
  assert.equal((await call("PUT", A("blocked-one"), { team: "beta", state: "unavailable" }, auth.oscar)).status, 200);

  const r = await call("GET", A("must-have"), undefined, auth.mia);
  assert.deepEqual(r.data.items, [{ team: "alpha", state: "required" }]);
  const audit = await call("GET", "/api/v1/artifacts/skill/must-have/audit");
  assert.ok(audit.data.items.some((e) => e.action === "availability_set"), JSON.stringify(audit.data.items.map((e) => e.action)));
});

test("user assignments: the most permissive state across the user's teams", async () => {
  const mia = (await call("GET", "/api/v1/me/assignments", undefined, auth.mia)).data;
  assert.deepEqual(mia.required.map((a) => a.name), ["must-have"]);
  assert.deepEqual(mia.default.map((a) => a.name), ["nice-default"]);
  assert.deepEqual(mia.unavailable.map((a) => a.name), ["blocked-one"]);

  // One team allows it — so it is available.
  assert.equal((await call("PUT", A("blocked-one"), { team: "beta", state: "available" }, auth.oscar)).status, 200);
  const after = (await call("GET", "/api/v1/me/assignments", undefined, auth.mia)).data;
  assert.deepEqual(after.unavailable, []);
  assert.equal((await call("PUT", A("blocked-one"), { team: "beta", state: "unavailable" }, auth.oscar)).status, 200);

  // Not a member of any team — nothing is assigned.
  const oscarOnlyBeta = (await call("GET", "/api/v1/me/assignments", undefined, auth.oscar)).data;
  assert.deepEqual(oscarOnlyBeta.required, []);
  assert.equal((await call("GET", "/api/v1/me/assignments", undefined, null)).status, 401);
});

test("CLI: sync installs required and default ones; install of an unavailable one refuses; prune and uninstall do not touch required ones", async () => {
  const tok = (await call("POST", "/api/v1/me/tokens", { name: "avail" }, auth.mia)).data.token;
  const env = { ...process.env, SKILLFORGE_URL: srv.base, SKILLFORGE_TOKEN: tok, SKILLFORGE_CONFIG: join(work, "cli.json"), NO_COLOR: "1" };
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { env, encoding: "utf8", timeout: 60_000 });
  const into = join(work, "agent");
  const has = (n) => existsSync(join(into, "skills", n, "SKILL.md"));

  const s = cli("sync", "--into", into, "--tag", "no-such-tag");
  assert.equal(s.status, 0, s.stderr);
  assert.ok(has("must-have"), "the required one is not installed");
  assert.ok(has("nice-default"), "the default one is not installed");
  assert.ok(!has("free-one"), "something extra was installed");

  const blocked = cli("install", "skill/blocked-one", "--into", into);
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /not available for your teams/);

  const pruned = cli("sync", "--into", into, "--tag", "no-such-tag", "--prune");
  assert.equal(pruned.status, 0, pruned.stderr);
  assert.ok(has("must-have"), "prune removed a required one");

  const un = cli("uninstall", "skill/must-have", "--into", into);
  assert.notEqual(un.status, 0);
  assert.match(un.stderr, /required for your team/);
  assert.ok(has("must-have"));
  assert.equal(cli("uninstall", "skill/nice-default", "--into", into).status, 0, "a default one can be removed");
});
