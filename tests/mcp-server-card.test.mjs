// MCP server card: description without values, verdict of the current policy, usage from the
// inventory (numbers only); link between inventory servers and the registry. Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { startServer, api, login, createUser, loadDir, toB64, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const FIX = join(ROOT, "tests", "fixtures", "mcp-servers");
const files = (name) => toB64(loadDir(join(FIX, name)).map((f) => ({ path: `${name}/${f.path}`, content: f.content })));
const SKILL = "---\nname: card-notes\ndescription: Keeps notes for the MCP card test. Use when the user asks to remember a note.\n---\n\n# Notes\n\nStore notes.\n";

let srv;
let base;
let admin;
const cookies = {};

const obs = (o) => ({
  scope: "user",
  transport: "stdio",
  launcher: "npx",
  package: null,
  pinned: false,
  version: null,
  origin: null,
  env: [],
  headers: [],
  literal_secret: false,
  enabled: true,
  runtime: "claude-code",
  source: "~/.claude.json",
  ...o,
});

async function snapshot(user, servers) {
  const r = await api(
    base,
    "PUT",
    `/api/v1/me/agents/${user}-laptop`,
    {
      runtime: "claude-code",
      files: [{ path: "skills/card-notes/SKILL.md", content_base64: Buffer.from(SKILL).toString("base64") }],
      mcp: { sources: [{ runtime: "claude-code", scope: "user", path: "~/.claude.json", found: true }], servers, issues: [] },
    },
    { cookie: cookies[user] },
  );
  assert.equal(r.status, 200, JSON.stringify(r.data));
}

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-mcp-card-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  for (const u of ["alice", "bob", "carol", "dave"]) {
    await createUser(base, admin.cookie, { username: u, password: `${u}-pw-1`, role: "contributor" });
    cookies[u] = (await login(base, u, `${u}-pw-1`)).cookie;
  }
  const p = await api(base, "PUT", "/api/v1/admin/mcp-policy", { remote_origins: ["https://mcp.sentry.dev"] }, { cookie: admin.cookie });
  assert.equal(p.status, 200);
  for (const name of ["github-tools", "sentry-remote"]) {
    const r = await api(base, "POST", "/api/v1/artifacts", { type: "mcp-server", files: files(name) }, { cookie: cookies.alice });
    assert.equal(r.status, 201, `${name}: ${JSON.stringify(r.data)}`);
  }
  const t = await api(base, "POST", "/api/v1/artifacts/mcp-server/github-tools/transitions", { to: "active", reason: "card test" }, { cookie: admin.cookie });
  assert.equal(t.status, 200, JSON.stringify(t.data));
  const GH = "@modelcontextprotocol/server-github";
  await snapshot("bob", [obs({ name: "github", package: GH, pinned: true, version: "2025.4.8" })]);
  await snapshot("carol", [
    obs({ name: "gh", launcher: "bunx", package: GH }),
    obs({ name: "tickets", package: "tickets-mcp" }),
  ]);
  await snapshot("dave", [obs({ name: "sentry", transport: "http", launcher: null, origin: "https://mcp.sentry.dev" })]);
});

after(async () => {
  if (srv?.up) await srv.stop();
});

