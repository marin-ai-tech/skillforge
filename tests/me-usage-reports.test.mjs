// my-space-usage: «My space» shows the user's own usage reports per artifact — the reports an agent sent with the MCP
// tool record_usage or a person with REST/CLI. Only own reports, only artifacts the user can see now. The oracle is
// what each user sent in this test (counts per artifact and basis), not the server's own summary. Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, api, login, createUser, ADMIN_PASSWORD } from "./lib/client.mjs";

let srv;
let base;
const auth = {};
const skillMd = (name) =>
  `---\nname: ${name}\ndescription: Skill ${name} for the cabinet usage checks. Use when the user asks for ${name}.\n---\n\n# ${name}\n\nBody.\n`;

const call = (method, path, body, who) => api(base, method, path, body, auth[who] ?? {});

async function publish(name, who, extra = {}) {
  const r = await call("POST", "/api/v1/artifacts", { type: "skill", files: [{ path: `${name}/SKILL.md`, content_base64: Buffer.from(skillMd(name)).toString("base64") }], ...extra }, who);
  assert.equal(r.status, 201, `${name}: ${JSON.stringify(r.data)}`);
  const t = await call("POST", `/api/v1/artifacts/skill/${name}/transitions`, { to: "active", reason: "usage test" }, "admin");
  assert.equal(t.status, 200, `${name}: ${JSON.stringify(t.data)}`);
}

async function mcpRecord(token, args) {
  const r = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "record_usage", arguments: args } }),
  });
  const body = await r.json();
  assert.ok(!body.error && !body.result?.isError, JSON.stringify(body));
}

const report = (who, name, uses, helped, extra = {}) =>
  call("POST", `/api/v1/artifacts/skill/${name}/usage`, { uses, helped, ...extra }, who).then((r) => {
    assert.ok(r.status === 200 || r.status === 201, `${who} ${name}: ${r.status} ${JSON.stringify(r.data)}`);
  });

async function usageOf(who) {
  const r = await call("GET", "/api/v1/me/overview", undefined, who);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.usage_reports, `no usage_reports in ${Object.keys(r.data)}`);
  return r.data.usage_reports;
}

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-me-usage-" });
  assert.ok(srv.up, srv.stderr);
  base = srv.base;
  auth.admin = { cookie: (await login(base, "admin", ADMIN_PASSWORD)).cookie };
  for (const [u, role] of [["alice", "contributor"], ["station", "viewer"], ["carol", "contributor"], ["dave", "contributor"], ["erin", "viewer"]]) {
    await createUser(base, auth.admin.cookie, { username: u, password: `${u}-pw-123`, role });
    auth[u] = { cookie: (await login(base, u, `${u}-pw-123`)).cookie };
  }
  await publish("notes", "alice");
  await publish("guide", "alice");
  assert.equal((await call("POST", "/api/v1/teams", { name: "alpha", lead: "alice" }, "admin")).status, 201);
  assert.equal((await call("POST", "/api/v1/teams/alpha/members", { username: "carol" }, "alice")).status, 201);
  await publish("team-recipe", "alice", { visibility: "team", owner_team: "alpha" });
});

after(async () => {
  if (srv?.up) await srv.stop();
});

test("a viewer's agent reports through MCP: per artifact, basis counts, newest first; another person's report is not there", async () => {
  const tok = await call("POST", "/api/v1/me/tokens", { name: "station-agent", mcp: true }, "station");
  assert.equal(tok.status, 201, JSON.stringify(tok.data));
  await mcpRecord(tok.data.token, { type: "skill", name: "notes", uses: 2, helped: 2, basis: "loaded" });
  await mcpRecord(tok.data.token, { type: "skill", name: "notes", uses: 1, helped: 0, basis: "loaded" });
  await new Promise((r) => setTimeout(r, 20));
  await mcpRecord(tok.data.token, { type: "skill", name: "guide", uses: 3, helped: 3, basis: "assigned" });
  await report("alice", "notes", 50, 1);

  const u = await usageOf("station");
  assert.equal(u.reports, 3);
  assert.equal(u.artifacts, 2);
  assert.equal(u.more, false);
  assert.deepEqual(u.items.map((i) => `${i.type}/${i.name}`), ["skill/guide", "skill/notes"]);
  const [guide, notes] = u.items;
  assert.equal(guide.reports, 1);
  assert.deepEqual(guide.basis, { loaded: 0, assigned: 1, unspecified: 0 });
  assert.equal(notes.reports, 2);
  assert.equal(notes.uses, 3);
  assert.equal(notes.helped, 2);
  assert.equal(notes.not_helped, 1);
  assert.deepEqual(notes.basis, { loaded: 2, assigned: 0, unspecified: 0 });
  assert.equal(notes.last_version, "0.1.0");
  assert.ok(Date.parse(notes.last_reported_at) <= Date.parse(guide.last_reported_at));
  assert.ok(!JSON.stringify(u).includes("station-agent"), "the token name leaked into the cabinet");
  assert.ok(u.items.every((i) => i.uses < 50), "alice's report is counted for station");

  const a = await usageOf("alice");
  assert.equal(a.reports, 1);
  assert.deepEqual(a.items.map((i) => i.name), ["notes"]);
  assert.equal(a.items[0].uses, 50);
  assert.deepEqual(a.items[0].basis, { loaded: 0, assigned: 0, unspecified: 1 });
});

test("an artifact the user can no longer see leaves the list and the totals", async () => {
  await report("carol", "team-recipe", 4, 3);
  await report("carol", "notes", 1, 1);
  let u = await usageOf("carol");
  assert.deepEqual(u.items.map((i) => i.name).sort(), ["notes", "team-recipe"]);
  assert.equal(u.reports, 2);

  assert.equal((await call("DELETE", "/api/v1/teams/alpha/members/carol", undefined, "alice")).status, 200);
  u = await usageOf("carol");
  assert.deepEqual(u.items.map((i) => i.name), ["notes"]);
  assert.equal(u.reports, 1);
  assert.equal(u.artifacts, 1);
  assert.ok(!JSON.stringify(u).includes("team-recipe"));
});

test("more than 20 artifacts: 20 rows, the totals count all, more = true", async () => {
  for (let i = 0; i < 21; i++) {
    const name = `bulk-${String(i).padStart(2, "0")}`;
    await publish(name, "dave");
    await report("dave", name, 1, 1);
  }
  const u = await usageOf("dave");
  assert.equal(u.items.length, 20);
  assert.equal(u.artifacts, 21);
  assert.equal(u.reports, 21);
  assert.equal(u.more, true);
  assert.equal(u.items[0].name, "bulk-20", "not sorted by the last report");
});

test("a user without reports gets an empty section, not an error", async () => {
  const u = await usageOf("erin");
  assert.deepEqual(u, { reports: 0, artifacts: 0, items: [], more: false });
});
