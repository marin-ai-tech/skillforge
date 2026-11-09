// Acceptance tests for lifecycle-by-data, part A.
// Requires `npm run build`.
// Each scenario starts its own server with the required thresholds (zero thresholds mean "immediately"); time is not faked.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { startServer, api as rawApi, login, createUser, loadDir, toB64, FIXTURES, ADMIN_PASSWORD } from "./lib/client.mjs";

const servers = [];
after(async () => {
  for (const s of servers) await s.stop?.();
});

const skillFiles = loadDir(join(FIXTURES, "skill-standard"));
const files = (name) =>
  skillFiles.map((f) => ({
    path: f.path.replace("pdf-tools", name),
    content: f.path.endsWith("SKILL.md") ? Buffer.from(f.content.toString("utf8").replace(/^name: pdf-tools$/m, `name: ${name}`)) : f.content,
  }));
const HEX = (n) => n.toString(16).padStart(32, "0");
let keyN = 1;

async function boot(env = {}) {
  const srv = await startServer({ SKILLFORGE_AGING_DAYS: "3650", SKILLFORGE_ZOMBIE_WINDOW_DAYS: "30", SKILLFORGE_ZOMBIE_RETIRE_DAYS: "0", ...env }, { prefix: "skillforge-lcd-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  servers.push(srv);
  const U = {};
  U.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [["alice", "contributor"], ["bob", "contributor"], ["rita", "reviewer"], ["r1", "contributor"], ["r2", "contributor"], ["r3", "contributor"]]) {
    await createUser(srv.base, U.admin.cookie, { username: u, password: `${u}-pw-123`, role });
    U[u] = await login(srv.base, u, `${u}-pw-123`);
  }
  const api = (method, path, body, who = "admin") => rawApi(srv.base, method, path, body, who === "anon" ? {} : { cookie: U[who].cookie });
  const A = (n) => `/api/v1/artifacts/skill/${n}`;
  const h = {
    srv, api, U, A,
    publish: async (name, who = "alice") => {
      const r = await api("POST", "/api/v1/artifacts", { type: "skill", files: toB64(files(name)) }, who);
      assert.equal(r.status, 201, JSON.stringify(r.data));
      assert.equal((await api("POST", `${A(name)}/transitions`, { to: "active", reason: "go" }, "rita")).status, 200);
    },
    usage: async (name, who, uses, helped) => {
      const r = await api("POST", `${A(name)}/usage`, { uses, helped }, who);
      assert.equal(r.status, 201, `usage ${who}: ${JSON.stringify(r.data)}`);
    },
    fact: async (name, who = "alice", offsetMs = 3600000) => {
      const r = await api("POST", "/api/v1/me/session-facts", { source: "claude-code", facts: [{ skill: name, session_key: HEX(keyN++), used_at: new Date(Date.now() + offsetMs).toISOString(), verification: "none" }] }, who);
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.equal(r.data.accepted, 1);
    },
    ablation: async (name, data, who = "alice") => api("POST", `${A(name)}/versions/0.1.0/evidence`, { kind: "ablation", url: `https://runs.example/${name}/${keyN++}`, data }, who),
    sweep: (body = {}, who = "admin") => api("POST", "/api/v1/admin/lifecycle/sweep", body, who),
    status: async (name) => (await api("GET", A(name))).data.artifact.status,
    audit: async (name) => (await api("GET", `${A(name)}/audit`)).data.items,
    settle: () => new Promise((r) => setTimeout(r, 60)),
  };
  return h;
}

test("policy and configuration: defaults, permissions, a wrong variable stops startup", async () => {
  const h = await boot({ SKILLFORGE_AGING_DAYS: "90" });
  const p = await h.api("GET", "/api/v1/admin/lifecycle/policy");
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.deepEqual(
    { enabled: p.data.enabled, aging_days: p.data.aging_days, zombie_idle_days: p.data.zombie_idle_days, zombie_min_uses: p.data.zombie_min_uses, zombie_min_reporters: p.data.zombie_min_reporters, zombie_transfer_rate: p.data.zombie_transfer_rate, ablation_min_tasks: p.data.ablation_min_tasks, revive_min_events: p.data.revive_min_events, max_per_sweep: p.data.max_per_sweep },
    { enabled: true, aging_days: 90, zombie_idle_days: 180, zombie_min_uses: 20, zombie_min_reporters: 3, zombie_transfer_rate: 0.2, ablation_min_tasks: 10, revive_min_events: 3, max_per_sweep: 20 },
  );
  assert.equal((await h.api("GET", "/api/v1/admin/lifecycle/policy", undefined, "alice")).status, 403);
  assert.equal((await h.api("GET", "/api/v1/admin/lifecycle/policy", undefined, "anon")).status, 401);
  const bad = await startServer({ SKILLFORGE_ZOMBIE_TRANSFER_RATE: "2" }, { prefix: "skillforge-lcd-bad-" });
  assert.equal(bad.up, false, "the server must not start with a wrong threshold");
  assert.ok(String(bad.stderr).includes("SKILLFORGE_ZOMBIE_TRANSFER_RATE"), bad.stderr);
});

test("aging by usage: a fresh session fact keeps an artifact from aging; without usage it ages as before", async () => {
  const h = await boot({ SKILLFORGE_AGING_DAYS: "0" });
  await h.publish("quiet");
  await h.publish("busy");
  await h.fact("busy");
  await h.settle();
  const r = await h.sweep();
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.aged, 1, "the previous aged field is kept");
  assert.equal(await h.status("quiet"), "aging");
  assert.equal(await h.status("busy"), "active", "usage extends life");
  const ev = (await h.audit("quiet")).find((e) => e.to_status === "aging");
  assert.equal(ev.actor, "system");
  assert.equal(ev.reason, "aging policy");
});

