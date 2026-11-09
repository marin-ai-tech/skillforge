// The reviewer sees what
// changed between versions: added, removed and modified files with a line-by-line diff; team visibility applies.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, api, login, createUser, toB64, ADMIN_PASSWORD } from "./lib/client.mjs";

let srv;
const auth = {};
const call = (method, path, body, who = auth.alice) => api(srv.base, method, path, body, who ? { cookie: who.cookie } : {});
const md = (name, body) => `---\nname: ${name}\ndescription: A diff test skill. Use when comparing versions.\n---\n\n# ${name}\n\n${body}\n`;
const publish = (name, version, files, extra = {}) =>
  call("POST", "/api/v1/artifacts", { type: "skill", version, files: toB64(files), ...extra });

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-diff-" });
  assert.ok(srv.up, srv.stderr);
  auth.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [["alice", "contributor"], ["bob", "contributor"]]) {
    await createUser(srv.base, auth.admin.cookie, { username: u, password: `${u}-pw-123456`, role });
    auth[u] = await login(srv.base, u, `${u}-pw-123456`);
  }
  const r1 = await publish("diff-skill", "0.1.0", [
    { path: "diff-skill/SKILL.md", content: md("diff-skill", "Step one.\nStep two.\nStep three.") },
    { path: "diff-skill/references/old.md", content: "# Old\n\nGoes away.\n" },
    { path: "diff-skill/references/same.md", content: "# Same\n\nStays.\n" },
  ]);
  assert.equal(r1.status, 201, JSON.stringify(r1.data));
  const r2 = await publish("diff-skill", "0.2.0", [
    { path: "diff-skill/SKILL.md", content: md("diff-skill", "Step one.\nStep two, revised.\nStep three.") },
    { path: "diff-skill/references/new.md", content: "# New\n\nArrived.\n" },
    { path: "diff-skill/references/same.md", content: "# Same\n\nStays.\n" },
  ]);
  assert.equal(r2.status, 201, JSON.stringify(r2.data));
});

after(async () => {
  await srv?.stop();
});

test("diff of two versions: file statuses and line-level changes", async () => {
  const r = await call("GET", "/api/v1/artifacts/skill/diff-skill/diff?from=0.1.0&to=0.2.0");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.from, "0.1.0");
  assert.equal(r.data.to, "0.2.0");
  const by = Object.fromEntries(r.data.files.map((f) => [f.path, f]));
  assert.equal(by["skills/diff-skill/references/new.md"].status, "added");
  assert.equal(by["skills/diff-skill/references/old.md"].status, "removed");
  assert.equal(by["skills/diff-skill/references/same.md"].status, "unchanged");
  assert.equal(by["skills/diff-skill/references/same.md"].diff, undefined, "an unchanged file has no diff");
  const main = by["skills/diff-skill/SKILL.md"];
  assert.equal(main.status, "modified");
  assert.match(main.diff, /^-Step two\.$/m);
  assert.match(main.diff, /^\+Step two, revised\.$/m);
  assert.match(main.diff, /^ Step one\.$/m, "no context");
  assert.match(main.diff, /^@@ /m);
  assert.deepEqual(r.data.summary, { added: 1, removed: 1, modified: 1, unchanged: 1 });
});

test("by default: the latest version against the previous one", async () => {
  const r = await call("GET", "/api/v1/artifacts/skill/diff-skill/diff");
  assert.equal(r.status, 200);
  assert.equal(r.data.from, "0.1.0");
  assert.equal(r.data.to, "0.2.0");
});

test("errors: unknown version 404, a single version — nothing to compare", async () => {
  assert.equal((await call("GET", "/api/v1/artifacts/skill/diff-skill/diff?from=9.9.9&to=0.2.0")).status, 404);
  await publish("single-skill", "0.1.0", [{ path: "single-skill/SKILL.md", content: md("single-skill", "Only.") }]);
  const r = await call("GET", "/api/v1/artifacts/skill/single-skill/diff");
  assert.equal(r.status, 409);
  assert.equal(r.data.error, "nothing_to_compare");
});

test("visibility of a team: an outsider does not see the diff of a team artifact", async () => {
  const t = await call("POST", "/api/v1/teams", { name: "diffteam", lead: "alice" }, auth.admin);
  assert.equal(t.status, 201, JSON.stringify(t.data));
  const files = (v, text) => [{ path: "team-skill/SKILL.md", content: md("team-skill", text) }];
  assert.equal((await publish("team-skill", "0.1.0", files("0.1.0", "A."), { visibility: "team", owner_team: "diffteam" })).status, 201);
  assert.equal((await publish("team-skill", "0.2.0", files("0.2.0", "B."))).status, 201);
  assert.equal((await call("GET", "/api/v1/artifacts/skill/team-skill/diff")).status, 200);
  assert.equal((await call("GET", "/api/v1/artifacts/skill/team-skill/diff", undefined, auth.bob)).status, 404);
  assert.equal((await call("GET", "/api/v1/artifacts/skill/team-skill/diff", undefined, null)).status, 404);
});
