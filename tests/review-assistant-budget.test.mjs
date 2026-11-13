// llm-budget-broker: review-assistant runs paid from an Agent Space task budget. The broker is tests/lib/fake-llm.mjs on
// a Unix socket; the plugin is the real `plugins/review-assistant` (bundled). A budget context is
// { budget_grant, request_id, budget_grant_id }: the grant is a secret held only in memory, the ids are stored.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { startServer, api, login, createUser, toB64, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";
import { startFakeLlm } from "./lib/fake-llm.mjs";

const WIN = process.platform === "win32";
const EXT = "/api/v1/ext/review-assistant";
const SECRET = `as_sf_${"S".repeat(18)}BudgetMarker${"q".repeat(13)}`;
let work;
let broker;
let srv;
let env;
const auth = {};

const skip = WIN && "Unix sockets";
const call = (method, path, body, who = auth.admin) => api(srv.base, method, path, body, who ? { cookie: who.cookie } : {});
const ctx = () => ({ budget_grant: SECRET, request_id: `bg-${randomBytes(32).toString("hex")}`, budget_grant_id: randomUUID() });
const skillMd = (name) =>
  `---\nname: ${name}\ndescription: Keeps release notes up to date. Use when a release is being prepared.\n---\n\n# ${name}\n\nAlways use the latest version of the changelog tool.\n`;
async function publishSkill(name, who = auth.alice) {
  const r = await call("POST", "/api/v1/artifacts", { type: "skill", files: toB64([{ path: `${name}/SKILL.md`, content: skillMd(name) }]) }, who);
  assert.equal(r.status, 201, JSON.stringify(r.data));
}
async function until(fn, timeout = 30000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) assert.fail("timed out waiting");
    await new Promise((r) => setTimeout(r, 150));
  }
}
const runOf = async (id) => (await call("GET", `${EXT}/runs/${id}`)).data.run;
const finished = (id) => until(async () => {
  const r = await runOf(id);
  return ["done", "failed", "interrupted"].includes(r?.status) ? r : null;
});
const settle = async (name) => until(async () => {
  const items = (await call("GET", `${EXT}/artifacts/skill/${name}/runs`)).data.items;
  return items.length && items.every((x) => ["done", "failed"].includes(x.status)) ? items : null;
});
const grantHeaders = () => broker.chatRequests().map((r) => r.headers["x-agent-space-grant"]).filter(Boolean);

before(async () => {
  if (WIN) return;
  work = mkdtempSync(join(tmpdir(), "skillforge-rabudget-"));
  broker = await startFakeLlm({ socket: join(work, "broker.sock") });
  broker.setReply(JSON.stringify({ findings: [] }));
  env = {
    SKILLFORGE_BUDGET_SOCKET: join(work, "broker.sock"),
    SKILLFORGE_BUNDLED_PLUGINS_DIR: join(ROOT, "plugins"),
    SKILLFORGE_REVIEWERS_FILE: join(work, "no-such-reviewers.json"),
  };
  // The test owns the data directory: a server started without `dataDir` removes its own directory on stop, and the
  // restart below would come up on an empty database (no sessions, no runs).
  srv = await startServer(env, { dataDir: mkdtempSync(join(tmpdir(), "skillforge-rabudget-srv-")) });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  auth.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [["alice", "contributor"], ["rita", "reviewer"], ["rob", "reviewer"]]) {
    await createUser(srv.base, auth.admin.cookie, { username: u, password: `${u}-pw-123456`, role });
    auth[u] = await login(srv.base, u, `${u}-pw-123456`);
  }
  const put = await call("PUT", "/api/v1/admin/llm", { base_url: "https://api.deepseek.com/v1", model: "deepseek-chat" });
  assert.equal(put.data.validation.active, true, JSON.stringify(put.data));
  await publishSkill("budget-a");
  await publishSkill("budget-b");
  await settle("budget-a");
  await settle("budget-b");
});