test("zombie by low_transfer: three authors, capped contribution, poisoning by one author does not work, audit, notification, no automatic way back", async () => {
  const h = await boot({ SKILLFORGE_ZOMBIE_MIN_USES: "20", SKILLFORGE_ZOMBIE_MIN_REPORTERS: "3", SKILLFORGE_ZOMBIE_TRANSFER_RATE: "0.2" });
  for (const n of ["bad-skill", "poisoned", "good-skill", "mixed"]) await h.publish(n);
  // bad-skill: three authors, almost never helped
  await h.usage("bad-skill", "r1", 20, 0);
  await h.usage("bad-skill", "r2", 20, 1);
  await h.usage("bad-skill", "r3", 20, 0);
  // poisoned: one author floods with zeros — the rule must not fire (at least 3 authors are needed)
  await h.usage("poisoned", "bob", 100000, 0);
  await h.usage("poisoned", "r1", 100000, 0);
  // good-skill: three authors, helps
  for (const r of ["r1", "r2", "r3"]) await h.usage("good-skill", r, 20, 18);
  // mixed: one malicious author with huge zeros + two honest ones with a good result — the contribution is capped
  await h.usage("mixed", "bob", 100000, 0);
  await h.usage("mixed", "r2", 20, 20);
  await h.usage("mixed", "r3", 20, 20);

  const sig = await h.api("GET", `${h.A("mixed")}/lifecycle`);
  assert.equal(sig.status, 200, JSON.stringify(sig.data));
  assert.equal(sig.data.signals.reporters_window, 3);
  assert.ok(sig.data.signals.transfer_rate_window > 0.5, `the robust rate must be high: ${sig.data.signals.transfer_rate_window}`);
  assert.equal(sig.data.would_transition, null);
  const wt = (await h.api("GET", `${h.A("bad-skill")}/lifecycle`)).data.would_transition;
  assert.deepEqual({ to: wt.to, rule: wt.rule }, { to: "zombie", rule: "low_transfer" });

  const r = await h.sweep();
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.zombied, 1, JSON.stringify(r.data));
  assert.equal(await h.status("bad-skill"), "zombie");
  for (const n of ["poisoned", "good-skill", "mixed"]) assert.equal(await h.status(n), "active", `${n} must not become zombie`);

  const ev = (await h.audit("bad-skill")).find((e) => e.to_status === "zombie");
  assert.equal(ev.actor, "system");
  assert.match(ev.reason, /zombie policy: low_transfer/);
  assert.equal(ev.meta.rule, "low_transfer");
  assert.equal(ev.meta.metrics.reporters, 3);
  assert.ok(ev.meta.metrics.transfer_rate < 0.2);
  const note = (await h.api("GET", "/api/v1/me/notifications?limit=200", undefined, "alice")).data.items.find((n) => n.kind === "status_change" && n.artifact?.name === "bad-skill");
  assert.ok(note, "the owner is notified of the move to zombie");

  // good reports later — we do not return from zombie automatically
  for (const r2 of ["r1", "r2", "r3"]) await h.usage("bad-skill", r2, 20, 20).catch(() => {});
  await h.fact("bad-skill");
  await h.sweep();
  assert.equal(await h.status("bad-skill"), "zombie", "zombie is not returned automatically");

  // a fresh candidate (younger than SKILLFORGE_CANDIDATE_TTL_DAYS) is not "what to remove today" (not every candidate may appear)
  assert.equal((await h.api("POST", "/api/v1/artifacts", { type: "skill", files: toB64(files("fresh-cand")) }, "alice")).status, 201);
  // board: reasons for the reviewer, empty for others; old sections stay in place
  const board = (await h.api("GET", "/api/v1/lifecycle/board", undefined, "rita")).data;
  assert.equal(board.cleanup.some((c) => c.name === "fresh-cand" || c.status === "candidate"), false, "a fresh candidate is not in cleanup");
  const item = board.cleanup.find((c) => c.name === "bad-skill");
  assert.ok(item, JSON.stringify(board.cleanup));
  assert.equal(item.reasons[0].code, "low_transfer");
  assert.equal(item.suggested_action, "retire", "SKILLFORGE_ZOMBIE_RETIRE_DAYS=0");
  assert.ok(typeof item.reasons[0].metrics.uses === "number");
  assert.deepEqual((await h.api("GET", "/api/v1/lifecycle/board", undefined, "alice")).data.cleanup, []);
  assert.deepEqual((await h.api("GET", "/api/v1/lifecycle/board", undefined, "anon")).data.cleanup, []);
  assert.ok(board.zombie.some((a) => a.name === "bad-skill") && board.counts.zombie >= 1);
});

