// The usage report states what it is based on; an assigned but not applied
// skill does not inflate the counters and Transfer Rate. Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api as rawApi, login, createUser, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
let srv;
let base;
let admin;
let alice;
let cliToken;
let mcp;
let work;
const api = (method, path, body, who) => rawApi(base, method, path, body, who ? { cookie: who.cookie } : {});
const usage = async (name) => (await api("GET", `/api/v1/artifacts/skill/${name}/usage`)).data;
const skillMd = (name) => `---\nname: ${name}\ndescription: Skill ${name} for the usage basis checks. Use when the user asks for ${name}.\n---\n\n# ${name}\n\nBody.\n`;

async function rpc(method, params) {
  const r = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${mcp}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await r.json()).result;
}
const record = (args) => rpc("tools/call", { name: "record_usage", arguments: args });

function cli(args) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: work,
      env: { ...process.env, SKILLFORGE_CONFIG: join(work, "config.json"), NO_COLOR: "1", SKILLFORGE_URL: base, SKILLFORGE_TOKEN: cliToken },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), 30000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      res({ code, stdout, stderr });
    });
  });
}

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-basis-" });
  assert.ok(srv.up, srv.stderr);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  await createUser(base, admin.cookie, { username: "alice", password: "alice-pw-123", role: "contributor" });
  alice = await login(base, "alice", "alice-pw-123");
  for (const name of ["via-mcp", "via-rest", "via-cli", "quiet"]) {
    const p = await api("POST", "/api/v1/artifacts", { type: "skill", files: [{ path: `${name}/SKILL.md`, content_base64: Buffer.from(skillMd(name)).toString("base64") }] }, alice);
    assert.equal(p.status, 201, JSON.stringify(p.data));
    const t = await api("POST", `/api/v1/artifacts/skill/${name}/transitions`, { to: "active" }, admin);
    assert.equal(t.status, 200, JSON.stringify(t.data));
  }
  mcp = (await api("POST", "/api/v1/me/tokens", { name: "agent", mcp: true }, alice)).data.token;
  cliToken = (await api("POST", "/api/v1/me/tokens", { name: "cli" }, alice)).data.token;
  work = mkdtempSync(join(tmpdir(), "skillforge-basis-work-"));
});

after(async () => {
  if (srv?.up) await srv.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("MCP: assigned does not change the counters and the share and is shown separately; loaded and a report without the field are counted", async () => {
  const plain = await record({ type: "skill", name: "via-mcp", uses: 10, helped: 5 });
  assert.notEqual(plain.isError, true, JSON.stringify(plain));
  const assigned = await record({ type: "skill", name: "via-mcp", uses: 9, helped: 9, basis: "assigned" });
  assert.notEqual(assigned.isError, true, JSON.stringify(assigned));
  assert.equal(assigned.structuredContent.use_count, 10);
  assert.equal(assigned.structuredContent.help_count, 5);
  assert.equal(assigned.structuredContent.transfer_rate, 0.5);
  const loaded = await record({ type: "skill", name: "via-mcp", uses: 2, helped: 1, basis: "loaded" });
  assert.equal(loaded.structuredContent.use_count, 12);

  const u = await usage("via-mcp");
  assert.equal(u.total.uses, 12);
  assert.equal(u.total.helped, 6);
  assert.equal(u.total.transfer_rate, 0.5);
  const rows = Object.fromEntries(u.by_source.map((r) => [`${r.source}/${r.basis}`, r]));
  assert.equal(rows["mcp/null"].uses, 10);
  assert.equal(rows["mcp/loaded"].uses, 2);
  assert.equal(rows["mcp/assigned"].uses, 9);
  assert.equal(rows["mcp/assigned"].transfer_rate, null);
});

test("MCP: an invalid basis — an error without a record; the field is declared in tools/list", async () => {
  const before = await usage("via-mcp");
  const bad = await record({ type: "skill", name: "via-mcp", uses: 1, helped: 1, basis: "maybe" });
  assert.equal(bad.isError, true);
  assert.deepEqual(await usage("via-mcp"), before);
  const list = await rpc("tools/list", {});
  const tool = list.tools.find((t) => t.name === "record_usage");
  assert.deepEqual(tool.inputSchema.properties.basis.enum, ["loaded", "assigned"]);
});

test("REST: assigned does not change the counters; a repeated report_id does not double-count; an invalid value gives 400", async () => {
  const a = await api("POST", "/api/v1/artifacts/skill/via-rest/usage", { uses: 4, helped: 4, basis: "assigned", report_id: "r1" }, alice);
  assert.equal(a.status, 201, JSON.stringify(a.data));
  assert.equal(a.data.use_count, 0);
  assert.equal(a.data.transfer_rate, null);
  const again = await api("POST", "/api/v1/artifacts/skill/via-rest/usage", { uses: 4, helped: 4, basis: "assigned", report_id: "r1" }, alice);
  assert.equal(again.status, 200);
  const u = await usage("via-rest");
  assert.equal(u.by_source[0].reports, 1);
  const bad = await api("POST", "/api/v1/artifacts/skill/via-rest/usage", { uses: 1, helped: 1, basis: "maybe" }, alice);
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error, "usage_invalid");
});

test("CLI: report-usage --basis; an invalid value — exit code 2 without a record", async () => {
  const ok = await cli(["report-usage", "skill/via-cli", "--uses", "3", "--helped", "3", "--basis", "assigned", "--json"]);
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).use_count, 0);
  const bad = await cli(["report-usage", "skill/via-cli", "--uses", "3", "--helped", "3", "--basis", "maybe"]);
  assert.equal(bad.code, 2, bad.stderr);
  const u = await usage("via-cli");
  assert.equal(u.by_source.length, 1);
  assert.equal(u.by_source[0].basis, "assigned");
  assert.equal(u.by_source[0].source, "api");
});

test("artifact metrics and the low_transfer rule do not see assigned", async () => {
  await record({ type: "skill", name: "quiet", uses: 100, helped: 100, basis: "assigned" });
  const m = (await api("GET", "/api/v1/artifacts/skill/quiet/metrics")).data;
  assert.equal(m.uses, 0);
  assert.equal(m.helped, 0);
  assert.equal(m.transfer_rate, null);
});