test("card: description without values, policy, usage as numbers only", async () => {
  const r = await api(base, "GET", "/api/v1/artifacts/mcp-server/github-tools/mcp");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  // version is the artifact version in the registry (first publication — 0.1.0), the package version is in packages[].version.
  assert.equal(r.data.version, "0.1.0");
  const [pkg] = r.data.packages;
  assert.deepEqual(
    { registryType: pkg.registryType, identifier: pkg.identifier, version: pkg.version, runtimeHint: pkg.runtimeHint, transport: pkg.transport },
    { registryType: "npm", identifier: "@modelcontextprotocol/server-github", version: "2025.4.8", runtimeHint: "npx", transport: "stdio" },
  );
  const token = pkg.env.find((e) => e.name === "GITHUB_PERSONAL_ACCESS_TOKEN");
  assert.deepEqual([token.isSecret, token.isRequired], [true, true]);
  assert.equal(r.data.tools.length, 2);
  assert.deepEqual(r.data.policy, { allowed: true, reasons: [] });
  assert.deepEqual(r.data.usage, { installs: 2, people: 2, same_version: 1 });
  const raw = JSON.stringify(r.data);
  assert.ok(!raw.includes("\"value\"") && !raw.includes("\"default\""), raw);
  assert.ok(!raw.includes("github.com"), "the value of a non-secret variable is not shown");
  for (const u of ["bob", "carol", "dave"]) assert.ok(!raw.includes(u), `name ${u} on the card`);

  const remote = await api(base, "GET", "/api/v1/artifacts/mcp-server/sentry-remote/mcp");
  assert.equal(remote.status, 200);
  assert.equal(remote.data.remotes[0].origin, "https://mcp.sentry.dev");
  assert.deepEqual(remote.data.remotes[0].headers.map((h) => [h.name, h.isSecret]), [["Authorization", true]]);
  assert.deepEqual(remote.data.usage, { installs: 1, people: 1, same_version: 0 });
});

test("the policy changed after publication — the card shows the mismatch", async () => {
  const p = await api(base, "PUT", "/api/v1/admin/mcp-policy", { registry_types: ["pypi"] }, { cookie: admin.cookie });
  assert.equal(p.status, 200);
  const r = await api(base, "GET", "/api/v1/artifacts/mcp-server/github-tools/mcp");
  assert.equal(r.data.policy.allowed, false);
  assert.match(r.data.policy.reasons.join(" "), /registryType/);
  await api(base, "PUT", "/api/v1/admin/mcp-policy", { registry_types: ["npm", "pypi", "oci"] }, { cookie: admin.cookie });
});

test("visibility: a team artifact — an outsider and an anonymous user get 404, also on /mcp", async () => {
  const t = await api(base, "POST", "/api/v1/teams", { name: "mcpteam", lead: "alice" }, { cookie: admin.cookie });
  assert.equal(t.status, 201, JSON.stringify(t.data));
  const teamFiles = loadDir(join(FIX, "acme-image")).map((f) => ({ path: `acme-image/${f.path}`, content: f.content }));
  const pub = await api(base, "POST", "/api/v1/artifacts", { type: "mcp-server", files: toB64(teamFiles), visibility: "team", owner_team: "mcpteam" }, { cookie: cookies.alice });
  assert.equal(pub.status, 201, JSON.stringify(pub.data));
  assert.equal((await api(base, "GET", "/api/v1/artifacts/mcp-server/acme-image/mcp", undefined, { cookie: cookies.alice })).status, 200);
  assert.equal((await api(base, "GET", "/api/v1/artifacts/mcp-server/acme-image/mcp", undefined, { cookie: cookies.bob })).status, 404);
  assert.equal((await api(base, "GET", "/api/v1/artifacts/mcp-server/acme-image/mcp")).status, 404);
});

test("not an MCP server and unknown — 404", async () => {
  assert.equal((await api(base, "GET", "/api/v1/artifacts/skill/card-notes/mcp")).status, 404);
  assert.equal((await api(base, "GET", "/api/v1/artifacts/mcp-server/nope/mcp")).status, 404);
  assert.equal((await api(base, "GET", "/api/v1/artifacts/mcp-server/github-tools/mcp?version=9.9.9")).status, 404);
});

test("inventory: approved, candidate and shadow server", async () => {
  const inv = await api(base, "GET", "/api/v1/admin/inventory", undefined, { cookie: admin.cookie });
  assert.equal(inv.status, 200);
  const by = Object.fromEntries(inv.data.mcp.servers.map((s) => [s.key, s.registry]));
  assert.deepEqual(by["package:npx:@modelcontextprotocol/server-github"], { name: "github-tools", status: "active" });
  assert.deepEqual(by["origin:https://mcp.sentry.dev"], { name: "sentry-remote", status: "candidate" });
  assert.equal(by["package:npx:tickets-mcp"], null);
});
