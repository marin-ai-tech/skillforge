// getting-started-walkthrough: the «First steps» path, steps 2–10, run against a test server with the same API and CLI
// the topic tells people to use. Each test checks the step's «Done when» sign from the topic, so the topic and the
// product cannot drift apart. Steps 1 (start) and 11 (the checklist) are covered by the server start and by the other
// tests here. Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
let srv;
let work;
const auth = {};
const tokens = {};
const call = (method, path, body, who) => api(srv.base, method, path, body, auth[who] ? { cookie: auth[who].cookie } : {});
const SKILL = "fs-notes";
const md = `---\nname: ${SKILL}\ndescription: Keeps short notes for the first steps walkthrough. Use when the user asks to remember a note.\n---\n\n# Notes\n\nStore notes.\n`;

function cli(args, { cwd = work, env = {} } = {}) {
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("SKILLFORGE_")));
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: { ...base, NO_COLOR: "1", SKILLFORGE_CONFIG: join(work, "home", ".skillforge", "config.json"), ...env },
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, stdout: r.stdout };
}

async function mcp(token, name, args) {
  const r = await fetch(`${srv.base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  return (await r.json()).result;
}

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-first-steps-" });
  assert.ok(srv.up, srv.stderr);
  work = mkdtempSync(join(tmpdir(), "skillforge-first-steps-"));
  mkdirSync(join(work, "home", ".skillforge"), { recursive: true });
  auth.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
});

after(async () => {
  await srv?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("step 2: users — a person and an agent's own user; done when both sign in", async () => {
  await createUser(srv.base, auth.admin.cookie, { username: "lead", password: "lead-pw-123456", role: "contributor" });
  await createUser(srv.base, auth.admin.cookie, { username: "station", password: "station-pw-123456", role: "viewer" });
  auth.lead = await login(srv.base, "lead", "lead-pw-123456");
  auth.station = await login(srv.base, "station", "station-pw-123456");
  assert.ok(auth.lead.cookie && auth.station.cookie);
});

test("step 3: artifacts — publish, see the security verdict, activate; done when it is active", async () => {
  const pub = await call("POST", "/api/v1/artifacts", { type: "skill", files: [{ path: `${SKILL}/SKILL.md`, content_base64: Buffer.from(md).toString("base64") }] }, "lead");
  assert.equal(pub.status, 201, JSON.stringify(pub.data));
  const v = await call("GET", `/api/v1/artifacts/skill/${SKILL}/versions/0.1.0`, undefined, "lead");
  assert.ok(["pass", "warn"].includes(v.data.quality?.security?.verdict), JSON.stringify(v.data.quality?.security));
  const t = await call("POST", `/api/v1/artifacts/skill/${SKILL}/transitions`, { to: "active", reason: "first steps" }, "admin");
  assert.equal(t.status, 200, JSON.stringify(t.data));
  assert.equal((await call("GET", `/api/v1/artifacts/skill/${SKILL}`, undefined, "station")).data.artifact.status, "active");
});

test("step 4: MCP — a token with MCP consent; done when search_artifacts finds the skill", async () => {
  const tok = await call("POST", "/api/v1/me/tokens", { name: "station-mcp", mcp: true }, "station");
  assert.equal(tok.status, 201, JSON.stringify(tok.data));
  tokens.stationMcp = tok.data.token;
  const found = await mcp(tokens.stationMcp, "search_artifacts", { query: SKILL });
  assert.ok(found.structuredContent.items.some((i) => i.name === SKILL), JSON.stringify(found));
});

test("steps 5–6: agents and sessions — a CLI profile per account and a project binding; done when whoami names the right user", async () => {
  tokens.lead = (await call("POST", "/api/v1/me/tokens", { name: "lead-cli" }, "lead")).data.token;
  tokens.station = (await call("POST", "/api/v1/me/tokens", { name: "station-cli" }, "station")).data.token;
  assert.equal(cli(["login", "--url", srv.base, "--token", tokens.lead, "--name", "lead"]).status, 0);
  const st = cli(["login", "--profile", "station", "--url", srv.base, "--token", tokens.station]);
  assert.equal(st.status, 0, st.out);
  const proj = join(work, "station-project");
  mkdirSync(join(proj, ".skillforge"), { recursive: true });
  writeFileSync(join(proj, ".skillforge", "profile"), "station\n");
  assert.match(cli(["whoami"]).stdout, /lead/, "the default profile is not the lead's");
  assert.match(cli(["whoami"], { cwd: proj }).stdout, /station/, "the project binding did not choose the station");
  const list = cli(["profile", "list", "--json"], { cwd: proj });
  assert.equal(JSON.parse(list.stdout).active.source, "project");
});

test("step 7: skills in a session — the agent reports usage; done when the report is accepted", async () => {
  const r = await mcp(tokens.stationMcp, "record_usage", { type: "skill", name: SKILL, uses: 3, helped: 2, basis: "loaded" });
  assert.ok(!r.isError, JSON.stringify(r));
});

test("step 8: My space — done when the usage report and the token are there", async () => {
  const me = (await call("GET", "/api/v1/me/overview", undefined, "station")).data;
  assert.ok(me.tokens.active >= 1);
  const row = me.usage_reports.items.find((i) => i.name === SKILL);
  assert.ok(row, JSON.stringify(me.usage_reports));
  assert.equal(row.uses, 3);
  assert.equal(row.helped, 2);
});

test("step 9: a team — members and a required artifact; done when the member sees the assignment", async () => {
  assert.equal((await call("POST", "/api/v1/teams", { name: "fs-team", lead: "lead" }, "admin")).status, 201);
  assert.equal((await call("POST", "/api/v1/teams/fs-team/members", { username: "station" }, "lead")).status, 201);
  const a = await call("PUT", `/api/v1/artifacts/skill/${SKILL}/availability`, { team: "fs-team", state: "required" }, "lead");
  assert.equal(a.status, 200, JSON.stringify(a.data));
  const mine = (await call("GET", "/api/v1/me/assignments", undefined, "station")).data;
  assert.deepEqual(mine.required.map((x) => x.name), [SKILL]);
});

test("step 10: a method pack — check, publish from a file, install a role; done when the role is installed pinned", async () => {
  const file = join(work, "pack.json");
  writeFileSync(file, JSON.stringify({ name: "fs-method", version: "1.0.0", title: "First steps method", description: "Our way.", roles: [{ name: "dev", description: "Builds", items: [{ type: "skill", name: SKILL, version: "0.1.0" }] }] }));
  const dry = cli(["pack", "publish", file, "--dry-run"]);
  assert.equal(dry.status, 0, dry.out);
  assert.match(dry.out, /fs-method@1\.0\.0: ok/);
  const pub = cli(["pack", "publish", file]);
  assert.equal(pub.status, 0, pub.out);
  const proj = join(work, "station-project");
  const into = join(proj, ".claude");
  const inst = cli(["pack", "install", "fs-method", "--role", "dev", "--into", into], { cwd: proj });
  assert.equal(inst.status, 0, inst.out);
  assert.ok(existsSync(join(into, "skills", SKILL, "SKILL.md")), inst.out);
  const lock = JSON.parse(readFileSync(join(into, ".skillforge-lock.json"), "utf8"));
  assert.equal(lock.artifacts[`skill/${SKILL}`]?.pin, "0.1.0", JSON.stringify(lock));
});
