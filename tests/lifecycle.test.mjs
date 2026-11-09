// Acceptance tests for lifecycle governance.
// Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { startServer, api as rawApi, login, createUser, loadDir, toB64, FIXTURES, ADMIN_PASSWORD } from "./lib/client.mjs";

let srv;
let base;
let admin;
let rita;
let alice;
let bob;
const api = (method, path, body, auth) => rawApi(base, method, path, body, auth ?? { cookie: admin.cookie });
const transition = (type, name, body, auth) => api("POST", `/api/v1/artifacts/${type}/${name}/transitions`, body, auth ?? { cookie: rita.cookie });

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-lifecycle-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  await createUser(base, admin.cookie, { username: "rita", password: "rita-pw-123", role: "reviewer" });
  await createUser(base, admin.cookie, { username: "alice", password: "alice-pw-1", role: "contributor" });
  await createUser(base, admin.cookie, { username: "bob", password: "bob-pw-123", role: "viewer" });
  rita = await login(base, "rita", "rita-pw-123");
  alice = await login(base, "alice", "alice-pw-1");
  bob = await login(base, "bob", "bob-pw-123");
  for (const [type, dir, extra] of [
    ["skill", "skill-standard", {}],
    ["skill", "skill-e2e", {}],
    ["command", "command-propose", {}],
    ["agent", "agent-executor", {}],
    ["hook", "hook-guard", { name: "destructive-guard" }],
  ]) {
    const r = await api("POST", "/api/v1/artifacts", { type, ...extra, files: toB64(loadDir(join(FIXTURES, dir))) }, { cookie: alice.cookie });
    assert.equal(r.status, 201, `seed ${type}/${dir}: ${JSON.stringify(r.data)}`);
  }
});

after(async () => {
  if (srv?.up) await srv.stop();
});

test("roles: anonymous 401, viewer and contributor 403, reviewer 200 with audit", async () => {
  const anon = await transition("skill", "pdf-tools", { to: "active" }, {});
  assert.equal(anon.status, 401);
  const viewer = await transition("skill", "pdf-tools", { to: "active" }, { cookie: bob.cookie });
  assert.equal(viewer.status, 403);
  const contributor = await transition("skill", "pdf-tools", { to: "active" }, { cookie: alice.cookie });
  assert.equal(contributor.status, 403);
  const ok = await transition("skill", "pdf-tools", { to: "active", reason: "Reviewed procedure" });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.artifact.status, "active");
  assert.equal(ok.data.event.action, "transition");
  assert.equal(ok.data.event.from_status, "candidate");
  assert.equal(ok.data.event.to_status, "active");
  assert.equal(ok.data.event.reason, "Reviewed procedure");
  assert.equal(ok.data.event.actor, "rita");
  const audit = await api("GET", "/api/v1/artifacts/skill/pdf-tools/audit");
  assert.equal(audit.data.items[0].action, "transition");
  assert.equal(audit.data.items[0].to_status, "active");
  const card = await api("GET", "/api/v1/artifacts/skill/pdf-tools", undefined, { cookie: rita.cookie });
  assert.equal(card.data.artifact.status, "active");
  assert.ok(Array.isArray(card.data.allowed_transitions), "no allowed_transitions");
  assert.deepEqual([...card.data.allowed_transitions].sort(), ["aging", "retired", "zombie"]);
  const asAlice = await api("GET", "/api/v1/artifacts/skill/pdf-tools", undefined, { cookie: alice.cookie });
  assert.deepEqual(asAlice.data.allowed_transitions, []);
});

test("invalid transitions → 409 invalid_transition with from/to; admin can also transition", async () => {
  const same = await transition("skill", "pdf-tools", { to: "active" });
  assert.equal(same.status, 409);
  assert.equal(same.data.error, "invalid_transition");
  assert.equal(same.data.from, "active");
  assert.equal(same.data.to, "active");
  const bad = await transition("skill", "pdf-tools-e2e", { to: "aging" });
  assert.equal(bad.status, 409);
  assert.equal(bad.data.from, "candidate");
  const unknown = await transition("skill", "pdf-tools", { to: "archived" });
  assert.equal(unknown.status, 409);
  const missing = await transition("skill", "nope", { to: "active" });
  assert.equal(missing.status, 404);
  const byAdmin = await transition("skill", "pdf-tools-e2e", { to: "active" }, { cookie: admin.cookie });
  assert.equal(byAdmin.status, 200);
});

