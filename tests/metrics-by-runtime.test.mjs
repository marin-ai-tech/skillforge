// metrics-by-runtime: the artifact metrics split session facts by the agent they were imported from. A source that
// is a runtime id gets that agent's row and label; any other source string falls into one "other" row and is never
// echoed; a row of one user hides its verification shares when the artifact has more users.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, api as rawApi, login, createUser, ADMIN_PASSWORD } from "./lib/client.mjs";

let srv;
let base;
let alice, bob, carol;
const api = (method, path, body, who) => rawApi(base, method, path, body, who ? { cookie: who.cookie } : {});
let n = 0;
const fact = (skill, verification) => ({
  skill,
  session_key: (++n).toString(16).padStart(32, "0"),
  used_at: `2026-11-1${n % 5}T10:00:00.000Z`,
  verification,
});
const post = (who, source, facts) => api("POST", "/api/v1/me/session-facts", { source, facts }, who);
const metrics = (name) => api("GET", `/api/v1/artifacts/skill/${name}/metrics`, undefined, alice);

async function publish(name) {
  const md = `---\nname: ${name}\ndescription: Skill for the metrics by runtime test, split by agent.\n---\n\n# ${name}\n\nDo the task.\n`;
  const r = await api("POST", "/api/v1/artifacts", { type: "skill", files: [{ path: `${name}/SKILL.md`, content_base64: Buffer.from(md).toString("base64") }] }, alice);
  assert.equal(r.status, 201, JSON.stringify(r.data));
}

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-by-runtime-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  const admin = await login(base, "admin", ADMIN_PASSWORD);
  for (const u of ["alice", "bob", "carol"]) await createUser(base, admin.cookie, { username: u, password: `${u}-pw-123`, role: "contributor" });
  alice = await login(base, "alice", "alice-pw-123");
  bob = await login(base, "bob", "bob-pw-123");
  carol = await login(base, "carol", "carol-pw-123");
  for (const name of ["split-skill", "solo-skill", "unused-skill"]) await publish(name);

  const S = "split-skill";
  assert.equal((await post(alice, "claude-code", [fact(S, "pass"), fact(S, "pass"), fact(S, "fail")])).data.accepted, 3);
  assert.equal((await post(alice, "opencode", [fact(S, "fail")])).data.accepted, 1);
  assert.equal((await post(bob, "claude-code", [fact(S, "none")])).data.accepted, 1);
  assert.equal((await post(bob, "bob-laptop", [fact(S, "pass")])).data.accepted, 1);
  assert.equal((await post(bob, "another-script", [fact(S, "fail")])).data.accepted, 1);
  assert.equal((await post(carol, "opencode", [fact("solo-skill", "pass"), fact("solo-skill", "fail")])).data.accepted, 2);
});

after(async () => {
  await srv?.stop();
});

test("rows by agent: runtime id and label from the runtime table, one row for other sources, shares of one user hidden", async () => {
  const r = await metrics("split-skill");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const m = r.data;
  assert.equal(m.sessions_count, 7, "the totals are unchanged");
  assert.equal(m.users_count, 2);
  assert.deepEqual(m.by_runtime, [
    {
      runtime: "claude-code",
      label: "Claude Code",
      sessions_count: 4,
      users_count: 2,
      last_used_at: m.by_runtime[0].last_used_at,
      verification: { pass: 2, fail: 1, none: 1, pass_rate: 0.667 },
    },
    {
      runtime: "opencode",
      label: "OpenCode",
      sessions_count: 1,
      users_count: 1,
      last_used_at: m.by_runtime[1].last_used_at,
      verification: null,
    },
    {
      runtime: null,
      label: null,
      sessions_count: 2,
      users_count: 1,
      last_used_at: m.by_runtime[2].last_used_at,
      verification: null,
    },
  ]);
  for (const row of m.by_runtime) assert.match(row.last_used_at, /^2026-11-1\dT10:00:00/, JSON.stringify(row));
});

test("a source string sent by the client is never echoed; agents without facts have no row", async () => {
  const text = JSON.stringify((await metrics("split-skill")).data);
  assert.ok(!text.includes("bob-laptop"), "the raw source is in the response");
  assert.ok(!text.includes("another-script"), "the raw source is in the response");
  const runtimes = (await metrics("split-skill")).data.by_runtime.map((r) => r.runtime);
  for (const id of ["codex", "gemini", "cursor", "qwen", "devin", "reckon"]) assert.ok(!runtimes.includes(id), id);
});

test("an artifact with one user shows the shares in its agent row, as the panel does", async () => {
  const m = (await metrics("solo-skill")).data;
  assert.equal(m.users_count, 1);
  assert.equal(m.by_runtime.length, 1);
  assert.equal(m.by_runtime[0].runtime, "opencode");
  assert.deepEqual(m.by_runtime[0].verification, { pass: 1, fail: 1, none: 0, pass_rate: 0.5 });
  assert.deepEqual(m.by_runtime[0].verification, m.verification);
});

test("no facts, no rows", async () => {
  const m = (await metrics("unused-skill")).data;
  assert.deepEqual(m.by_runtime, []);
  assert.equal(m.sessions_count, 0);
});
