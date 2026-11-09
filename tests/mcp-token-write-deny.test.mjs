// Acceptance tests: an MCP token only reads over REST, tokens are issued only from a login session.
// Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { startServer, api, login, createUser, loadDir, toB64, FIXTURES, ADMIN_PASSWORD } from "./lib/client.mjs";

let srv;
let base;
let admin;
let viewer;

const skillMd = (name) =>
  `---\nname: ${name}\ndescription: Probe skill ${name} for MCP token checks. Use when the user asks for probes.\n---\n\n# ${name}\n\nProbe body.\n`;

async function token(cookie, body) {
  const r = await api(base, "POST", "/api/v1/me/tokens", body, { cookie });
  assert.equal(r.status, 201, `token: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}
async function tokenCount(cookie) {
  const r = await api(base, "GET", "/api/v1/me/tokens", undefined, { cookie });
  assert.equal(r.status, 200);
  return r.data.items.length;
}
async function rpc(tok, method, params) {
  const r = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${tok}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return { status: r.status, json: await r.json() };
}

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-mcpdeny-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  await createUser(base, admin.cookie, { username: "vera", password: "vera-pw-12", role: "viewer" });
  viewer = await login(base, "vera", "vera-pw-12");

  const probe = [{ path: "SKILL.md", content_base64: Buffer.from(skillMd("probe")).toString("base64") }];
  const pub = await api(base, "POST", "/api/v1/artifacts", { type: "skill", files: probe }, { cookie: admin.cookie });
  assert.equal(pub.status, 201, JSON.stringify(pub.data));
  const pdf = await api(base, "POST", "/api/v1/artifacts", { type: "skill", files: toB64(loadDir(join(FIXTURES, "skill-standard"))) }, { cookie: admin.cookie });
  assert.equal(pdf.status, 201, JSON.stringify(pdf.data));
  const t = await api(base, "POST", "/api/v1/artifacts/skill/pdf-tools/transitions", { to: "active", reason: "fixture" }, { cookie: admin.cookie });
  assert.equal(t.status, 200, JSON.stringify(t.data));
});

after(async () => {
  if (srv?.up) await srv.stop();
});

test("a single transition with an admin MCP token gives 403, status and audit unchanged", async () => {
  const mcp = await token(admin.cookie, { name: "agent-admin", mcp: true });
  const auditBefore = await api(base, "GET", "/api/v1/artifacts/skill/probe/audit", undefined, { cookie: admin.cookie });
  const r = await api(base, "POST", "/api/v1/artifacts/skill/probe/transitions", { to: "active", reason: "agent" }, { token: mcp.token });
  assert.equal(r.status, 403, JSON.stringify(r.data));
  assert.equal(r.data.error, "mcp_token_forbidden");
  const card = await api(base, "GET", "/api/v1/artifacts/skill/probe", undefined, { cookie: admin.cookie });
  assert.equal(card.data.artifact.status, "candidate");
  const auditAfter = await api(base, "GET", "/api/v1/artifacts/skill/probe/audit", undefined, { cookie: admin.cookie });
  assert.equal(auditAfter.data.items.length, auditBefore.data.items.length, "extra audit record");
});

test("a token does not issue tokens (MCP admin, MCP viewer, regular); a session does", async () => {
  const mcpAdmin = await token(admin.cookie, { name: "agent-admin-2", mcp: true });
  const mcpViewer = await token(viewer.cookie, { name: "agent-viewer", mcp: true });
  const plain = await token(viewer.cookie, { name: "ci" });
  const adminBefore = await tokenCount(admin.cookie);
  const viewerBefore = await tokenCount(viewer.cookie);
  for (const tok of [mcpAdmin.token, mcpViewer.token, plain.token]) {
    const r = await api(base, "POST", "/api/v1/me/tokens", { name: "more" }, { token: tok });
    assert.equal(r.status, 403, JSON.stringify(r.data));
    assert.ok(["session_required", "mcp_token_forbidden"].includes(r.data.error), r.data.error);
  }
  const plainTry = await api(base, "POST", "/api/v1/me/tokens", { name: "more" }, { token: plain.token });
  assert.equal(plainTry.data.error, "session_required");
  assert.equal(await tokenCount(admin.cookie), adminBefore);
  assert.equal(await tokenCount(viewer.cookie), viewerBefore);
  // A session issues tokens, as before.
  await token(viewer.cookie, { name: "from-session" });
});

test("after an MCP token is revoked there is no access", async () => {
  const mcp = await token(viewer.cookie, { name: "agent-revoked", mcp: true });
  const del = await api(base, "DELETE", `/api/v1/me/tokens/${mcp.id}`, undefined, { cookie: viewer.cookie });
  assert.equal(del.status, 204);
  const read = await api(base, "GET", "/api/v1/me", undefined, { token: mcp.token });
  assert.equal(read.status, 401);
  const write = await api(base, "POST", "/api/v1/me/tokens", { name: "x" }, { token: mcp.token });
  assert.equal(write.status, 401);
});

test("unaffected: REST reads and /mcp with an MCP token, revocation with a regular token", async () => {
  const mcp = await token(viewer.cookie, { name: "agent-reader", mcp: true });
  // REST reads with an MCP token are closed too, except /me and /health.
  const list = await api(base, "GET", "/api/v1/artifacts", undefined, { token: mcp.token });
  assert.equal(list.status, 403);
  const me = await api(base, "GET", "/api/v1/me", undefined, { token: mcp.token });
  assert.equal(me.status, 200);
  const usage = await rpc(mcp.token, "tools/call", { name: "record_usage", arguments: { type: "skill", name: "pdf-tools", uses: 1, helped: 1 } });
  assert.equal(usage.status, 200);
  assert.equal(usage.json.error, undefined, JSON.stringify(usage.json));
  assert.notEqual(usage.json.result?.isError, true, JSON.stringify(usage.json));

  const plain = await token(viewer.cookie, { name: "self-revoke" });
  const del = await api(base, "DELETE", `/api/v1/me/tokens/${plain.id}`, undefined, { token: plain.token });
  assert.equal(del.status, 204);
});
