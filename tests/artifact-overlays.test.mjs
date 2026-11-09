// Acceptance tests for overlays: edits on top of an artifact at company -> team -> user level. The CLI installs the signed bundle
// and applies the overlays that concern the person; on update to a new version the overlays are applied again, so edits are not lost.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, toB64, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const A = "/api/v1/artifacts/skill/base-skill";
const MAIN = "skills/base-skill/SKILL.md";
let srv;
const auth = {};
let work;
const call = (method, path, body, who = auth.admin) => api(srv.base, method, path, body, who ? { cookie: who.cookie } : {});
const md = (steps) => `---\nname: base-skill\ndescription: Overlay probe. Use when testing overlays.\n---\n\n# base-skill\n\n${steps}\n`;

async function cliAs(who) {
  const token = (await call("POST", "/api/v1/me/tokens", { name: `ov-${who}` }, auth[who])).data.token;
  const env = { ...process.env, SKILLFORGE_URL: srv.base, SKILLFORGE_TOKEN: token, SKILLFORGE_CONFIG: join(work, `${who}.json`), NO_COLOR: "1" };
  return (...args) => spawnSync(process.execPath, [CLI, ...args], { env, encoding: "utf8", timeout: 60_000 });
}

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-overlays-" });
  assert.ok(srv.up, srv.stderr);
  auth.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [["rita", "reviewer"], ["lena", "contributor"], ["mia", "contributor"], ["oscar", "contributor"]]) {
    await createUser(srv.base, auth.admin.cookie, { username: u, password: `${u}-pw-123456`, role });
    auth[u] = await login(srv.base, u, `${u}-pw-123456`);
  }
  assert.equal((await call("POST", "/api/v1/teams", { name: "alpha", lead: "lena" })).status, 201);
  assert.equal((await call("POST", "/api/v1/teams/alpha/members", { username: "mia" }, auth.lena)).status, 201);
  assert.equal((await call("POST", "/api/v1/artifacts", { type: "skill", version: "1.0.0", files: toB64([{ path: "base-skill/SKILL.md", content: md("Step one.") }]) })).status, 201);
  assert.equal((await call("POST", `${A}/transitions`, { to: "active", reason: "overlay test" }, auth.rita)).status, 200);
  work = mkdtempSync(join(tmpdir(), "skillforge-overlays-work-"));
});

after(async () => {
  await srv?.stop();
});

test("overlays: company is admin, team is the lead, own is the user; other people's overlays and paths outside are not allowed", async () => {
  const company = { ops: [{ op: "append", path: MAIN, text: "\n## Company rules\n\nUse the company VPN.\n" }] };
  assert.equal((await call("PUT", `${A}/overlays/company`, company, auth.mia)).status, 403);
  assert.equal((await call("PUT", `${A}/overlays/company`, company)).status, 200);
  const team = { ops: [{ op: "add", path: "skills/base-skill/team.md", text: "Team alpha notes\n" }] };
  assert.equal((await call("PUT", `${A}/overlays/team/alpha`, team, auth.oscar)).status, 403, "not a lead");
  assert.equal((await call("PUT", `${A}/overlays/team/alpha`, team, auth.lena)).status, 200);
  for (const bad of [
    { ops: [{ op: "append", path: "../etc/passwd", text: "x" }] },
    { ops: [{ op: "append", path: "skills/other-skill/SKILL.md", text: "x" }] },
    { ops: [{ op: "delete", path: MAIN }] },
  ]) {
    assert.equal((await call("PUT", `${A}/overlays/me`, bad, auth.mia)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await call("PUT", `${A}/overlays/me`, { ops: [{ op: "append", path: MAIN, text: "\nMia's note.\n" }] }, auth.mia)).status, 200);
});

test("who sees which overlays: in order company -> team -> own", async () => {
  const mia = (await call("GET", `${A}/overlays`, undefined, auth.mia)).data.layers.map((l) => l.scope);
  assert.deepEqual(mia, ["company", "team:alpha", "user:mia"]);
  const oscar = (await call("GET", `${A}/overlays`, undefined, auth.oscar)).data.layers.map((l) => l.scope);
  assert.deepEqual(oscar, ["company"], "other teams and another user's overlay are not visible");
});

test("CLI: install applies overlays; updating to a new version keeps them; another person gets only their own overlays", async () => {
  const mia = await cliAs("mia");
  const into = join(work, "mia");
  const r = mia("install", "skill/base-skill", "--into", into);
  assert.equal(r.status, 0, r.stderr);
  const file = () => readFileSync(join(into, MAIN), "utf8");
  assert.match(file(), /Step one\./);
  assert.match(file(), /Use the company VPN\./);
  assert.match(file(), /Mia's note\./);
  assert.ok(file().indexOf("company VPN") < file().indexOf("Mia's note"), "overlay order");
  assert.equal(readFileSync(join(into, "skills/base-skill/team.md"), "utf8"), "Team alpha notes\n");

  assert.equal((await call("POST", "/api/v1/artifacts", { type: "skill", version: "1.1.0", files: toB64([{ path: "base-skill/SKILL.md", content: md("Step one.\nStep two.") }]) })).status, 201);
  const s = mia("sync", "--into", into);
  assert.equal(s.status, 0, s.stderr);
  assert.match(file(), /Step two\./, "the update arrived");
  assert.match(file(), /Use the company VPN\./, "the company overlay was kept");
  assert.match(file(), /Mia's note\./, "the own overlay was kept");
  const lock = JSON.parse(readFileSync(join(into, ".skillforge-lock.json"), "utf8"));
  assert.equal(lock.artifacts["skill/base-skill"].version, "1.1.0");

  // A changed layer is applied by sync even when the version did not change.
  assert.equal((await call("PUT", `${A}/overlays/me`, { ops: [{ op: "append", path: MAIN, text: "\nMia's second note.\n" }] }, auth.mia)).status, 200);
  assert.equal(mia("sync", "--into", into).status, 0);
  assert.match(file(), /Mia's second note\./);
  assert.doesNotMatch(file(), /Mia's note\.\n/, "the old own overlay was replaced");

  const oscar = await cliAs("oscar");
  const other = join(work, "oscar");
  assert.equal(oscar("install", "skill/base-skill", "--into", other).status, 0);
  const text = readFileSync(join(other, MAIN), "utf8");
  assert.match(text, /Use the company VPN\./);
  assert.doesNotMatch(text, /Mia's/);
  assert.ok(!existsSync(join(other, "skills/base-skill/team.md")), "another team's overlay is not applied");
});