test("ablation as evidence: boundaries, uplift, version and metric fields; the no_ablation_uplift rule", async () => {
  const h = await boot({ SKILLFORGE_ABLATION_MIN_TASKS: "10" });
  for (const n of ["no-uplift", "few-tasks", "uplifts"]) await h.publish(n);

  for (const bad of [undefined, { tasks: 0, passed_with: 0, passed_without: 0 }, { tasks: 10, passed_with: 11, passed_without: 0 }, { tasks: 10, passed_with: 1, passed_without: -1 }, { tasks: 10.5, passed_with: 1, passed_without: 1 }, { tasks: 1001, passed_with: 1, passed_without: 1 }, { tasks: "10", passed_with: 1, passed_without: 1 }, { tasks: 10, passed_with: 1, passed_without: 1, runner: "r".repeat(65) }]) {
    const r = await h.ablation("no-uplift", bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.data.error, "ablation_invalid");
  }
  const withData = await h.api("POST", `${h.A("no-uplift")}/versions/0.1.0/evidence`, { kind: "gate", url: "https://ci.example/g", data: { tasks: 1, passed_with: 1, passed_without: 0 } }, "alice");
  assert.equal(withData.status, 400);
  assert.equal(withData.data.error, "ablation_invalid", "data is not allowed for other kinds");
  assert.equal((await h.ablation("no-uplift", { tasks: 20, passed_with: 10, passed_without: 12 }, "bob")).status, 403, "a non-owner cannot add");

  const ok = await h.ablation("no-uplift", { tasks: 20, passed_with: 10, passed_without: 12, runner: "ci" });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  const v = (await h.api("GET", `${h.A("no-uplift")}/versions/0.1.0`)).data;
  assert.deepEqual({ tasks: v.ablation.tasks, w: v.ablation.passed_with, wo: v.ablation.passed_without, uplift: v.ablation.uplift, by: v.ablation.by }, { tasks: 20, w: 10, wo: 12, uplift: -0.1, by: "alice" });
  assert.equal(v.validated_at, null, "ablation does not set validated_at");
  assert.equal((await h.api("GET", `${h.A("no-uplift")}/metrics`)).data.ablation.uplift, -0.1);

  assert.equal((await h.ablation("few-tasks", { tasks: 5, passed_with: 1, passed_without: 3 })).status, 201);
  assert.equal((await h.ablation("uplifts", { tasks: 20, passed_with: 16, passed_without: 10 })).data.evidence.at(-1).data.uplift ?? 0.3, 0.3);

  const r = await h.sweep();
  assert.equal(r.data.zombied, 1, JSON.stringify(r.data));
  assert.equal(await h.status("no-uplift"), "zombie");
  assert.equal(await h.status("few-tasks"), "active", "too few tasks — the rule does not apply");
  assert.equal(await h.status("uplifts"), "active");
  const ev = (await h.audit("no-uplift")).find((e) => e.to_status === "zombie");
  assert.equal(ev.meta.rule, "no_ablation_uplift");
});

