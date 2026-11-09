// Acceptance tests for the organization-wide summary built from the agent snapshots of all people: what is installed on machines, own and third-party (imported)
// artifacts, discrepancies with the registry and copies outside the registry; no paths and no file contents.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, api, login, createUser, toB64, ADMIN_PASSWORD } from "./lib/client.mjs";

const INV = "/api/v1/admin/inventory";
let srv;
const auth = {};
const call = (method, path, body, who = auth.admin) => api(srv.base, method, path, body, who ? { cookie: who.cookie } : {});
const md = (name, rev = "") => `---\nname: ${name}\ndescription: Inventory probe ${name}. Use when testing inventory.\n---\n\n# ${name}\n\nSteps.${rev}\n`;

async function publish(name, version, body, extra = {}) {
  const r = await call("POST", "/api/v1/artifacts", { type: "skill", version, files: toB64([{ path: `${name}/SKILL.md`, content: body }]), ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.data));
}

async function snapshot(who, agent, skills) {
  const files = skills.map(([name, body]) => ({ path: `skills/${name}/SKILL.md`, content: body }));
  const r = await call("PUT", `/api/v1/me/agents/${agent}`, { runtime: "claude-code", files: toB64(files) }, auth[who]);
  assert.equal(r.status, 200, JSON.stringify(r.data));
}

let inv;
before(async () => {
  srv = await startServer({}, { prefix: "skillforge-inventory-" });
  assert.ok(srv.up, srv.stderr);
  auth.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const u of ["alice", "bob"]) {
    await createUser(srv.base, auth.admin.cookie, { username: u, password: `${u}-pw-123456`, role: "contributor" });
    auth[u] = await login(srv.base, u, `${u}-pw-123456`);
  }
  await publish("shared-a", "0.1.0", md("shared-a"));
  await publish("ext-b", "1.0.0", md("ext-b"), { provenance: { source: "import", ref: "https://github.com/acme/skills" } });
  await publish("old-c", "0.1.0", md("old-c"));
  await publish("old-c", "0.2.0", md("old-c", " v2"));
  await snapshot("alice", "laptop", [
    ["shared-a", md("shared-a")],
    ["ext-b", md("ext-b", " local edit")],
    ["old-c", md("old-c")],
    ["rogue-x", md("rogue-x")],
  ]);
  await snapshot("bob", "desk", [
    ["shared-a", md("shared-a")],
    ["rogue-x", md("rogue-x")],
    ["rogue-y", md("rogue-y")],
  ]);
  const r = await call("GET", INV);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  inv = r.data;
});

after(async () => {
  await srv?.stop();
});

const item = (name) => inv.artifacts.find((a) => a.name === name);

test("admin only", async () => {
  assert.equal((await call("GET", INV, undefined, auth.alice)).status, 403);
  assert.equal((await call("GET", INV, undefined, null)).status, 401);
});

test("organization totals", () => {
  assert.equal(inv.totals.agents, 2);
  assert.equal(inv.totals.people, 2);
  assert.equal(inv.totals.copies, 7);
  assert.deepEqual(inv.totals.by_status, { in_sync: 2, outdated: 1, modified: 1, unregistered: 3 });
});

test("own, third-party and outside the registry; discrepancies by copies", () => {
  assert.equal(item("shared-a").origin, "own");
  assert.deepEqual(item("shared-a").statuses, { in_sync: 2 });
  assert.equal(item("ext-b").origin, "imported");
  assert.deepEqual(item("ext-b").statuses, { modified: 1 });
  assert.deepEqual(item("old-c").statuses, { outdated: 1 });
  const x = item("rogue-x");
  assert.equal(x.origin, "unregistered");
  assert.deepEqual([x.copies, x.people, x.variants], [2, 2, 1], "the same copy for two people");
  assert.deepEqual([item("rogue-y").copies, item("rogue-y").people], [1, 1]);
});

test("order: first outside the registry, then modified and outdated; matching ones last", () => {
  const order = inv.artifacts.map((a) => a.name);
  assert.deepEqual(order.slice(0, 2), ["rogue-x", "rogue-y"], "more copies rank higher");
  assert.ok(order.indexOf("ext-b") < order.indexOf("shared-a"));
  assert.ok(order.indexOf("old-c") < order.indexOf("shared-a"));
});

test("people and their agents; no paths or contents", () => {
  const alice = inv.people.find((p) => p.username === "alice");
  assert.deepEqual([alice.agents, alice.copies, alice.unregistered], [1, 4, 1]);
  assert.ok(alice.last_scan, "time of the last snapshot");
  const text = JSON.stringify(inv);
  assert.ok(!text.includes("SKILL.md") && !text.includes("Steps."), "paths and file contents are not exposed");
});
