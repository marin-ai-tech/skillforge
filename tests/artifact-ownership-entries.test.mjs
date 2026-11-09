// Part A: the publish rule cannot be bypassed through any publish entry point. A foreign contributor tries to
// publish an existing artifact through the agent snapshot and through import — each must get failed/not_owner.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { startServer, api as rawApi, login, createUser, loadDir, toB64, FIXTURES, ADMIN_PASSWORD } from "./lib/client.mjs";

let srv;
let base;
let admin;
let alice; // contributor, owner of pdf-tools
let bob; // contributor, not the owner
const api = (method, path, body, auth) => rawApi(base, method, path, body, auth ?? { cookie: alice.cookie });

const skillFiles = loadDir(join(FIXTURES, "skill-standard"));

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-ownership-entries-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  for (const [username, role] of [["alice", "contributor"], ["bob", "contributor"]]) {
    await createUser(base, admin.cookie, { username, password: `${username}-pw-123`, role });
  }
  alice = await login(base, "alice", "alice-pw-123");
  bob = await login(base, "bob", "bob-pw-123");
});

after(async () => {
  await srv?.stop();
});

test("alice's first publish creates pdf-tools", async () => {
  const r = await api("POST", "/api/v1/artifacts", { type: "skill", files: toB64(skillFiles) });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const card = await api("GET", "/api/v1/artifacts/skill/pdf-tools");
  assert.equal(card.data.artifact.owner, "alice");
});

test("agent snapshot: a foreign contributor publishing an existing artifact → 403 not_owner", async () => {
  const put = await api("PUT", "/api/v1/me/agents/bob-agent", { runtime: "claude-code", files: toB64(skillFiles) }, { cookie: bob.cookie });
  assert.equal(put.status, 200, JSON.stringify(put.data));

  const r = await api(
    "POST",
    "/api/v1/me/agents/bob-agent/items/skill/pdf-tools/publish",
    {},
    { cookie: bob.cookie },
  );
  assert.equal(r.status, 403, JSON.stringify(r.data));
  assert.equal(r.data.error, "not_owner");
  assert.equal(r.data.owner, "alice");
});

test("import: preview reports not_owner, run — failed/skipped with reason and owner", async () => {
  const files = toB64(loadDir(join(FIXTURES, "skill-standard")).map((f) => ({
    path: `bundle/${f.path}`,
    content: f.path.endsWith("SKILL.md") ? Buffer.from(f.content.toString("utf8") + "\n# bob's own edit\n") : f.content,
  })));
  const preview = await api("POST", "/api/v1/imports/preview", { source: { kind: "files", files } }, { cookie: bob.cookie });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  const skill = preview.data.candidates.find((c) => c.id === "skill/pdf-tools");
  assert.ok(skill, "no candidate skill/pdf-tools: " + JSON.stringify(preview.data.candidates.map((c) => c.id)));
  // the ownership conflict is visible already on preview, not only on run
  assert.ok(skill.dry_run.conflicts.includes("not_owner"), JSON.stringify(skill.dry_run));

  const run = await api(
    "POST",
    "/api/v1/imports/run",
    { import_id: preview.data.import_id, selected: ["skill/pdf-tools"], skip_conflicts: false },
    { cookie: bob.cookie },
  );
  assert.equal(run.status, 200, JSON.stringify(run.data));
  const res = run.data.results[0];
  assert.ok(res, JSON.stringify(run.data));
  assert.equal(res.status, "failed");
  assert.equal(res.reason, "not_owner");
  assert.equal(res.owner, "alice");

  const preview2 = await api("POST", "/api/v1/imports/preview", { source: { kind: "files", files } }, { cookie: bob.cookie });
  const run2 = await api(
    "POST",
    "/api/v1/imports/run",
    { import_id: preview2.data.import_id, selected: ["skill/pdf-tools"] },
    { cookie: bob.cookie },
  );
  const res2 = run2.data.results[0];
  assert.equal(res2.status, "skipped");
  assert.equal(res2.reason, "not_owner");
  assert.equal(res2.owner, "alice");
});