after(async () => {
  await srv?.stop();
  if (srv?.dataDir) rmSync(srv.dataDir, { recursive: true, force: true }); // servers started with `dataDir` keep it
  await broker?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("a validation run with a budget context is idempotent and conflicts are refused", { skip }, async () => {
  const c = ctx();
  const first = await call("POST", `${EXT}/validation/runs`, { type: "skill", name: "budget-a", version: "0.1.0", ...c }, auth.rita);
  assert.equal(first.status, 202, JSON.stringify(first.data));
  assert.equal(first.data.run.request_id, c.request_id);
  assert.equal(first.data.run.budget_grant_id, c.budget_grant_id);
  assert.ok(!JSON.stringify(first.data).includes(SECRET), "the grant is in the answer");
  const run = await finished(first.data.run.id);
  assert.equal(run.status, "done", JSON.stringify(run));
  assert.ok(grantHeaders().includes(`${SECRET}.${c.budget_grant_id}`), "the model call did not carry <grant>.<grant id>");

  const calls = broker.chatRequests().length;
  const again = await call("POST", `${EXT}/validation/runs`, { type: "skill", name: "budget-a", version: "0.1.0", ...c }, auth.rita);
  assert.equal(again.status, 200);
  assert.equal(again.data.run.id, run.id);
  assert.equal(broker.chatRequests().length, calls, "a repeat called the model again");

  const conflict = await call("POST", `${EXT}/validation/runs`, { type: "skill", name: "budget-a", version: "0.1.0", ...c, budget_grant_id: randomUUID() }, auth.rita);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.error, "request_conflict");
});

test("a broken budget context is refused at the boundary", { skip }, async () => {
  const base = { type: "skill", name: "budget-a", version: "0.1.0" };
  for (const bad of [
    { ...ctx(), request_id: "bg-123" },
    { ...ctx(), budget_grant_id: "not-a-uuid" },
    { request_id: ctx().request_id, budget_grant_id: randomUUID() },
    { ...ctx(), budget_grant: "as_sf_short" },
  ]) {
    const r = await call("POST", `${EXT}/validation/runs`, { ...base, ...bad }, auth.rita);
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
});

test("a run is found by its request id only by its author", { skip }, async () => {
  const c = ctx();
  const r = await call("POST", `${EXT}/validation/runs`, { type: "skill", name: "budget-b", version: "0.1.0", ...c }, auth.rita);
  await finished(r.data.run.id);
  const mine = await call("GET", `${EXT}/validation/by-request/${c.request_id}`, undefined, auth.rita);
  assert.equal(mine.status, 200);
  assert.equal(mine.data.run.id, r.data.run.id);
  assert.equal((await call("GET", `${EXT}/validation/by-request/${c.request_id}`, undefined, auth.rob)).status, 404);
  assert.equal((await call("GET", `${EXT}/validation/by-request/${c.request_id}`, undefined, auth.alice)).status, 403);
});

test("a check bound to a coming publication runs when that version is published", { skip }, async () => {
  const c = ctx();
  const bind = await call("POST", `${EXT}/validation/publication-bindings`, { name: "budget-c", version: "0.1.0", ...c }, auth.rita);
  assert.equal(bind.status, 202, JSON.stringify(bind.data));
  assert.equal(bind.data.run.status, "awaiting_publication");
  await publishSkill("budget-c", auth.rita);
  const run = await finished(bind.data.run.id);
  assert.equal(run.status, "done", JSON.stringify(run));
  assert.ok(grantHeaders().includes(`${SECRET}.${c.budget_grant_id}`));

  const late = await call("POST", `${EXT}/validation/publication-bindings`, { name: "budget-a", version: "0.1.0", ...ctx() }, auth.rita);
  assert.equal(late.status, 409);
  assert.equal(late.data.error, "version_already_published");
});

test("backfill by a list: limits and duplicates refuse the whole list", { skip }, async () => {
  const item = (name) => ({ name, version: "0.1.0", ...ctx() });
  const runsBefore = (await call("GET", `${EXT}/artifacts/skill/budget-a/runs`)).data.items.length;
  const many = Array.from({ length: 21 }, () => item("budget-a"));
  assert.equal((await call("POST", `${EXT}/validation/backfill`, { items: many })).status, 400);
  const dup = item("budget-a");
  const twice = await call("POST", `${EXT}/validation/backfill`, { items: [dup, { ...item("budget-b"), request_id: dup.request_id }] });
  assert.equal(twice.status, 400);
  assert.equal(twice.data.error, "invalid_backfill_items");
  assert.equal((await call("GET", `${EXT}/artifacts/skill/budget-a/runs`)).data.items.length, runsBefore, "a refused list created runs");

  const ok = await call("POST", `${EXT}/validation/backfill`, { items: [item("budget-a"), item("budget-b")] });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.queued, 2);
  for (const r of ok.data.runs) assert.equal((await finished(r.id)).status, "done");
});

test("after a restart a budget run is interrupted and resumes only for its author with a new grant id", { skip }, async () => {
  const c = ctx();
  broker.next("hang");
  const r = await call("POST", `${EXT}/validation/runs`, { type: "skill", name: "budget-b", version: "0.1.0", ...c }, auth.rita);
  assert.equal(r.status, 202, JSON.stringify(r.data));
  await until(async () => (await runOf(r.data.run.id)).status === "running");
  await publishSkill("budget-d"); // its check (no request id) waits in the queue behind the hanging run

  await srv.stop();
  srv = await startServer(env, { dataDir: srv.dataDir });
  assert.ok(srv.up, srv.stderr);

  // Plugin routes are registered shortly after /health answers: wait for the run instead of reading it once.
  const interrupted = await until(async () => {
    const run = await runOf(r.data.run.id);
    return run?.status ? run : null;
  });
  assert.equal(interrupted.status, "interrupted");
  const plain = (await call("GET", `${EXT}/artifacts/skill/budget-d/runs`)).data.items;
  assert.ok(plain.every((x) => x.status === "failed"), JSON.stringify(plain));

  const next = { request_id: c.request_id, budget_grant: SECRET, budget_grant_id: randomUUID() };
  assert.equal((await call("POST", `${EXT}/validation/runs/${r.data.run.id}/resume`, next, auth.rob)).status, 404);
  const resumed = await call("POST", `${EXT}/validation/runs/${r.data.run.id}/resume`, next, auth.rita);
  assert.equal(resumed.status, 202, JSON.stringify(resumed.data));
  assert.equal(resumed.data.run.budget_grant_id, next.budget_grant_id);
  assert.equal((await finished(r.data.run.id)).status, "done");
  const repeat = await call("POST", `${EXT}/validation/runs/${r.data.run.id}/resume`, next, auth.rita);
  assert.equal(repeat.status, 200);
});

// fix-broker-grant-refusal: a run that failed keeps its reason; a refused grant is named as such.
test("a check whose grant the broker refuses: failed with error budget_grant_rejected", { skip }, async () => {
  broker.next("error403");
  const r = await call("POST", `${EXT}/validation/runs`, { type: "skill", name: "budget-a", version: "0.1.0", ...ctx() }, auth.rita);
  assert.equal(r.status, 202, JSON.stringify(r.data));
  const run = await finished(r.data.run.id);
  assert.equal(run.status, "failed", JSON.stringify(run));
  assert.equal(run.error, "budget_grant_rejected", JSON.stringify(run));
  assert.equal(run.reviewers[0].error, "budget_grant_rejected");
});

test("the grant is stored nowhere", { skip }, async () => {
  const db = new DatabaseSync(join(srv.dataDir, "skillforge.db"), { readOnly: true });
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) {
    assert.ok(!JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all()).includes(SECRET), `table ${name} holds the grant`);
  }
  db.close();
  assert.ok(!srv.stdout.includes(SECRET) && !srv.stderr.includes(SECRET), "the server log holds the grant");
});
