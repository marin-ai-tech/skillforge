// mcp-version-tracking: the registry notices (1) a new release of an MCP server's package at npm or pypi and (2) agent
// snapshots with a pinned version other than the registry's. Both show on the MCP server card and in the MCP summary,
// and the artifact's audience gets one `mcp_version` notification per new version, never naming who sent a snapshot.
// The package registries are a local stub (SKILLFORGE_NPM_REGISTRY_URL / SKILLFORGE_PYPI_URL); it records every
// request, so the test sees which requests went out and which did not. Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, api, login, createUser, ADMIN_PASSWORD } from "./lib/client.mjs";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const NOTE_SKILL = "---\nname: notes\ndescription: Keeps notes for the snapshot. Use when the user asks to remember a note.\n---\n\n# Notes\n";

/** A package-registry stub: answers by decoded path; `set(path, answer)`; every request recorded. */
function packageRegistry() {
  const answers = new Map();
  const seen = [];
  const server = http.createServer((req, res) => {
    const path = decodeURIComponent(req.url ?? "");
    seen.push({ path, headers: req.headers });
    const a = answers.get(path);
    if (!a) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end('{"error":"not found"}');
    }
    if (a.redirect) {
      res.writeHead(302, { location: a.redirect });
      return res.end();
    }
    res.writeHead(a.status ?? 200, { "content-type": "application/json" });
    if (a.bytes) {
      const chunk = Buffer.alloc(1024 * 1024, 0x20);
      for (let i = 0; i < a.bytes; i++) res.write(chunk);
      return res.end();
    }
    res.end(typeof a.body === "string" ? a.body : JSON.stringify(a.body));
  });
  return { server, seen, set: (p, a) => answers.set(p, a), clear: () => (seen.length = 0) };
}

const NPM_PATH = "/@colbymchenry/codegraph/latest";
const PYPI_PATH = "/pypi/mcp-foo-bar/json";

const md = (name) =>
  `---\nname: ${name}\ndescription: MCP server ${name} for the version tracking test. Use when an agent needs ${name}.\ntags: [mcp]\n---\n\n# ${name}\n\nRuns at a pinned version.\n`;
const files = (name, serverJson) =>
  [
    { path: `${name}/MCP.md`, content: md(name) },
    { path: `${name}/server.json`, content: JSON.stringify(serverJson) },
  ].map((f) => ({ path: f.path, content_base64: Buffer.from(f.content).toString("base64") }));
const npmServer = { packages: [{ registryType: "npm", identifier: "@colbymchenry/codegraph", version: "1.6.4", runtimeHint: "npx", transport: { type: "stdio" } }] };
const pypiServer = { packages: [{ registryType: "pypi", identifier: "Mcp_Foo.Bar", version: "1.0.0", runtimeHint: "uvx", transport: { type: "stdio" } }] };
const ociServer = { packages: [{ registryType: "oci", identifier: `ghcr.io/acme/tool@sha256:${DIGEST_A}`, runtimeHint: "docker", transport: { type: "stdio" } }] };
const remoteServer = { remotes: [{ type: "streamable-http", url: "https://mcp.remote.example/mcp" }] };

let reg;
let elsewhere;
let srv;
let base;
const cookie = {};
const PEOPLE = ["alice", "carol", "bob", "erin", "dave"];

async function call(method, path, body, who) {
  return api(base, method, path, body, who ? { cookie: cookie[who] } : {});
}
const releaseCheck = (name, who = "alice") => call("POST", `/api/v1/artifacts/mcp-server/${name}/mcp/release-check`, {}, who);
const card = async (name) => (await call("GET", `/api/v1/artifacts/mcp-server/${name}/mcp`, undefined, "alice")).data;
const mcpNotes = async (who) =>
  ((await call("GET", "/api/v1/me/notifications?limit=100", undefined, who)).data.items ?? []).filter((n) => n.kind === "mcp_version");

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
async function snapshot(who, servers) {
  const r = await call(
    "PUT",
    `/api/v1/me/agents/${who}-workstation`,
    {
      runtime: "claude-code",
      files: [{ path: "skills/notes/SKILL.md", content_base64: Buffer.from(NOTE_SKILL).toString("base64") }],
      mcp: { sources: [{ runtime: "claude-code", scope: "user", path: "~/.claude.json", found: true }], servers, issues: [] },
    },
    who,
  );
  assert.equal(r.status, 200, JSON.stringify(r.data));
}

