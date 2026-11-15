// session-fact-model: a session fact may carry the model that called the skill. The server keeps a well-formed model
// in lower case and drops anything else without refusing the fact; a repeated fact fills in a missing model without
// counting again. The artifact metrics split facts by agent and model; a model shows only when at least two people in
// the registry reported it, so a word typed by one person never becomes public.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, api as rawApi, login, createUser, ADMIN_PASSWORD } from "./lib/client.mjs";

let srv;
let base;
let alice, bob, carol;
const api = (method, path, body, who) => rawApi(base, method, path, body, who ? { cookie: who.cookie } : {});
let n = 0;
const fact = (skill, verification, model) => ({
  skill,
  session_key: (0x5000 + ++n).toString(16).padStart(32, "0"),
  used_at: `2026-11-1${n % 5}T09:${String(n % 60).padStart(2, "0")}:00.000Z`,
  verification,
  ...(model === undefined ? {} : { model }),
});
const post = (who, source, facts) => api("POST", "/api/v1/me/session-facts", { source, facts }, who);
const metrics = async (name) => (await api("GET", `/api/v1/artifacts/skill/${name}/metrics`, undefined, alice)).data;
const pick = (rows, runtime, model) => rows.find((r) => r.runtime === runtime && r.model === model);

async function publish(name) {
  const md = `---\nname: ${name}\ndescription: Skill for the session fact model test, split by agent and model.\n---\n\n# ${name}\n\nDo the task.\n`;
  const r = await api("POST", "/api/v1/artifacts", { type: "skill", files: [{ path: `${name}/SKILL.md`, content_base64: Buffer.from(md).toString("base64") }] }, alice);
  assert.equal(r.status, 201, JSON.stringify(r.data));
}

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-fact-model-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  const admin = await login(base, "admin", ADMIN_PASSWORD);
  for (const u of ["alice", "bob", "carol"]) await createUser(base, admin.cookie, { username: u, password: `${u}-pw-123`, role: "contributor" });
  alice = await login(base, "alice", "alice-pw-123");
  bob = await login(base, "bob", "bob-pw-123");
  carol = await login(base, "carol", "carol-pw-123");
  for (const name of ["model-split", "model-format", "model-backfill", "model-none", "model-elsewhere"]) await publish(name);
  // carol reports qwen3-coder and claude-sonnet-5-5 on another skill: two people in the registry then know them.
  assert.equal((await post(carol, "opencode", [fact("model-elsewhere", "pass", "qwen3-coder"), fact("model-elsewhere", "pass", "claude-sonnet-5-5")])).data.accepted, 2);
});

after(async () => {
  await srv?.stop();
});

test("a model is kept in lower case; a malformed one is dropped and the fact still counts", async () => {
  const long = "m".repeat(65);
  const r = await post(alice, "claude-code", [
    fact("model-format", "pass", "Claude-Opus-5-5"),
    fact("model-format", "pass", "bob's laptop"),
    fact("model-format", "pass", long),
    fact("model-format", "pass"),
  ]);
  assert.deepEqual(r.data, { accepted: 4, duplicates: 0, unknown: 0, rejected: 0 });
  assert.equal((await post(bob, "claude-code", [fact("model-format", "fail", "claude-opus-5-5")])).data.accepted, 1);
  const m = await metrics("model-format");
  assert.equal(m.sessions_count, 5);
  const opus = pick(m.by_model, "claude-code", "claude-opus-5-5");
  assert.ok(opus, JSON.stringify(m.by_model));
  assert.equal(opus.sessions_count, 2, "the mixed-case model is the same model");
  assert.equal(pick(m.by_model, "claude-code", null).sessions_count, 3, "the dropped models and the missing one");
  const text = JSON.stringify(m);
  assert.ok(!text.includes("laptop") && !text.includes(long), "a dropped model is in the response");
});

test("a repeated fact fills in a missing model without counting again", async () => {
  const f = fact("model-backfill", "pass");
  assert.equal((await post(alice, "claude-code", [f])).data.accepted, 1);
  const before = await metrics("model-backfill");
  assert.deepEqual(before.by_model, [], "no model yet");
  const again = await post(alice, "claude-code", [{ ...f, model: "claude-sonnet-5-5" }]);
  assert.deepEqual(again.data, { accepted: 0, duplicates: 1, unknown: 0, rejected: 0 });
  const after = await metrics("model-backfill");
  assert.equal(after.sessions_count, before.sessions_count);
  assert.deepEqual(after.verification, before.verification);
  const sonnet = pick(after.by_model, "claude-code", "claude-sonnet-5-5");
  assert.ok(sonnet, JSON.stringify(after.by_model));
  assert.equal(sonnet.sessions_count, 1);
  // A second repeat with another model does not overwrite it.
  await post(alice, "claude-code", [{ ...f, model: "claude-opus-5-5" }]);
  assert.ok(pick((await metrics("model-backfill")).by_model, "claude-code", "claude-sonnet-5-5"));
});

test("rows by agent and model: a model one person reported is not shown, a one-user row hides its shares", async () => {
  const S = "model-split";
  await post(alice, "claude-code", [fact(S, "pass", "claude-opus-5-5"), fact(S, "fail", "claude-opus-5-5"), fact(S, "pass", "e2e-only-alice")]);
  await post(bob, "claude-code", [fact(S, "pass", "claude-opus-5-5"), fact(S, "none")]);
  await post(alice, "opencode", [fact(S, "fail", "qwen3-coder")]);
  const m = await metrics(S);
  const rows = m.by_model.map((r) => ({ runtime: r.runtime, label: r.label, model: r.model, sessions_count: r.sessions_count, users_count: r.users_count, verification: r.verification }));
  assert.deepEqual(rows, [
    { runtime: "claude-code", label: "Claude Code", model: "claude-opus-5-5", sessions_count: 3, users_count: 2, verification: { pass: 2, fail: 1, none: 0, pass_rate: 0.667 } },
    { runtime: "claude-code", label: "Claude Code", model: null, sessions_count: 2, users_count: 2, verification: { pass: 1, fail: 0, none: 1, pass_rate: 1 } },
    { runtime: "opencode", label: "OpenCode", model: "qwen3-coder", sessions_count: 1, users_count: 1, verification: null },
  ]);
  for (const r of m.by_model) assert.match(r.last_used_at, /^2026-11-1\d/);
  assert.ok(!JSON.stringify(m).includes("e2e-only-alice"), "a model one person reported is in the response");
  assert.equal(m.by_runtime.length, 2, "by_runtime is unchanged by models");
});

test("facts without a shown model give no model rows", async () => {
  await post(alice, "claude-code", [fact("model-none", "pass"), fact("model-none", "pass", "only-one-person-model")]);
  const m = await metrics("model-none");
  assert.deepEqual(m.by_model, []);
  assert.equal(m.by_runtime.length, 1);
});