test("hold: permissions and boundaries, automation skips it, would_transition shows the policy, release restores automation, audit", async () => {
  const h = await boot();
  await h.publish("held-skill");
  for (const r of ["r1", "r2", "r3"]) await h.usage("held-skill", r, 20, 0);
  const H = `${h.A("held-skill")}/lifecycle-hold`;
  const until = new Date(Date.now() + 7 * 86400000).toISOString();
  assert.equal((await h.api("PUT", H, { until, reason: "under review" }, "alice")).status, 403, "the owner cannot");
  assert.equal((await h.api("PUT", H, { until, reason: "under review" }, "anon")).status, 401);
  const t = await h.api("POST", "/api/v1/me/tokens", { name: "agent", mcp: true }, "rita");
  const mcp = await rawApi(h.srv.base, "PUT", H, { until, reason: "under review" }, { token: t.data.token });
  assert.equal(mcp.status, 403);
  assert.equal(mcp.data.error, "mcp_token_forbidden");
  for (const bad of [{ until: new Date(Date.now() - 1000).toISOString(), reason: "under review" }, { until: new Date(Date.now() + 400 * 86400000).toISOString(), reason: "under review" }, { until, reason: "no" }, { until: "not a date", reason: "under review" }]) {
    const r = await h.api("PUT", H, bad, "rita");
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.data.error, "hold_invalid");
  }
  assert.equal((await h.api("PUT", H, { until, reason: "under review" }, "rita")).status, 200);

  const sig = (await h.api("GET", `${h.A("held-skill")}/lifecycle`)).data;
  assert.equal(sig.hold.set_by, "rita");
  assert.equal(sig.hold.reason, "under review");
  assert.equal(sig.would_transition.rule, "low_transfer", "the policy shows what would happen without the hold");

  const s1 = await h.sweep();
  assert.equal(s1.data.held, 1, JSON.stringify(s1.data));
  assert.equal(s1.data.zombied, 0);
  assert.equal(await h.status("held-skill"), "active");
  assert.equal((await h.api("POST", `${h.A("held-skill")}/transitions`, { to: "aging", reason: "manual" }, "rita")).status, 200, "manual transitions work");
  assert.equal((await h.api("POST", `${h.A("held-skill")}/transitions`, { to: "active", reason: "manual" }, "rita")).status, 200);

  assert.equal((await h.api("DELETE", H, undefined, "alice")).status, 403);
  assert.equal((await h.api("DELETE", H, undefined, "rita")).status, 200);
  const s2 = await h.sweep();
  assert.equal(s2.data.zombied, 1);
  assert.equal(await h.status("held-skill"), "zombie");
  assert.equal((await h.audit("held-skill")).filter((e) => e.action === "lifecycle_hold").length, 2);
});