before(async () => {
  reg = packageRegistry();
  elsewhere = packageRegistry();
  await new Promise((r) => reg.server.listen(0, "127.0.0.1", r));
  await new Promise((r) => elsewhere.server.listen(0, "127.0.0.1", r));
  reg.url = `http://127.0.0.1:${reg.server.address().port}`;
  elsewhere.url = `http://127.0.0.1:${elsewhere.server.address().port}`;
  srv = await startServer(
    { SKILLFORGE_NPM_REGISTRY_URL: reg.url, SKILLFORGE_PYPI_URL: reg.url, SKILLFORGE_MIRROR_INTERVAL_HOURS: "0" },
    { prefix: "skillforge-mcp-version-" },
  );
  assert.ok(srv.up, srv.stderr);
  base = srv.base;
  cookie.admin = (await login(base, "admin", ADMIN_PASSWORD)).cookie;
  for (const u of PEOPLE) {
    await createUser(base, cookie.admin, { username: u, password: `${u}-pw-123`, role: u === "bob" ? "viewer" : "contributor" });
    cookie[u] = (await login(base, u, `${u}-pw-123`)).cookie;
  }
  assert.equal((await call("PUT", "/api/v1/admin/mcp-policy", { remote_origins: ["https://mcp.remote.example"] }, "admin")).status, 200);
  for (const [name, sj] of [["codegraph", npmServer], ["foo-bar", pypiServer], ["tool-image", ociServer], ["remote-only", remoteServer]]) {
    const r = await call("POST", "/api/v1/artifacts", { type: "mcp-server", files: files(name, sj) }, "alice");
    assert.equal(r.status, 201, `${name}: ${JSON.stringify(r.data)}`);
  }
  assert.equal((await call("PUT", "/api/v1/artifacts/mcp-server/codegraph/watch", { watching: true }, "carol")).status, 200);
});

after(async () => {
  if (srv?.up) await srv.stop();
  await new Promise((r) => reg?.server.close(r));
  await new Promise((r) => elsewhere?.server.close(r));
});

test("a new npm release: update_available on the card, the artifact's versions unchanged, one request without credentials", async () => {
  reg.clear();
  reg.set(NPM_PATH, { body: { name: "@colbymchenry/codegraph", version: "1.7.0" } });
  const r = await releaseCheck("codegraph");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.release.registry_type, "npm");
  assert.equal(r.data.release.identifier, "@colbymchenry/codegraph");
  assert.equal(r.data.release.registry_version, "1.6.4");
  assert.equal(r.data.release.upstream_version, "1.7.0");
  assert.equal(r.data.release.state, "update_available");
  assert.ok(r.data.release.checked_at);
  assert.deepEqual((await card("codegraph")).release, r.data.release);
  const detail = (await call("GET", "/api/v1/artifacts/mcp-server/codegraph", undefined, "alice")).data;
  assert.equal(detail.versions.length, 1, `the check created a version: ${JSON.stringify(detail.versions)}`);
  assert.equal(reg.seen.length, 1);
  assert.equal(reg.seen[0].path, NPM_PATH);
  assert.equal(reg.seen[0].headers.authorization, undefined);
  assert.equal(reg.seen[0].headers.cookie, undefined);
});

test("release notifications: one per new upstream version, for owner and watcher, not for others", async () => {
  // the release above already gave 1.7.0; checking again with the same answer adds nothing
  reg.set(NPM_PATH, { body: { version: "1.7.0" } });
  assert.equal((await releaseCheck("codegraph")).status, 200);
  assert.equal((await releaseCheck("codegraph")).status, 200);
  reg.set(NPM_PATH, { body: { version: "1.8.0" } });
  assert.equal((await releaseCheck("codegraph")).data.release.upstream_version, "1.8.0");
  for (const who of ["alice", "carol"]) {
    const notes = await mcpNotes(who);
    assert.equal(notes.length, 2, `${who}: ${JSON.stringify(notes)}`);
    assert.ok(notes.some((n) => n.title.includes("1.7.0")) && notes.some((n) => n.title.includes("1.8.0")), JSON.stringify(notes));
    assert.ok(notes.every((n) => n.url.includes("codegraph")), JSON.stringify(notes));
  }
  assert.deepEqual(await mcpNotes("bob"), []);
  assert.deepEqual(await mcpNotes("dave"), []);
});

test("the source is not newer: equal, older and a pre-release stay up_to_date", async () => {
  const before = (await mcpNotes("alice")).length;
  for (const v of ["1.6.4", "1.6.3", "1.9.0-beta.1"]) {
    reg.set(NPM_PATH, { body: { version: v } });
    const r = await releaseCheck("codegraph");
    assert.equal(r.status, 200);
    assert.equal(r.data.release.state, "up_to_date", `${v}: ${JSON.stringify(r.data.release)}`);
  }
  assert.equal((await mcpNotes("alice")).length, before, "a version that is not newer notified");
});

