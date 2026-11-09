// The usage summary is split by source.
// Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, api, login, createUser, ADMIN_PASSWORD } from "./lib/client.mjs";

let srv;
let base;
let admin;
let alice;
let bob;

const skill = (name) => [
  {
    path: "SKILL.md",
    content_base64: Buffer.from(
      `---\nname: ${name}\ndescription: Skill ${name} for usage source checks. Use when the user asks for ${name}.\n---\n\n# ${name}\n\nBody.\n`,
    ).toString("base64"),
  },
];

async function recordMcp(token, args) {
  const r = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "record_usage", arguments: args } }),
  });
  const json = await r.json();
  assert.notEqual(json.result?.isError, true, JSON.stringify(json));
}

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-usagesrc-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  await createUser(base, admin.cookie, { username: "alice", password: "alice-pw-1", role: "contributor" });
  await createUser(base, admin.cookie, { username: "bob", password: "bob-pw-123", role: "viewer" });
  alice = await login(base, "alice", "alice-pw-1");
  bob = await login(base, "bob", "bob-pw-123");
  for (const name of ["sourced", "quiet", "other"]) {
    const p = await api(base, "POST", "/api/v1/artifacts", { type: "skill", files: skill(name) }, { cookie: alice.cookie });
    assert.equal(p.status, 201, JSON.stringify(p.data));
    const t = await api(base, "POST", `/api/v1/artifacts/skill/${name}/transitions`, { to: "active" }, { cookie: admin.cookie });
    assert.equal(t.status, 200, JSON.stringify(t.data));
  }
});

after(async () => {
  if (srv?.up) await srv.stop();
});

test("by_source: api and mcp separately, in descending order of uses; a source of another artifact is not included", async () => {
  const rest = await api(base, "POST", "/api/v1/artifacts/skill/sourced/usage", { uses: 10, helped: 4 }, { cookie: alice.cookie });
  assert.equal(rest.status, 201, JSON.stringify(rest.data));
  const tok = await api(base, "POST", "/api/v1/me/tokens", { name: "agent", mcp: true }, { cookie: bob.cookie });
  assert.equal(tok.status, 201);
  await recordMcp(tok.data.token, { type: "skill", name: "sourced", uses: 3, helped: 3 });
  await recordMcp(tok.data.token, { type: "skill", name: "sourced", uses: 3, helped: 3 });
  const hook = await api(base, "POST", "/api/v1/artifacts/skill/other/usage", { uses: 50, helped: 1, source: "hook" }, { cookie: alice.cookie });
  assert.equal(hook.status, 201);

  const r = await api(base, "GET", "/api/v1/artifacts/skill/sourced/usage");
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.by_source, [
    { source: "api", basis: null, reports: 1, reporters: 1, uses: 10, helped: 4, transfer_rate: 0.4 },
    { source: "mcp", basis: null, reports: 2, reporters: 1, uses: 6, helped: 6, transfer_rate: 1 },
  ]);
  assert.equal(r.data.total.uses, 16);
});

test("artifact without reports: by_source is empty", async () => {
  const r = await api(base, "GET", "/api/v1/artifacts/skill/quiet/usage");
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.by_source, []);
});
