// Acceptance tests for orphaned artifacts. When an owner is disabled, administrators get a notification and the artifact ends up in the "no owner" list with a collaborator hint until it is
// transferred. Retired and deleted artifacts are not listed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, api, login, createUser, toB64, ADMIN_PASSWORD } from "./lib/client.mjs";

let srv;
const auth = {};
const ids = {};
const call = (method, path, body, who = auth.admin) => api(srv.base, method, path, body, who ? { cookie: who.cookie } : {});
const md = (name) => `---\nname: ${name}\ndescription: An orphan test skill. Use when testing owners.\n---\n\n# ${name}\n\nSteps.\n`;
async function publish(name, who) {
  const p = await call("POST", "/api/v1/artifacts", { type: "skill", files: toB64([{ path: `${name}/SKILL.md`, content: md(name) }]) }, who);
  assert.equal(p.status, 201, JSON.stringify(p.data));
}
const orphans = async () => (await call("GET", "/api/v1/admin/orphans")).data.items;

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-orphan-" });
  assert.ok(srv.up, srv.stderr);
  auth.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [["alice", "contributor"], ["bob", "contributor"], ["rita", "reviewer"], ["adam", "admin"]]) {
    const c = await createUser(srv.base, auth.admin.cookie, { username: u, password: `${u}-pw-123456`, role });
    ids[u] = c.user?.id ?? c.id;
    auth[u] = await login(srv.base, u, `${u}-pw-123456`);
  }
  await publish("alice-one", auth.alice);
  await publish("alice-two", auth.alice);
  await publish("alice-old", auth.alice);
  await publish("bob-own", auth.bob);
  assert.equal((await call("POST", "/api/v1/artifacts/skill/alice-one/maintainers", { username: "bob" }, auth.alice)).status, 200);
  assert.equal((await call("POST", "/api/v1/artifacts/skill/alice-old/transitions", { to: "retired", reason: "orphan test" }, auth.rita)).status, 200);
});

after(async () => {
  await srv?.stop();
});

test("while the owner is active the list is empty; only admin can view it", async () => {
  assert.deepEqual(await orphans(), []);
  assert.equal((await call("GET", "/api/v1/admin/orphans", undefined, auth.rita)).status, 403);
});

test("disabling the owner: a notification to administrators and a list with a collaborator hint", async () => {
  assert.ok(ids.alice, "no user id");
  const d = await call("PATCH", `/api/v1/admin/users/${ids.alice}`, { disabled: true });
  assert.equal(d.status, 200, JSON.stringify(d.data));

  const list = await orphans();
  assert.deepEqual(list.map((a) => a.name).sort(), ["alice-one", "alice-two"], "a retired one must not be listed");
  const one = list.find((a) => a.name === "alice-one");
  assert.equal(one.owner, "alice");
  assert.equal(one.owner_state, "disabled");
  assert.equal(one.suggested_owner, "bob");
  assert.equal(list.find((a) => a.name === "alice-two").suggested_owner, null);

  for (const who of ["admin", "adam"]) {
    const n = (await call("GET", "/api/v1/me/notifications?limit=50", undefined, auth[who])).data.items;
    const hit = n.find((x) => x.kind === "ownership");
    assert.ok(hit, `${who}: no notification`);
    assert.match(hit.title, /alice/);
    assert.match(hit.title, /2/);
  }
  const bobs = (await call("GET", "/api/v1/me/notifications?limit=50", undefined, auth.bob)).data.items;
  assert.ok(!bobs.some((x) => x.kind === "ownership"), "a non-admin received a notification");
});

test("after transfer the artifact leaves the list; re-enabling the owner clears the list", async () => {
  const t = await call("POST", "/api/v1/artifacts/skill/alice-one/owner", { owner: "bob", reason: "owner left" });
  assert.equal(t.status, 200, JSON.stringify(t.data));
  assert.deepEqual((await orphans()).map((a) => a.name), ["alice-two"]);
  await call("PATCH", `/api/v1/admin/users/${ids.alice}`, { disabled: false });
  assert.deepEqual(await orphans(), []);
});
