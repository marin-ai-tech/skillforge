// Executive report: usage over a period by consumer teams and artifacts, trend against the previous period, context token
// estimate (sessions × (every turn + on invocation)) and what can be removed — active artifacts without a single session.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, api, login, createUser, toB64, ADMIN_PASSWORD } from "./lib/client.mjs";

const R = "/api/v1/admin/report";
const DAY = 86400000;
const HEX = (n) => n.toString(16).padStart(32, "0");
let srv;
const auth = {};
let keyN = 1;
const call = (method, path, body, who = auth.admin) => api(srv.base, method, path, body, who ? { cookie: who.cookie } : {});

async function skill(name) {
  const md = `---\nname: ${name}\ndescription: Report test skill ${name}. Use when testing the report.\n---\n\n# ${name}\n\nDo the steps.\n`;
  assert.equal((await call("POST", "/api/v1/artifacts", { type: "skill", files: toB64([{ path: `${name}/SKILL.md`, content: md }]) })).status, 201);
}

async function fact(name, who, daysAgo) {
  const used_at = new Date(Date.now() - daysAgo * DAY).toISOString();
  const r = await call("POST", "/api/v1/me/session-facts", { source: "claude-code", facts: [{ skill: name, session_key: HEX(keyN++), used_at, verification: "none" }] }, auth[who]);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.accepted, 1, JSON.stringify(r.data));
}

let report;
before(async () => {
  srv = await startServer({}, { prefix: "skillforge-report-" });
  assert.ok(srv.up, srv.stderr);
  auth.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [["rita", "reviewer"], ["lena", "contributor"], ["oscar", "contributor"], ["mia", "contributor"], ["nora", "contributor"]]) {
    await createUser(srv.base, auth.admin.cookie, { username: u, password: `${u}-pw-123456`, role });
    auth[u] = await login(srv.base, u, `${u}-pw-123456`);
  }
  assert.equal((await call("POST", "/api/v1/teams", { name: "alpha", lead: "lena" })).status, 201);
  assert.equal((await call("POST", "/api/v1/teams", { name: "beta", lead: "oscar" })).status, 201);
  assert.equal((await call("POST", "/api/v1/teams/alpha/members", { username: "mia" }, auth.lena)).status, 201);
  for (const n of ["used-a", "used-b", "idle-c", "gone-d"]) await skill(n);
  for (const n of ["used-a", "used-b", "idle-c"]) {
    assert.equal((await call("POST", `/api/v1/artifacts/skill/${n}/transitions`, { to: "active", reason: "report test" }, auth.rita)).status, 200);
  }
  assert.equal((await call("POST", "/api/v1/artifacts/skill/gone-d/transitions", { to: "retired", reason: "report test" }, auth.rita)).status, 200);
  // Current period (30 days): mia — 3 sessions of used-a, nora (no team) — 1 of used-a, lena — 1 of used-b.
  for (const d of [1, 5, 20]) await fact("used-a", "mia", d);
  await fact("used-a", "nora", 2);
  await fact("used-b", "lena", 3);
  // Previous period (31–60 days ago): mia — 1 session of used-a.
  await fact("used-a", "mia", 45);
  const r = await call("GET", `${R}?days=30`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  report = r.data;
});

after(async () => {
  await srv?.stop();
});

test("admin only; the period is validated", async () => {
  assert.equal((await call("GET", R, undefined, auth.rita)).status, 403);
  assert.equal((await call("GET", R, undefined, null)).status, 401);
  for (const bad of ["0", "366", "abc"]) assert.equal((await call("GET", `${R}?days=${bad}`)).status, 400, bad);
  assert.equal((await call("GET", R)).data.period.days, 30, "30 days by default");
});

test("totals and trend against the previous period", () => {
  assert.equal(report.period.days, 30);
  assert.equal(report.totals.sessions, 5);
  assert.equal(report.totals.previous_sessions, 1);
  assert.equal(report.totals.users, 3);
  assert.equal(report.totals.active_artifacts, 3, "retired is not counted");
  const weeks = report.trend.map((w) => w.sessions);
  assert.equal(weeks.reduce((a, b) => a + b, 0), 5, JSON.stringify(report.trend));
  const starts = report.trend.map((w) => w.start);
  assert.deepEqual(starts, [...starts].sort(), "trend by time");
});

test("consumer teams: a member counts in their own team, no team is a separate row", () => {
  const team = (name) => report.teams.find((t) => t.team === name);
  assert.equal(team("alpha").sessions, 4, JSON.stringify(report.teams));
  assert.equal(team("alpha").previous_sessions, 1);
  assert.equal(team("alpha").users, 2);
  assert.equal(team("beta").sessions, 0, "a team without usage appears in the report with zero");
  assert.equal(team(null).sessions, 1, "nora has no team");
});

test("artifacts: sessions, trend and context token estimate", async () => {
  const art = (name) => report.artifacts.find((a) => a.name === name);
  assert.deepEqual([art("used-a").sessions, art("used-a").previous_sessions], [4, 1]);
  assert.deepEqual([art("used-b").sessions, art("used-b").previous_sessions], [1, 0]);
  const q = (await call("GET", "/api/v1/artifacts/skill/used-a")).data.latest.quality.context;
  assert.equal(art("used-a").est_context_tokens, 4 * (q.every_turn + q.on_use));
  const sessions = report.artifacts.map((a) => a.sessions);
  assert.deepEqual(sessions, [...sessions].sort((a, b) => b - a), "in descending order of sessions");
  assert.ok(!report.artifacts.some((a) => a.name === "idle-c"), "an unused one is not in the usage list");
});

test("what can be removed: active ones without sessions in the period; used and retired ones cannot", () => {
  const names = report.unused.map((a) => a.name);
  assert.deepEqual(names, ["idle-c"]);
  assert.equal(report.unused[0].recent, true, "published within the period — marked as new");
});
