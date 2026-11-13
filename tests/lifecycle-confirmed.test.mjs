// rule-artifacts: an artifact in `aging` whose latest version was confirmed after it aged (`validate` by a reviewer or
// a `gate` evidence by the owner) returns to `active` on the next sweep, with rule "confirmed" in the audit. Without a
// fresh confirmation it stays in aging; a lifecycle hold stops the return like any other automatic transition.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { startServer, api, login, createUser, ADMIN_PASSWORD } from "./lib/client.mjs";

let srv;
const auth = {};
const call = (method, path, body, who = auth.admin) => api(srv.base, method, path, body, who ? { cookie: who.cookie } : {});
const rule = (name) => `---\nname: ${name}\ndescription: Keeps secrets out of logs.\n---\n\nNever write secrets to logs.\n`;
const status = async (name) => (await call("GET", `/api/v1/artifacts/rule/${name}`)).data.artifact.status;
const sweep = async () => {
  const r = await call("POST", "/api/v1/admin/lifecycle/sweep", { dry_run: false });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};

async function publishActive(name) {
  const p = await call("POST", "/api/v1/artifacts", { type: "rule", files: [{ path: `rules/${name}.md`, content_base64: Buffer.from(rule(name)).toString("base64") }] }, auth.alice);
  assert.equal(p.status, 201, JSON.stringify(p.data));
  const t = await call("POST", `/api/v1/artifacts/rule/${name}/transitions`, { to: "active", reason: "lifecycle test" });
  assert.equal(t.status, 200, JSON.stringify(t.data));
}

before(async () => {
  srv = await startServer({ SKILLFORGE_AGING_DAYS: "0" }, { prefix: "skillforge-confirmed-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  auth.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  await createUser(srv.base, auth.admin.cookie, { username: "alice", password: "alice-pw-123456", role: "contributor" });
  auth.alice = await login(srv.base, "alice", "alice-pw-123456");
  for (const n of ["confirmed-rule", "silent-rule", "held-rule"]) await publishActive(n);
  await new Promise((r) => setTimeout(r, 1100)); // activity strictly before the aging transition
  await sweep();
  for (const n of ["confirmed-rule", "silent-rule", "held-rule"]) assert.equal(await status(n), "aging", n);
  await new Promise((r) => setTimeout(r, 1100)); // the confirmation strictly after it
});

after(async () => {
  if (srv?.up) await srv.stop();
});

test("the owner's gate evidence after aging brings a rule back to active, audited as confirmed", async () => {
  const ev = await call("POST", "/api/v1/artifacts/rule/confirmed-rule/versions/0.1.0/evidence", { kind: "gate", url: "https://ci.example/run/1" }, auth.alice);
  assert.ok([200, 201].includes(ev.status), JSON.stringify(ev.data));
  await sweep();
  assert.equal(await status("confirmed-rule"), "active");
  const db = new DatabaseSync(join(srv.dataDir, "skillforge.db"), { readOnly: true });
  const rows = db.prepare("SELECT * FROM audit_events WHERE action = 'transition' AND to_status = 'active'").all();
  db.close();
  const meta = (row) => (typeof row.meta === "string" ? JSON.parse(row.meta) : (row.meta ?? {}));
  assert.ok(rows.some((row) => meta(row).rule === "confirmed"), JSON.stringify(rows));
});

test("without a fresh confirmation the rule stays in aging", async () => {
  await sweep();
  assert.equal(await status("silent-rule"), "aging");
});

test("a lifecycle hold stops the return", async () => {
  const until = new Date(Date.now() + 86_400_000).toISOString();
  const hold = await call("PUT", "/api/v1/artifacts/rule/held-rule/lifecycle-hold", { until, reason: "keep it as is for the test" });
  assert.equal(hold.status, 200, JSON.stringify(hold.data));
  await call("POST", "/api/v1/artifacts/rule/held-rule/versions/0.1.0/evidence", { kind: "gate", url: "https://ci.example/run/2" }, auth.alice);
  await sweep();
  assert.equal(await status("held-rule"), "aging");
});