test("source failures are states with a short reason; no request follows a redirect; the server keeps answering", async () => {
  const cases = [
    [{ status: 404, body: { error: "nope" } }, "not_found", null],
    [{ status: 503, body: "busy" }, "failed", "http_503"],
    [{ bytes: 9 }, "failed", "response_too_large"],
    [{ redirect: `${elsewhere.url}${NPM_PATH}` }, "failed", "redirect"],
    [{ body: "not json {" }, "failed", "bad_response"],
    [{ body: { version: "1.7.0; rm -rf /" } }, "failed", "bad_response"],
  ];
  const notes = (await mcpNotes("alice")).length;
  for (const [answer, state, detail] of cases) {
    reg.set(NPM_PATH, answer);
    const r = await releaseCheck("codegraph");
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.release.state, state, JSON.stringify(answer).slice(0, 80));
    if (detail) assert.equal(r.data.release.state_detail, detail);
    assert.ok(!JSON.stringify(r.data).includes("rm -rf"), "the response body leaked into the release");
  }
  assert.deepEqual(elsewhere.seen, [], "the server followed a redirect to another host");
  assert.equal((await mcpNotes("alice")).length, notes, "a failed check notified");
  assert.equal((await call("GET", "/api/v1/artifacts/mcp-server/codegraph/mcp", undefined, "alice")).status, 200);
});

test("pypi: the request uses the PEP 503 name; OCI is unsupported without a request; remote-only has no release", async () => {
  reg.clear();
  reg.set(PYPI_PATH, { body: { info: { version: "1.1.0" } } });
  const py = await releaseCheck("foo-bar");
  assert.equal(py.status, 200, JSON.stringify(py.data));
  assert.equal(py.data.release.state, "update_available");
  assert.equal(py.data.release.upstream_version, "1.1.0");
  assert.deepEqual(reg.seen.map((s) => s.path), [PYPI_PATH]);

  reg.clear();
  const oci = await releaseCheck("tool-image");
  assert.equal(oci.status, 200);
  assert.equal(oci.data.release.state, "unsupported");
  const remote = await releaseCheck("remote-only");
  assert.equal(remote.status, 200);
  assert.equal(remote.data.release, null);
  assert.deepEqual(reg.seen, [], "unsupported or remote-only artifacts sent a request");
});

test("rights: a viewer gets 403, an unknown artifact and another type 404, without any request", async () => {
  reg.clear();
  assert.equal((await releaseCheck("codegraph", "bob")).status, 403);
  assert.equal((await releaseCheck("codegraph", "dave")).status, 403);
  assert.equal((await releaseCheck("ghost")).status, 404);
  assert.equal((await call("POST", "/api/v1/artifacts/skill/codegraph/mcp/release-check", {}, "alice")).status, 404);
  assert.equal((await releaseCheck("codegraph", "admin")).status, 200);
  assert.deepEqual(reg.seen.map((s) => s.path), [NPM_PATH], "only the admin's check went out");
});

test("drift: summary and card show other pinned versions; unpinned is not drift; OCI and pypi names are matched", async () => {
  await snapshot("erin", [
    obs({ name: "codegraph", package: "@colbymchenry/codegraph", pinned: true, version: "1.6.4" }),
    obs({ name: "foo", launcher: "uvx", package: "mcp-foo-bar", pinned: true, version: "1.0.0" }),
  ]);
  await snapshot("bob", [
    obs({ name: "codegraph", package: "@colbymchenry/codegraph", pinned: true, version: "1.6.3" }),
    obs({ name: "tool", launcher: "docker", package: "ghcr.io/acme/tool", pinned: true, version: `sha256:${DIGEST_B}` }),
  ]);
  await snapshot("dave", [obs({ name: "codegraph", package: "@colbymchenry/codegraph" })]);

  const inv = await call("GET", "/api/v1/admin/inventory", undefined, "admin");
  assert.equal(inv.status, 200);
  const cg = inv.data.mcp.servers.find((s) => s.key === "package:npx:@colbymchenry/codegraph");
  assert.ok(cg, JSON.stringify(inv.data.mcp.servers.map((s) => s.key)));
  assert.deepEqual(cg.registry, { name: "codegraph", status: "candidate", version: "1.6.4" });
  assert.equal(cg.drift_installs, 1);
  assert.equal(cg.unpinned_installs, 1);
  assert.ok(inv.data.mcp.totals.drift_installs >= 2, JSON.stringify(inv.data.mcp.totals));

  const c = await card("codegraph");
  assert.equal(c.usage.installs, 3);
  assert.equal(c.usage.same_version, 1);
  assert.deepEqual(c.usage.other_versions, [{ version: "1.6.3", installs: 1 }]);
  const img = await card("tool-image");
  assert.equal(img.usage.installs, 1, "the OCI image was not matched without its digest");
  assert.deepEqual(img.usage.other_versions, [{ version: `sha256:${DIGEST_B}`, installs: 1 }]);
  const py = await card("foo-bar");
  assert.equal(py.usage.installs, 1, "the pypi name was not normalized");
  assert.equal(py.usage.same_version, 1);
  assert.ok(!JSON.stringify([c, img, py]).match(/erin|bob|dave|workstation/), "the card names people or agents");
});