test("reason is required for retired and zombie; full path active → aging → zombie → retired → candidate", async () => {
  const noReason = await transition("skill", "pdf-tools", { to: "retired" });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.data.error, "reason_required");
  const tooLong = await transition("skill", "pdf-tools", { to: "retired", reason: "x".repeat(501) });
  assert.equal(tooLong.status, 400);
  for (const [to, reason] of [["aging", undefined], ["zombie", "No delta on Opus 5"], ["retired", "Superseded"], ["candidate", undefined]]) {
    const r = await transition("skill", "pdf-tools", reason ? { to, reason } : { to });
    assert.equal(r.status, 200, `${to}: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.artifact.status, to);
  }
  const zombieNoReason = await transition("skill", "pdf-tools-e2e", { to: "zombie" });
  assert.equal(zombieNoReason.status, 400);
  const audit = await api("GET", "/api/v1/artifacts/skill/pdf-tools/audit");
  const transitions = audit.data.items.filter((e) => e.action === "transition");
  assert.equal(transitions.length, 5);
  assert.equal(transitions[0].to_status, "candidate");
  assert.equal(transitions[0].from_status, "retired");
});

test("revalidate sets validated_at; version validate adds model_compat and audit", async () => {
  await transition("skill", "pdf-tools", { to: "active" });
  await transition("skill", "pdf-tools", { to: "aging" });
  const before = await api("GET", "/api/v1/artifacts/skill/pdf-tools/versions/latest");
  assert.equal(before.data.validated_at, null);
  const re = await transition("skill", "pdf-tools", { to: "active" });
  assert.equal(re.status, 200);
  const afterRe = await api("GET", "/api/v1/artifacts/skill/pdf-tools/versions/latest");
  assert.ok(afterRe.data.validated_at, "revalidate did not set validated_at");

  const forbidden = await api("POST", "/api/v1/artifacts/skill/pdf-tools/versions/latest/validate", { model_compat: ["opus-5"] }, { cookie: alice.cookie });
  assert.equal(forbidden.status, 403);
  const v = await api("POST", "/api/v1/artifacts/skill/pdf-tools/versions/0.1.0/validate", { model_compat: ["opus-5", "opus-5"], note: "Passed eval suite" }, { cookie: rita.cookie });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  assert.deepEqual(v.data.model_compat, ["opus-5"]);
  assert.ok(v.data.validated_at);
  const again = await api("POST", "/api/v1/artifacts/skill/pdf-tools/versions/0.1.0/validate", { model_compat: ["sonnet-5"] }, { cookie: rita.cookie });
  assert.deepEqual(again.data.model_compat, ["opus-5", "sonnet-5"]);
  const audit = await api("GET", "/api/v1/artifacts/skill/pdf-tools/audit");
  const val = audit.data.items.find((e) => e.action === "validate");
  assert.ok(val, "no validate record");
  assert.equal(val.version, "0.1.0");
  assert.equal(val.reason, "Passed eval suite");
  assert.deepEqual(val.meta.model_compat, ["opus-5"]);
});

test("board: sections and counters", async () => {
  await transition("skill", "pdf-tools", { to: "aging" });
  await transition("skill", "pdf-tools-e2e", { to: "zombie", reason: "Unused" });
  await transition("agent", "handoff-executor", { to: "active" });
  await transition("agent", "handoff-executor", { to: "retired", reason: "Replaced" });
  const b = await api("GET", "/api/v1/lifecycle/board");
  assert.equal(b.status, 200);
  for (const k of ["review", "stale_candidates", "aging", "zombie", "retired_recent", "counts"]) assert.ok(k in b.data, `no ${k}`);
  assert.deepEqual(b.data.review.map((a) => a.name).sort(), ["destructive-guard", "propose"]);
  assert.deepEqual(b.data.aging.map((a) => a.name), ["pdf-tools"]);
  assert.deepEqual(b.data.zombie.map((a) => a.name), ["pdf-tools-e2e"]);
  assert.deepEqual(b.data.retired_recent.map((a) => a.name), ["handoff-executor"]);
  assert.deepEqual(b.data.counts, { candidate: 2, active: 0, aging: 1, zombie: 1, retired: 1 });
  assert.equal(b.data.stale_candidates.length, 0);
  const anon = await api("GET", "/api/v1/lifecycle/board", undefined, {});
  assert.equal(anon.status, 200, "board is readable under the PUBLIC_READ rule");
});

test("sweep: AGING_DAYS=0 ages active immediately from the system actor; admin-only; fresh validation protects at AGING_DAYS=1", async () => {
  const zero = await startServer({ SKILLFORGE_AGING_DAYS: "0" }, { prefix: "skillforge-aging0-" });
  assert.ok(zero.up, zero.stderr);
  try {
    const a = await login(zero.base, "admin", ADMIN_PASSWORD);
    const pub = await rawApi(zero.base, "POST", "/api/v1/artifacts", { type: "skill", files: toB64(loadDir(join(FIXTURES, "skill-standard"))) }, { cookie: a.cookie });
    assert.equal(pub.status, 201);
    // self-promotion-guard: admin promotes its own publication only with a reason.
    const promoted = await rawApi(zero.base, "POST", "/api/v1/artifacts/skill/pdf-tools/transitions", { to: "active", reason: "fixture" }, { cookie: a.cookie });
    assert.equal(promoted.status, 200, JSON.stringify(promoted.data));
    const forbidden = await rawApi(zero.base, "POST", "/api/v1/admin/lifecycle/sweep", undefined, {});
    assert.equal(forbidden.status, 401);
    const sweep = await rawApi(zero.base, "POST", "/api/v1/admin/lifecycle/sweep", undefined, { cookie: a.cookie });
    assert.equal(sweep.status, 200, JSON.stringify(sweep.data));
    assert.equal(sweep.data.aged, 1);
    const card = await rawApi(zero.base, "GET", "/api/v1/artifacts/skill/pdf-tools");
    assert.equal(card.data.artifact.status, "aging");
    const audit = await rawApi(zero.base, "GET", "/api/v1/artifacts/skill/pdf-tools/audit");
    assert.equal(audit.data.items[0].actor, "system");
    assert.equal(audit.data.items[0].reason, "aging policy");
    const again = await rawApi(zero.base, "POST", "/api/v1/admin/lifecycle/sweep", undefined, { cookie: a.cookie });
    assert.equal(again.data.aged, 0);
  } finally {
    await zero.stop();
  }

  const one = await startServer({ SKILLFORGE_AGING_DAYS: "1" }, { prefix: "skillforge-aging1-" });
  assert.ok(one.up, one.stderr);
  try {
    const a = await login(one.base, "admin", ADMIN_PASSWORD);
    await rawApi(one.base, "POST", "/api/v1/artifacts", { type: "skill", files: toB64(loadDir(join(FIXTURES, "skill-standard"))) }, { cookie: a.cookie });
    await rawApi(one.base, "POST", "/api/v1/artifacts/skill/pdf-tools/transitions", { to: "active", reason: "fixture" }, { cookie: a.cookie });
    await rawApi(one.base, "POST", "/api/v1/artifacts/skill/pdf-tools/versions/latest/validate", { note: "fresh" }, { cookie: a.cookie });
    const sweep = await rawApi(one.base, "POST", "/api/v1/admin/lifecycle/sweep", undefined, { cookie: a.cookie });
    assert.equal(sweep.data.aged, 0);
    assert.equal((await rawApi(one.base, "GET", "/api/v1/artifacts/skill/pdf-tools")).data.artifact.status, "active");
  } finally {
    await one.stop();
  }

  const bad = await startServer({ SKILLFORGE_AGING_DAYS: "soon" }, { prefix: "skillforge-agingbad-" });
  assert.equal(bad.up, false);
  assert.ok(bad.stderr.includes("SKILLFORGE_AGING_DAYS"), bad.stderr);
});
