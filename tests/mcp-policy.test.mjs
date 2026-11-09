// MCP policy: allowed package types and remote server addresses; without a list, remote servers are not published.
// Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { startServer, api, login, createUser, loadDir, toB64, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const FIX = join(ROOT, "tests", "fixtures", "mcp-servers");
const files = (name, mutate = (f) => f) =>
  toB64(mutate(loadDir(join(FIX, name))).map((f) => ({ path: `${name}/${f.path}`, content: f.content })));
const withServer = (json) => (fs) => fs.map((f) => (f.path === "server.json" ? { path: f.path, content: Buffer.from(JSON.stringify(json)) } : f));
const POLICY = "/api/v1/admin/mcp-policy";

let srv;
let base;
let admin;
let alice;
let rita;

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-mcp-policy-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  await createUser(base, admin.cookie, { username: "alice", password: "alice-pw-1", role: "contributor" });
  await createUser(base, admin.cookie, { username: "rita", password: "rita-pw-1", role: "reviewer" });
  alice = await login(base, "alice", "alice-pw-1");
  rita = await login(base, "rita", "rita-pw-1");
});

after(async () => {
  if (srv?.up) await srv.stop();
});

const publish = (name, mutate) =>
  api(base, "POST", "/api/v1/artifacts", { type: "mcp-server", files: files(name, mutate) }, { cookie: alice.cookie });
const codes = (r) => (r.data.errors ?? []).map((e) => e.code);

test("permissions and defaults", async () => {
  assert.equal((await api(base, "GET", POLICY)).status, 401);
  assert.equal((await api(base, "GET", POLICY, undefined, { cookie: rita.cookie })).status, 403);
  assert.equal((await api(base, "PUT", POLICY, { remote_origins: [] }, { cookie: rita.cookie })).status, 403);
  const r = await api(base, "GET", POLICY, undefined, { cookie: admin.cookie });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.policy, { registry_types: ["npm", "pypi", "oci"], remote_origins: [] });
});

test("a remote server without a list is not published; the message has no address path", async () => {
  const r = await publish("sentry-remote");
  assert.notEqual(r.status, 201, JSON.stringify(r.data));
  assert.ok(codes(r).includes("E_MCP_POLICY"), JSON.stringify(r.data));
  const msg = JSON.stringify(r.data.errors);
  assert.ok(msg.includes("https://mcp.sentry.dev"), msg);
  assert.ok(!msg.includes("/mcp\""), msg);
  assert.equal((await api(base, "GET", "/api/v1/artifacts/mcp-server/sentry-remote")).status, 404);
  const v = await api(base, "POST", "/api/v1/artifacts/validate", { type: "mcp-server", files: files("sentry-remote") }, { cookie: alice.cookie });
  assert.ok(codes(v).includes("E_MCP_POLICY"), JSON.stringify(v.data));
});

test("policy edit: 400 rejections do not change it; the change is in the audit log", async () => {
  for (const bad of [
    { remote_origins: ["https://mcp.sentry.dev/mcp"] },
    { remote_origins: ["http://mcp.sentry.dev"] },
    { remote_origins: ["https://u:p@mcp.sentry.dev"] },
    { registry_types: ["nuget"] },
    { extra: true },
  ]) {
    const r = await api(base, "PUT", POLICY, bad, { cookie: admin.cookie });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.data.error, "invalid_policy");
  }
  const still = await api(base, "GET", POLICY, undefined, { cookie: admin.cookie });
  assert.deepEqual(still.data.policy.remote_origins, []);

  const ok = await api(base, "PUT", POLICY, { remote_origins: ["https://mcp.sentry.dev", "https://*.acme.example"] }, { cookie: admin.cookie });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.deepEqual(ok.data.policy.remote_origins, ["https://mcp.sentry.dev", "https://*.acme.example"]);
  const audit = await api(base, "GET", "/api/v1/admin/audit?action=mcp_policy_change", undefined, { cookie: admin.cookie });
  assert.equal(audit.status, 200, JSON.stringify(audit.data));
  assert.ok(audit.data.items.length >= 1, JSON.stringify(audit.data));
});

test("address from the list, mask with a host pattern, foreign address", async () => {
  assert.equal((await publish("sentry-remote")).status, 201);
  const tenant = withServer({ remotes: [{ type: "streamable-http", url: "https://{tenant}.acme.example/mcp", variables: { tenant: { isRequired: true } } }] });
  const fileName = (name) => (fs) => fs.map((f) => (f.path === "MCP.md" ? { path: f.path, content: Buffer.from(f.content.toString("utf8").replace("name: sentry-remote", `name: ${name}`)) } : f));
  const asName = (name, mutate) => (fs) => mutate(fileName(name)(fs)).map((f) => f);
  const tenantFiles = toB64(asName("acme-tenant", tenant)(loadDir(join(FIX, "sentry-remote"))).map((f) => ({ path: `acme-tenant/${f.path}`, content: f.content })));
  const t = await api(base, "POST", "/api/v1/artifacts", { type: "mcp-server", files: tenantFiles }, { cookie: alice.cookie });
  assert.equal(t.status, 201, JSON.stringify(t.data));
  const evil = withServer({ remotes: [{ type: "streamable-http", url: "https://evil.example/mcp" }] });
  const evilFiles = toB64(asName("evil-remote", evil)(loadDir(join(FIX, "sentry-remote"))).map((f) => ({ path: `evil-remote/${f.path}`, content: f.content })));
  const e = await api(base, "POST", "/api/v1/artifacts", { type: "mcp-server", files: evilFiles }, { cookie: alice.cookie });
  assert.ok(codes(e).includes("E_MCP_POLICY"), JSON.stringify(e.data));
  // The mask allows subdomains only, not the domain itself.
  const bare = withServer({ remotes: [{ type: "streamable-http", url: "https://acme.example/mcp" }] });
  const bareFiles = toB64(asName("acme-bare", bare)(loadDir(join(FIX, "sentry-remote"))).map((f) => ({ path: `acme-bare/${f.path}`, content: f.content })));
  const b = await api(base, "POST", "/api/v1/artifacts", { type: "mcp-server", files: bareFiles }, { cookie: alice.cookie });
  assert.ok(codes(b).includes("E_MCP_POLICY"), JSON.stringify(b.data));
});

test("package type outside the policy", async () => {
  const r = await api(base, "PUT", POLICY, { registry_types: ["npm"] }, { cookie: admin.cookie });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.policy.registry_types, ["npm"]);
  assert.deepEqual(r.data.policy.remote_origins, ["https://mcp.sentry.dev", "https://*.acme.example"], "a partial edit does not touch the other field");
  const oci = await publish("acme-image");
  assert.ok(codes(oci).includes("E_MCP_POLICY"), JSON.stringify(oci.data));
  assert.equal((await publish("github-tools")).status, 201);
});
