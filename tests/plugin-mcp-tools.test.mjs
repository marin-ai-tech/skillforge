// plugin-mcp-tools: a plugin with the `mcp` capability adds MCP tools to /mcp (fixture mcp-probe is the contract).
// Negative cases: a plugin reads only what the caller's token sees; an integration tool is hidden from an agent token;
// a tool that fails does not take the server down; a clash with a built-in name and a missing capability are load
// errors; a disabled plugin has no tools; an integration flag without mcp is refused.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, toB64, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

let srv;
let work;
const who = {};
const tokens = {};
const BUILT_IN = ["get_artifact", "read_artifact_file", "read_artifact_files", "record_usage", "search_artifacts"];
const call = (method, path, body, user = who.admin) => api(srv.base, method, path, body, { cookie: user.cookie });
const md = (name) => `---\nname: ${name}\ndescription: Plugin MCP probe ${name}. Use when testing plugin tools.\n---\n\n# ${name}\n\nBody.\n`;

async function rpc(token, method, params) {
  const r = await fetch(`${srv.base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  assert.equal(r.status, 200);
  return r.json();
}
const names = async (token) => (await rpc(token, "tools/list", {})).result.tools.map((t) => t.name).sort();
const tool = (token, name, args = {}) => rpc(token, "tools/call", { name, arguments: args });

async function publish(user, name, extra = {}) {
  const r = await call("POST", "/api/v1/artifacts", { type: "skill", files: toB64([{ path: `${name}/SKILL.md`, content: md(name) }]), ...extra }, user);
  assert.equal(r.status, 201, JSON.stringify(r.data));
}

before(async () => {
  work = mkdtempSync(join(tmpdir(), "skillforge-plugin-mcp-"));
  const pluginsDir = join(work, "plugins");
  for (const name of ["mcp-probe", "mcp-clash", "mcp-nocap"]) {
    cpSync(join(ROOT, "tests", "fixtures", "plugins", name), join(pluginsDir, name), { recursive: true });
  }
  srv = await startServer({ SKILLFORGE_PLUGINS_DIR: pluginsDir, SKILLFORGE_BUNDLED_PLUGINS_DIR: "" }, { prefix: "skillforge-plugin-mcp-srv-" });
  assert.ok(srv.up, srv.stderr);
  who.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const u of ["alice", "bob"]) await createUser(srv.base, who.admin.cookie, { username: u, password: `${u}-pw-123`, role: "contributor" });
  who.alice = await login(srv.base, "alice", "alice-pw-123");
  who.bob = await login(srv.base, "bob", "bob-pw-123");
  assert.equal((await call("POST", "/api/v1/teams", { name: "beta", lead: "bob" })).status, 201);
  await publish(who.alice, "open-skill");
  await publish(who.bob, "beta-skill", { visibility: "team", owner_team: "beta" });
  await publish(who.alice, "draft-skill");
  for (const n of ["open-skill", "beta-skill"]) {
    assert.equal((await call("POST", `/api/v1/artifacts/skill/${n}/transitions`, { to: "active", reason: "fixture" })).status, 200);
  }
  const mk = async (body) => {
    const r = await call("POST", "/api/v1/me/tokens", body, who.alice);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data;
  };
  tokens.agent = (await mk({ name: "agent", mcp: true })).token;
  const integ = await mk({ name: "sdlc", mcp: true, integration: true });
  assert.equal(integ.integration, true);
  tokens.integration = integ.token;
});

after(async () => {
  if (srv?.up) await srv.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("an agent token lists and calls the plugin's agent tools; the integration tool is hidden from it", async () => {
  assert.deepEqual(await names(tokens.agent), [...BUILT_IN, "probe_echo", "probe_fail", "probe_find"].sort());
  const echo = await tool(tokens.agent, "probe_echo", { text: "hi" });
  assert.equal(echo.result.isError, undefined, JSON.stringify(echo));
  assert.deepEqual(echo.result.structuredContent, { echo: "hi", user: "alice", integration: false });
  const hidden = await tool(tokens.agent, "probe_report", { name: "open-skill" });
  assert.equal(hidden.error?.code, -32602, JSON.stringify(hidden));
});

test("a plugin reads as the caller: no foreign team artifact, no candidate", async () => {
  const found = await tool(tokens.agent, "probe_find");
  assert.deepEqual(found.result.structuredContent, { names: ["open-skill"] });
});

test("a failing tool is an error result and the next call works", async () => {
  const fail = await tool(tokens.agent, "probe_fail");
  assert.equal(fail.result.isError, true);
  assert.match(fail.result.content[0].text, /probe failure on purpose/);
  assert.equal((await tool(tokens.agent, "probe_echo", { text: "again" })).result.structuredContent.echo, "again");
});

test("an integration token sees every tool; usage goes on record as the token's owner", async () => {
  assert.deepEqual(await names(tokens.integration), [...BUILT_IN, "probe_echo", "probe_fail", "probe_find", "probe_report"].sort());
  const r = await tool(tokens.integration, "probe_report", { name: "open-skill" });
  assert.notEqual(r.result.isError, true, JSON.stringify(r));
  const usage = (await call("GET", "/api/v1/artifacts/skill/open-skill/usage")).data;
  const row = usage.by_source.find((x) => x.basis === "assigned");
  assert.equal(row?.uses, 1, JSON.stringify(usage));
  const bad = await call("POST", "/api/v1/me/tokens", { name: "x", integration: true }, who.alice);
  assert.equal(bad.status, 400, "integration without mcp");
});

test("a clash with a built-in tool and a missing capability are load errors; their tools are absent", async () => {
  const items = (await call("GET", "/api/v1/admin/plugins")).data.items;
  const by = Object.fromEntries(items.map((p) => [p.name, p]));
  assert.equal(by["mcp-probe"].status, "loaded", JSON.stringify(by["mcp-probe"]));
  assert.equal(by["mcp-clash"].status, "error");
  assert.match(String(by["mcp-clash"].error), /get_artifact/);
  assert.equal(by["mcp-nocap"].status, "error");
  assert.ok(!(await names(tokens.integration)).includes("nocap_tool"));
  // fix-admin-plugin-mcp-tools: the admin listing names each tool and its audience; a failed plugin has none.
  assert.deepEqual(by["mcp-probe"].contributions.mcp_tools, [
    { name: "probe_echo", audience: "agent" },
    { name: "probe_fail", audience: "agent" },
    { name: "probe_find", audience: "agent" },
    { name: "probe_report", audience: "integration" },
  ]);
  assert.deepEqual(by["mcp-clash"].contributions.mcp_tools, []);
});

test("a disabled plugin has no tools", async () => {
  const off = await call("PATCH", "/api/v1/admin/plugins/mcp-probe", { enabled: false });
  assert.equal(off.status, 200, JSON.stringify(off.data));
  assert.deepEqual(await names(tokens.integration), BUILT_IN);
  assert.equal((await tool(tokens.agent, "probe_echo", { text: "x" })).error?.code, -32602);
});
