// Acceptance tests for the unified audit log for the security team: artifact events and system events (policies, users, LLM, mirrors)
// in one stream with a cursor, filters and NDJSON export; the LLM key never reaches the log.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, api, login, createUser, toB64, ADMIN_PASSWORD } from "./lib/client.mjs";

const KEY = "sk-test-KEYMARKER-audit-0123456789";
const AU = "/api/v1/admin/audit";
let srv;
const auth = {};
let rita;
const call = (method, path, body, who = auth.admin) => api(srv.base, method, path, body, who ? { cookie: who.cookie } : {});

before(async () => {
  srv = await startServer({ SKILLFORGE_LLM_API_KEY: KEY }, { prefix: "skillforge-audit-" });
  assert.ok(srv.up, srv.stderr);
  auth.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  rita = await createUser(srv.base, auth.admin.cookie, { username: "rita", password: "rita-pw-123456", role: "reviewer" });
  auth.rita = await login(srv.base, "rita", "rita-pw-123456");
  const md = "---\nname: audited-skill\ndescription: An audit test skill. Use when testing the log.\n---\n\n# audited-skill\n\nSteps.\n";
  assert.equal((await call("POST", "/api/v1/artifacts", { type: "skill", files: toB64([{ path: "audited-skill/SKILL.md", content: md }]) })).status, 201);
  assert.equal((await call("POST", "/api/v1/artifacts/skill/audited-skill/transitions", { to: "active", reason: "audit test" }, auth.rita)).status, 200);
  assert.equal((await call("PUT", "/api/v1/admin/import-policy", { min_release_age_days: 3 })).status, 200);
  assert.equal((await call("PUT", "/api/v1/admin/security-policy", { block_publish_on: "high" })).status, 200);
  assert.equal((await call("PUT", "/api/v1/admin/llm", { base_url: "http://127.0.0.1:9/v1", model: "m1" })).status, 200);
  const id = rita.user?.id ?? rita.id;
  assert.equal((await call("PATCH", `/api/v1/admin/users/${id}`, { disabled: true })).status, 200);
  assert.equal((await call("PATCH", `/api/v1/admin/users/${id}`, { disabled: false })).status, 200);
  // Disabling deleted rita's sessions: sign in again to check her role, not a dead cookie.
  auth.rita = await login(srv.base, "rita", "rita-pw-123456");
});

after(async () => {
  await srv?.stop();
});

test("admin only", async () => {
  assert.equal((await call("GET", AU, undefined, auth.rita)).status, 403);
  assert.equal((await call("GET", AU, undefined, null)).status, 401);
});

test("one stream: artifact events and system events, in time order", async () => {
  const r = await call("GET", `${AU}?limit=200`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const actions = r.data.items.map((e) => `${e.source}:${e.action}`);
  for (const want of [
    "artifact:publish",
    "artifact:transition",
    "system:import_policy_change",
    "system:security_policy_change",
    "system:llm_settings_change",
    "system:user_update",
  ]) {
    assert.ok(actions.includes(want), `missing ${want}: ${actions.join(", ")}`);
  }
  const pub = r.data.items.find((e) => e.action === "publish");
  assert.deepEqual(pub.artifact, { type: "skill", name: "audited-skill" });
  const disable = r.data.items.find((e) => e.action === "user_update" && e.meta?.disabled === true);
  assert.equal(disable.target, "rita");
  assert.ok(!("password" in (disable.meta ?? {})), "password in the log");
  const ts = r.data.items.map((e) => e.ts);
  assert.deepEqual(ts, [...ts].sort(), "not in time order");
  assert.ok(!JSON.stringify(r.data).includes(KEY), "LLM key in the log");
});

test("cursor: pages without gaps or repeats", async () => {
  const all = (await call("GET", `${AU}?limit=200`)).data.items.map((e) => e.cursor);
  const seen = [];
  let after;
  for (let i = 0; i < 50; i++) {
    const page = (await call("GET", `${AU}?limit=2${after ? `&after=${encodeURIComponent(after)}` : ""}`)).data;
    seen.push(...page.items.map((e) => e.cursor));
    if (!page.next) break;
    after = page.next;
  }
  assert.deepEqual(seen, all);
  assert.equal((await call("GET", `${AU}?after=garbage`)).status, 400);
});

test("filters: action, author, time", async () => {
  const byAction = (await call("GET", `${AU}?action=security_policy_change`)).data.items;
  assert.equal(byAction.length, 1);
  const byActor = (await call("GET", `${AU}?actor=rita`)).data.items;
  assert.ok(byActor.length >= 1 && byActor.every((e) => e.actor === "rita"));
  const future = (await call("GET", `${AU}?since=2999-01-01T00:00:00Z`)).data.items;
  assert.deepEqual(future, []);
});

test("NDJSON export: one line per event", async () => {
  const res = await fetch(`${srv.base}${AU}?format=ndjson`, { headers: { cookie: auth.admin.cookie } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /application\/x-ndjson/);
  const lines = (await res.text()).trim().split("\n");
  const parsed = lines.map((l) => JSON.parse(l));
  assert.ok(parsed.length >= 6);
  assert.ok(parsed.every((e) => e.cursor && e.ts && e.action));
});