test("return aging → active by usage; zombie is not returned automatically", async () => {
  const h = await boot({ SKILLFORGE_REVIVE_MIN_EVENTS: "3", SKILLFORGE_REVIVE_WINDOW_DAYS: "14" });
  for (const n of ["revive-me", "stay-zombie", "too-few"]) await h.publish(n);
  for (const n of ["revive-me", "too-few"]) assert.equal((await h.api("POST", `${h.A(n)}/transitions`, { to: "aging", reason: "manual" }, "rita")).status, 200);
  assert.equal((await h.api("POST", `${h.A("stay-zombie")}/transitions`, { to: "zombie", reason: "manual" }, "rita")).status, 200);
  for (let i = 0; i < 3; i++) {
    await h.fact("revive-me");
    await h.fact("stay-zombie");
  }
  await h.fact("too-few");
  await h.fact("too-few");
  await h.settle();
  const r = await h.sweep();
  assert.equal(r.data.revived, 1, JSON.stringify(r.data));
  assert.equal(await h.status("revive-me"), "active");
  assert.equal(await h.status("too-few"), "aging", "below the event threshold");
  assert.equal(await h.status("stay-zombie"), "zombie");
  const ev = (await h.audit("revive-me")).find((e) => e.to_status === "active" && e.actor === "system");
  assert.equal(ev.reason, "revived by usage");
});

test("dry run and limit: dry_run changes nothing, a real sweep executes the plan; MAX_PER_SWEEP defers the rest; permissions", async () => {
  const h = await boot({ SKILLFORGE_LIFECYCLE_MAX_PER_SWEEP: "1" });
  for (const n of ["z1", "z2"]) {
    await h.publish(n);
    for (const r of ["r1", "r2", "r3"]) await h.usage(n, r, 20, 0);
  }
  assert.equal((await h.sweep({ dry_run: true }, "alice")).status, 403);
  assert.equal((await h.sweep({ dry_run: true }, "anon")).status, 401);
  const dry = await h.sweep({ dry_run: true });
  assert.equal(dry.status, 200, JSON.stringify(dry.data));
  assert.equal(dry.data.dry_run, true);
  assert.equal(dry.data.zombied, 1);
  assert.equal(dry.data.deferred, 1);
  assert.equal(dry.data.plan.length, 1);
  assert.deepEqual({ from: dry.data.plan[0].from, to: dry.data.plan[0].to, rule: dry.data.plan[0].rule }, { from: "active", to: "zombie", rule: "low_transfer" });
  assert.equal(await h.status("z1"), "active");
  assert.equal(await h.status("z2"), "active", "dry_run changed nothing");

  const real = await h.sweep();
  assert.equal(real.data.zombied, 1);
  assert.equal(real.data.plan[0].name, dry.data.plan[0].name, "the real sweep executes the dry run's plan");
  const zs = [await h.status("z1"), await h.status("z2")].sort();
  assert.deepEqual(zs, ["active", "zombie"]);
  await h.sweep();
  assert.deepEqual([await h.status("z1"), await h.status("z2")], ["zombie", "zombie"], "the rest — on the next sweep");
});

test("kill switch SKILLFORGE_DATA_LIFECYCLE=off: previous aging by validation, data is ignored, no zombie", async () => {
  const h = await boot({ SKILLFORGE_DATA_LIFECYCLE: "off", SKILLFORGE_AGING_DAYS: "0" });
  assert.equal((await h.api("GET", "/api/v1/admin/lifecycle/policy")).data.enabled, false);
  await h.publish("busy-off");
  await h.publish("bad-off");
  await h.fact("busy-off");
  for (const r of ["r1", "r2", "r3"]) await h.usage("bad-off", r, 20, 0);
  await h.settle();
  const r = await h.sweep();
  assert.equal(r.data.aged, 2, "usage is ignored — both aged the old way");
  assert.equal(r.data.zombied ?? 0, 0);
  assert.equal(await h.status("bad-off"), "aging", "data-driven zombie is off");
});

test("migration: the holds table and indexes exist", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const h = await boot();
  const db = new DatabaseSync(join(h.srv.dataDir, "skillforge.db"), { readOnly: true });
  try {
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'lifecycle_holds'").get(), "lifecycle_holds");
    const cols = db.prepare("PRAGMA table_info(lifecycle_holds)").all().map((c) => c.name);
    for (const c of ["artifact_id", "until", "reason", "set_by", "set_at"]) assert.ok(cols.includes(c), `lifecycle_holds.${c}`);
  } finally {
    db.close();
  }
});
