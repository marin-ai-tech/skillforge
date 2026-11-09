// Acceptance tests for the cabinet (user dashboard) response
// `GET /api/v1/me/overview`. Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, api, login, createUser, ADMIN_PASSWORD } from "./lib/client.mjs";

const STATUSES = ["candidate", "active", "aging", "zombie", "retired"];
const skillMd = (name) =>
  Buffer.from(`---\nname: ${name}\ndescription: Probe skill ${name} for the cabinet checks. Use when testing the overview.\n---\n\n# ${name}\n\nBody.\n`);
const files = (name) => [{ path: "SKILL.md", content_base64: skillMd(name).toString("base64") }];

let srv;
let base;
let admin;
let alice;
let rita;
let bob;
let aliceToken;
let bobToken;

async function publish(name, who) {
  const r = await api(base, "POST", "/api/v1/artifacts", { type: "skill", files: files(name) }, { cookie: who.cookie });
  assert.equal(r.status, 201, `publish ${name}: ${r.status} ${JSON.stringify(r.data)}`);
}

async function overview(auth) {
  const r = await api(base, "GET", "/api/v1/me/overview", undefined, auth);
  assert.equal(r.status, 200, `overview: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-me-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  await createUser(base, admin.cookie, { username: "alice", password: "alice-pw-1", role: "contributor" });
  await createUser(base, admin.cookie, { username: "rita", password: "rita-pw-123", role: "reviewer" });
  await createUser(base, admin.cookie, { username: "bob", password: "bob-pw-123", role: "viewer" });
  alice = await login(base, "alice", "alice-pw-1");
  rita = await login(base, "rita", "rita-pw-123");
  bob = await login(base, "bob", "bob-pw-123");

  // Order matters: the review queue is sorted by created_at (oldest to newest).
  await publish("alpha-notes", alice);
  await publish("beta-notes", alice);
  await publish("gamma-admin", admin);
  await publish("delta-admin", admin);
  const t = await api(base, "POST", "/api/v1/artifacts/skill/alpha-notes/transitions", { to: "active", reason: "cabinet test" }, { cookie: rita.cookie });
  assert.equal(t.status, 200, `transition: ${t.status} ${JSON.stringify(t.data)}`);

  const tok = await api(base, "POST", "/api/v1/me/tokens", { name: "cabinet-secret-name" }, { cookie: alice.cookie });
  assert.equal(tok.status, 201);
  aliceToken = tok.data;
  const btok = await api(base, "POST", "/api/v1/me/tokens", { name: "bob-cli" }, { cookie: bob.cookie });
  assert.equal(btok.status, 201);
  bobToken = btok.data;

  const agentFiles = [
    { path: "skills/alpha-notes/SKILL.md", content_base64: skillMd("alpha-notes").toString("base64") },
    { path: "skills/only-local/SKILL.md", content_base64: skillMd("only-local").toString("base64") },
  ];
  const put = await api(base, "PUT", "/api/v1/me/agents/laptop", { files: agentFiles }, { cookie: alice.cookie });
  assert.equal(put.status, 200, `agent snapshot: ${put.status} ${JSON.stringify(put.data)}`);
});

after(async () => {
  if (srv?.up) await srv.stop();
});

test("contributor cabinet: own artifacts, statuses, agents, tokens, activity; no review queue", async () => {
  const o = await overview({ cookie: alice.cookie });
  assert.equal(o.user.username, "alice");
  assert.equal(o.user.role, "contributor");

  assert.equal(o.artifacts.total, 2);
  assert.deepEqual(Object.keys(o.artifacts.by_status).sort(), [...STATUSES].sort(), "by_status has all five statuses");
  assert.equal(o.artifacts.by_status.active, 1);
  assert.equal(o.artifacts.by_status.candidate, 1);
  for (const s of ["aging", "zombie", "retired"]) assert.equal(o.artifacts.by_status[s], 0);
  assert.deepEqual(o.artifacts.items.map((a) => `${a.type}/${a.name}`).sort(), ["skill/alpha-notes", "skill/beta-notes"]);
  assert.ok(o.artifacts.items.every((a) => a.created_by === "alice"));
  assert.equal(o.artifacts.items.find((a) => a.name === "alpha-notes").status, "active");

  assert.equal(o.agents.total, 1);
  assert.equal(o.agents.items[0].name, "laptop");
  const mine = await api(base, "GET", "/api/v1/me/agents", undefined, { cookie: alice.cookie });
  assert.deepEqual(o.agents.items[0].summary, mine.data.items[0].summary, "the agent summary is the same as in /me/agents");
  assert.equal(o.agents.items[0].summary.local_only, 1);
  assert.equal(o.agents.items[0].summary.in_sync, 1);
  assert.equal(o.agents.attention, 0, "no outdated/modified → needs no attention");

  assert.equal(o.tokens.active, 1);
  assert.equal(o.tokens.never_used, 1);
  assert.equal(o.tokens.last_used_at, null);

  assert.equal(o.review, null, "contributor does not see the review queue");

  const acts = o.activity;
  assert.ok(acts.length >= 3 && acts.length <= 20);
  assert.ok(acts.some((e) => e.action === "publish" && e.name === "alpha-notes" && e.actor === "alice"));
  assert.ok(acts.some((e) => e.action === "publish" && e.name === "beta-notes"));
  assert.ok(
    acts.some((e) => e.action === "transition" && e.name === "alpha-notes" && e.actor === "rita" && e.to_status === "active"),
    "a reviewer's transition on alice's artifact shows up in her feed",
  );
  assert.ok(!acts.some((e) => e.name === "gamma-admin" || e.name === "delta-admin"), "other people's artifacts do not appear in the feed");
  assert.ok(acts.every((e) => e.type === "skill" && typeof e.ts === "string"));
  for (let i = 1; i < acts.length; i++) assert.ok(acts[i - 1].ts >= acts[i].ts, "the feed is in descending ts order");
});

test("reviewer and admin cabinet: the review queue is all candidates, oldest to newest", async () => {
  const o = await overview({ cookie: rita.cookie });
  assert.equal(o.user.role, "reviewer");
  assert.ok(o.review, "reviewer sees the queue");
  assert.equal(o.review.pending, 3);
  assert.deepEqual(
    o.review.items.map((a) => a.name),
    ["beta-notes", "gamma-admin", "delta-admin"],
  );
  assert.equal(o.artifacts.total, 0, "rita has no artifacts of her own");
  assert.ok(o.activity.some((e) => e.action === "transition" && e.actor === "rita"), "own actions are in the feed");

  const a = await overview({ cookie: admin.cookie });
  assert.equal(a.review.pending, 3);
  assert.equal(a.artifacts.total, 2);
});

test("empty viewer cabinet; access with an API token gives the same response", async () => {
  const bySession = await overview({ cookie: bob.cookie });
  const byToken = await overview({ token: bobToken.token });
  assert.deepEqual(byToken.user, bySession.user);
  assert.equal(bySession.user.role, "viewer");
  assert.equal(bySession.artifacts.total, 0);
  assert.deepEqual(bySession.artifacts.items, []);
  assert.equal(bySession.agents.total, 0);
  assert.equal(bySession.review, null);
  assert.deepEqual(bySession.activity, []);
  assert.equal(byToken.tokens.active, 1);
});

test("not signed in — 401", async () => {
  const r = await api(base, "GET", "/api/v1/me/overview");
  assert.equal(r.status, 401);
  const forged = await api(base, "GET", "/api/v1/me/overview", undefined, {}, { "x-skillforge-actor": "alice" });
  assert.equal(forged.status, 401, "an actor header does not replace signing in");
});

test("tokens are not exposed: no name, no prefix, no hash", async () => {
  const r = await api(base, "GET", "/api/v1/me/overview", undefined, { cookie: alice.cookie });
  assert.equal(r.status, 200, "the leak check only makes sense on a real response");
  assert.ok(r.data.tokens.active >= 1, "alice has a token — there was something to leak");
  const raw = JSON.stringify(r.data);
  assert.ok(!raw.includes(aliceToken.prefix), "token prefix in the response");
  assert.ok(!raw.includes("cabinet-secret-name"), "token name in the response");
  assert.ok(!raw.includes(aliceToken.token), "the token itself in the response");
  assert.ok(!/hash/i.test(raw), "a hash field in the response");
});