test("drift notifications: once per observed version, without people or agent names", async () => {
  const drift = async () => (await mcpNotes("alice")).filter((n) => /1\.6\.[23]/.test(n.title));
  assert.equal((await drift()).length, 1, JSON.stringify(await mcpNotes("alice")));
  await snapshot("bob", [obs({ name: "codegraph", package: "@colbymchenry/codegraph", pinned: true, version: "1.6.3" })]);
  assert.equal((await drift()).length, 1, "the same drifting version notified twice");
  await snapshot("erin", [obs({ name: "codegraph", package: "@colbymchenry/codegraph", pinned: true, version: "1.6.2" })]);
  const notes = await drift();
  assert.equal(notes.length, 2, JSON.stringify(notes));
  assert.ok(notes.some((n) => n.title.includes("1.6.2")));
  assert.ok(!JSON.stringify(await mcpNotes("alice")).match(/erin|bob|dave|workstation/), "a notification names people or agents");
  assert.equal((await mcpNotes("carol")).filter((n) => /1\.6\.[23]/.test(n.title)).length, 2, "the watcher got no drift notices");
});

test("the mcp_version kind is a preference: switched off, carol gets nothing while alice does", async () => {
  const prefs = await call("GET", "/api/v1/me/notification-prefs", undefined, "carol");
  assert.equal(prefs.status, 200);
  assert.ok(JSON.stringify(prefs.data).includes("mcp_version"), JSON.stringify(prefs.data));
  assert.equal((await call("PUT", "/api/v1/me/notification-prefs", { mcp_version: false }, "carol")).status, 200);
  const [a, c] = [(await mcpNotes("alice")).length, (await mcpNotes("carol")).length];
  reg.set(NPM_PATH, { body: { version: "1.9.0" } });
  assert.equal((await releaseCheck("codegraph")).data.release.state, "update_available");
  assert.equal((await mcpNotes("alice")).length, a + 1);
  assert.equal((await mcpNotes("carol")).length, c);
});

test("release checks turned off: 409 and no request", async () => {
  const off = await startServer(
    { SKILLFORGE_NPM_REGISTRY_URL: reg.url, SKILLFORGE_MCP_RELEASE_CHECK: "false", SKILLFORGE_MIRROR_INTERVAL_HOURS: "0" },
    { prefix: "skillforge-mcp-version-off-" },
  );
  try {
    assert.ok(off.up, off.stderr);
    const adm = (await login(off.base, "admin", ADMIN_PASSWORD)).cookie;
    const p = await api(off.base, "POST", "/api/v1/artifacts", { type: "mcp-server", files: files("codegraph", npmServer) }, { cookie: adm });
    assert.equal(p.status, 201, JSON.stringify(p.data));
    reg.clear();
    const r = await api(off.base, "POST", "/api/v1/artifacts/mcp-server/codegraph/mcp/release-check", {}, { cookie: adm });
    assert.equal(r.status, 409);
    assert.equal(r.data.error, "release_check_disabled");
    assert.deepEqual(reg.seen, []);
  } finally {
    await off.stop();
  }
});

test("a registry address that is not https or loopback stops the server at start", async () => {
  const bad = await startServer({ SKILLFORGE_NPM_REGISTRY_URL: "http://registry.example.com" }, { prefix: "skillforge-mcp-version-bad-" });
  try {
    assert.equal(bad.up, false, "the server started with a plain-http registry address");
    assert.match(bad.stderr, /SKILLFORGE_NPM_REGISTRY_URL/);
  } finally {
    if (bad.up) await bad.stop();
  }
});
