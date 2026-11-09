// Acceptance tests for skill evals, part A.
// Requires `npm run build`.
// Runtime imitation — tests/fixtures/eval-runners/mock-runner.mjs (behavior is set by the skill content and the prompt; the runtime does not get the version).
// The "ablation …" scenarios rely on the `ablation` evidence kind.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { startServer, api as rawApi, login, createUser, loadDir, toB64, FIXTURES, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const RUNNER = join(ROOT, "tests", "fixtures", "eval-runners", "mock-runner.mjs");
const servers = [];
after(async () => {
  for (const s of servers) await s.stop?.();
});

const PDF_DESC = "Use for PDF extraction and merging";
const NO_PDF_DESC = "Use for document tasks";
// note makes the version content (and digest) unique: the registry rejects an identical digest (digest_exists) — this is not weakened.
const skillMd = (name, { desc = PDF_DESC, answer, note = "" }) => `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n\nANSWER: ${answer}\n${note ? `\nNote: ${note}\n` : ""}`;
const files = (name, opts) => [{ path: `${name}/SKILL.md`, content: Buffer.from(skillMd(name, opts)) }];
const OLD = { answer: "old-answer" };
const GOOD = { answer: "good-answer" };
const WRONG = { answer: "wrong" };
const GOOD_NO_PDF = { answer: "good-answer", desc: NO_PDF_DESC };

const until = async (fn, { timeout = 40000, step = 150 } = {}) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return v;
    await new Promise((r) => setTimeout(r, step));
  }
};

// Suite for the scenarios: 3 "must trigger" + 2 "stays silent" + 3 tasks + holdout ones (2 tasks and 1 trigger).
const SUITE = {
  cases: [
    { id: "fire-1", kind: "trigger", prompt: "please extract pdf text", expect_trigger: true },
    { id: "fire-2", kind: "trigger", prompt: "merge these pdf files", expect_trigger: true },
    { id: "quiet-1", kind: "trigger", prompt: "write a haiku", expect_trigger: false },
    { id: "quiet-2", kind: "trigger", prompt: "sort my list", expect_trigger: false },
    { id: "task-1", kind: "task", prompt: "task one", checks: [{ type: "contains", value: "good-answer" }] },
    { id: "task-2", kind: "task", prompt: "task two", checks: [{ type: "not_contains", value: "wrong" }] },
    { id: "task-3", kind: "task", prompt: "task three", checks: [{ type: "equals", value: "GOOD-ANSWER", ci: true }] },
    { id: "h-task-1", kind: "task", prompt: "holdout one", holdout: true, checks: [{ type: "contains", value: "good-answer" }] },
    { id: "h-task-2", kind: "task", prompt: "holdout two", holdout: true, checks: [{ type: "not_contains", value: "wrong" }] },
    { id: "h-fire", kind: "trigger", prompt: "open this pdf", holdout: true, expect_trigger: true },
  ],
};

let pidN = 0;
/** Starts a server with the imitation runtime and a set of users; returns helpers. */
async function mk(env = {}, { runners = true } = {}) {
  const work = mkdtempSync(join(tmpdir(), "skillforge-evals-work-"));
  const log = join(work, "runner.log");
  const runnersFile = join(work, "runners.json");
  const mock = (id) => ({ id, label: id === "mock" ? "Mock" : id, command: [process.execPath, RUNNER], timeout_s: 2, env: ["EVAL_LOG", "EVAL_PID_FILE"] });
  const writeRunners = (list) => writeFileSync(runnersFile, JSON.stringify({ runners: list }));
  if (runners) writeRunners([mock("mock")]);
  const pidFile = join(work, `slow-${++pidN}.pid`);
  const srv = await startServer(
    { ...(runners ? { SKILLFORGE_EVAL_RUNNERS_FILE: runnersFile } : {}), EVAL_LOG: log, EVAL_PID_FILE: pidFile, ...env },
    { prefix: "skillforge-evals-" },
  );
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  servers.push(srv);
  const U = {};
  U.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [["alice", "contributor"], ["bob", "contributor"], ["rita", "reviewer"], ["lena", "contributor"], ["oscar", "contributor"]]) {
    await createUser(srv.base, U.admin.cookie, { username: u, password: `${u}-pw-123`, role });
    U[u] = await login(srv.base, u, `${u}-pw-123`);
  }
  const api = (method, path, body, who = "alice") => rawApi(srv.base, method, path, body, who === "anon" ? {} : { cookie: U[who].cookie });
  const A = (n, t = "skill") => `/api/v1/artifacts/${t}/${n}`;
  const h = {
    srv, api, U, A, work, log, pidFile, writeRunners, mock,
    jobs: () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []),
    pub: (name, version, opts, who = "alice", extra = {}) => api("POST", "/api/v1/artifacts", { type: "skill", version, files: toB64(files(name, opts)), ...extra }, who),
    publish: async (name, version, opts, who = "alice", extra = {}) => {
      const r = await h.pub(name, version, opts, who, extra);
      assert.equal(r.status, 201, `publish ${name}@${version}: ${JSON.stringify(r.data)}`);
      return r;
    },
    putSuite: (name, body, who = "alice") => api("PUT", `${A(name)}/evals`, body, who),
    suite: async (name, body = SUITE, who = "alice") => {
      const r = await h.putSuite(name, body, who);
      assert.equal(r.status, 200, `suite ${name}: ${JSON.stringify(r.data)}`);
    },
    finish: async (name, id, who = "alice") => {
      const run = await until(async () => {
        const x = await api("GET", `${A(name)}/evals/runs/${id}`, undefined, who);
        return ["done", "failed"].includes(x.data.run?.status) ? x.data.run : null;
      });
      assert.ok(run, `run ${id} did not finish`);
      return run;
    },
    run: async (name, body, who = "alice") => {
      const r = await api("POST", `${A(name)}/evals/runs`, body, who);
      assert.equal(r.status, 202, `run ${name} ${JSON.stringify(body)}: ${JSON.stringify(r.data)}`);
      return h.finish(name, r.data.run.id, who);
    },
    channel: (name, version, channel, who = "alice") => api("POST", `${A(name)}/versions/${version}/channel`, { channel }, who),
    latest: async (name) => (await api("GET", A(name))).data.artifact.latest_version,
    versions: async (name) => (await api("GET", `${A(name)}/versions`)).data.items,
    journal: async (name) => (await api("GET", `${A(name)}/evals/journal`)).data.items,
    audit: async (name) => (await api("GET", `${A(name)}/audit`, undefined, "admin")).data.items,
    db: () => new DatabaseSync(join(srv.dataDir, "skillforge.db"), { readOnly: true }),
    dbBytes: () => ["skillforge.db", "skillforge.db-wal"].map((n) => (existsSync(join(srv.dataDir, n)) ? readFileSync(join(srv.dataDir, n)) : Buffer.alloc(0))),
  };
  return h;
}

test("configuration and migration: wrong variables stop startup, without a runtimes file runs are unavailable, tables 0019 are in place", async () => {
  for (const [name, value] of [["SKILLFORGE_EVAL_CONCURRENCY", "99"], ["SKILLFORGE_EVAL_CONCURRENCY", "0"], ["SKILLFORGE_EVAL_MAX_RUNS_PER_DAY", "0"]]) {
    const bad = await startServer({ [name]: value }, { prefix: "skillforge-evals-bad-" });
    assert.equal(bad.up, false, `${name}=${value}: the server must not start`);
    assert.ok(String(bad.stderr).includes(name), bad.stderr);
  }
  const h = await mk({}, { runners: false });
  await h.publish("ev-norun", "0.1.0", GOOD);
  await h.suite("ev-norun");
  const r = await h.api("POST", `${h.A("ev-norun")}/evals/runs`, { kind: "trigger", version: "0.1.0" });
  assert.equal(r.status, 503, JSON.stringify(r.data));
  assert.equal(r.data.error, "runners_not_configured");
  const g = await h.api("GET", `${h.A("ev-norun")}/evals`);
  assert.deepEqual(g.data.runners, [], "no runtimes");

  const db = h.db();
  try {
    const want = {
      eval_suites: ["artifact_id", "gate", "updated_by", "updated_at"],
      eval_cases: ["artifact_id", "case_id", "position", "kind", "prompt", "holdout", "expect_trigger", "checks"],
      eval_runs: ["id", "artifact_id", "kind", "version", "against", "runner", "scope", "status", "requested_by", "created_at", "started_at", "finished_at", "summary", "errors", "error"],
      eval_results: ["run_id", "case_id", "side", "passed", "triggered", "error", "duration_ms", "output_excerpt"],
    };
    for (const [t, cols] of Object.entries(want)) {
      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t), `table ${t}`);
      const have = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
      for (const c of cols) assert.ok(have.includes(c), `${t}.${c}`);
    }
  } finally {
    db.close();
  }
});

test("check suite: parsing boundaries, permissions, MCP, gate — a manager can enable, only reviewer/admin can disable", async () => {
  const h = await mk();
  await h.publish("ev-a", "0.1.0", GOOD);
  const g0 = await h.api("GET", `${h.A("ev-a")}/evals`);
  assert.equal(g0.status, 200, JSON.stringify(g0.data));
  assert.equal(g0.data.gate, "off");
  assert.deepEqual(g0.data.cases, []);
  assert.deepEqual(g0.data.runners.map((r) => r.id), ["mock"]);

  const c = (over = {}) => ({ id: "c1", kind: "task", prompt: "p", checks: [{ type: "contains", value: "x" }], ...over });
  const bad = {
    "101 cases": { cases: Array.from({ length: 101 }, (_, i) => c({ id: `c${i}` })) },
    "duplicate id": { cases: [c(), c()] },
    "trigger without expect_trigger": { cases: [{ id: "t", kind: "trigger", prompt: "p" }] },
    "trigger with checks": { cases: [{ id: "t", kind: "trigger", prompt: "p", expect_trigger: true, checks: [{ type: "contains", value: "x" }] }] },
    "task without checks": { cases: [{ id: "t", kind: "task", prompt: "p" }] },
    "task with expect_trigger": { cases: [c({ expect_trigger: true })] },
    "regular expression": { cases: [c({ checks: [{ type: "regex", value: "a+" }] })] },
    "check value 501": { cases: [c({ checks: [{ type: "contains", value: "x".repeat(501) }] })] },
    "11 checks": { cases: [c({ checks: Array.from({ length: 11 }, () => ({ type: "contains", value: "x" })) })] },
    "empty prompt": { cases: [c({ prompt: "" })] },
    "prompt 4001": { cases: [c({ prompt: "p".repeat(4001) })] },
    "id not kebab": { cases: [c({ id: "Bad Id" })] },
    "unknown kind": { cases: [c({ kind: "other" })] },
    "cases not an array": { cases: "x" },
    "no cases": {},
    "wrong gate": { gate: "maybe", cases: [c()] },
  };
  for (const [label, body] of Object.entries(bad)) {
    const r = await h.putSuite("ev-a", body);
    assert.equal(r.status, 422, `${label}: ${r.status} ${JSON.stringify(r.data)}`);
    assert.equal(r.data.error, "suite_invalid", label);
  }
  const noHold = await h.putSuite("ev-a", { gate: "required", cases: [c()] });
  assert.equal(noHold.status, 422);
  assert.equal(noHold.data.error, "gate_needs_holdout");
  assert.equal((await h.api("GET", `${h.A("ev-a")}/evals`)).data.cases.length, 0, "nothing was saved");

  await h.suite("ev-a");
  const got = (await h.api("GET", `${h.A("ev-a")}/evals`)).data;
  assert.equal(got.cases.length, SUITE.cases.length);
  assert.equal(got.cases.find((x) => x.id === "h-task-1").holdout, true);
  assert.equal(got.cases.find((x) => x.id === "task-1").holdout, false);
  await h.suite("ev-a", { cases: [c()] });
  assert.equal((await h.api("GET", `${h.A("ev-a")}/evals`)).data.cases.length, 1, "the suite is replaced entirely");
  await h.suite("ev-a");

  // having a suite does not weaken immutability: the same content under a new version is still digest_exists
  const dup = await h.pub("ev-a", "0.9.0", GOOD);
  assert.equal(dup.status, 409, JSON.stringify(dup.data));
  assert.equal(dup.data.error, "digest_exists");

  // permissions
  const tok = (await h.api("POST", "/api/v1/me/tokens", { name: "agent", mcp: true }, "alice")).data.token;
  for (const who of ["bob", "oscar"]) {
    for (const [m, body] of [["GET"], ["PUT", SUITE]]) {
      const r = await h.api(m, `${h.A("ev-a")}/evals`, body, who);
      assert.equal(r.status, 403, `${who} ${m}`);
      assert.equal(r.data.error, "forbidden");
    }
  }
  assert.equal((await h.api("GET", `${h.A("ev-a")}/evals`, undefined, "anon")).status, 401);
  assert.equal((await h.api("PUT", `${h.A("ev-a")}/evals`, SUITE, "anon")).status, 401);
  const mcp = await rawApi(h.srv.base, "PUT", `${h.A("ev-a")}/evals`, SUITE, { token: tok });
  assert.equal(mcp.status, 403);
  assert.equal(mcp.data.error, "mcp_token_forbidden");
  assert.equal((await h.api("GET", `${h.A("ev-a")}/evals`, undefined, "rita")).status, 200);
  assert.equal((await h.api("GET", `${h.A("ev-a")}/evals`, undefined, "admin")).status, 200);
  assert.equal((await h.putSuite("ev-nope", SUITE)).status, 404);

  // gate: a manager enables, reviewer/admin disables
  assert.equal((await h.putSuite("ev-a", { gate: "required", ...SUITE })).status, 200);
  assert.equal((await h.api("GET", `${h.A("ev-a")}/evals`)).data.gate, "required");
  const off = await h.putSuite("ev-a", { gate: "off", ...SUITE });
  assert.equal(off.status, 403, "the owner does not disable the gate");
  assert.equal(off.data.error, "forbidden");
  assert.equal((await h.putSuite("ev-a", { ...SUITE }, "alice")).status, 200, "without the gate field the gate does not change");
  assert.equal((await h.api("GET", `${h.A("ev-a")}/evals`)).data.gate, "required");
  assert.equal((await h.putSuite("ev-a", { gate: "off", ...SUITE }, "rita")).status, 200);
  assert.equal((await h.api("GET", `${h.A("ev-a")}/evals`)).data.gate, "off");
  const ev = (await h.audit("ev-a")).filter((e) => e.action === "eval_suite_change");
  assert.ok(ev.length >= 3, "audit of suite changes");
  assert.ok(ev.some((e) => e.meta?.from === "required" && e.meta?.to === "off" && e.actor === "rita"), JSON.stringify(ev.map((e) => e.meta)));

  // a type other than skill
  const cmd = await h.api("POST", "/api/v1/artifacts", { type: "command", files: toB64(loadDir(join(FIXTURES, "command-propose"))) });
  assert.equal(cmd.status, 201, JSON.stringify(cmd.data));
  const ts = await h.api("PUT", `${h.A("propose", "command")}/evals`, SUITE);
  assert.equal(ts.status, 422);
  assert.equal(ts.data.error, "type_not_supported");
});

test("runtime: environment without SKILLFORGE_*, empty cwd, case errors (failed/invalid_output/timeout), a hung process is killed", async () => {
  const h = await mk();
  await h.publish("ev-rt", "0.1.0", OLD);
  await h.publish("ev-rt", "0.2.0", GOOD);
  await h.suite("ev-rt", {
    cases: [
      { id: "t-ok", kind: "task", prompt: "task ok", checks: [{ type: "contains", value: "good-answer" }] },
      { id: "t-env", kind: "task", prompt: "__env__", checks: [{ type: "contains", value: "ENV:" }] },
      { id: "t-crash", kind: "task", prompt: "__crash__", checks: [{ type: "contains", value: "x" }] },
      { id: "t-garbage", kind: "task", prompt: "__garbage__", checks: [{ type: "contains", value: "x" }] },
      { id: "t-slow", kind: "task", prompt: "__slow__", checks: [{ type: "contains", value: "x" }] },
    ],
  });
  const run = await h.run("ev-rt", { kind: "compare", version: "0.2.0", against: "0.1.0" });
  assert.equal(run.status, "done", JSON.stringify(run));
  assert.equal(run.errors, 6, "3 erroring cases × 2 sides");
  const res = (c, side) => run.results.find((r) => r.case_id === c && r.side === side);
  for (const side of ["candidate", "baseline"]) {
    assert.equal(res("t-crash", side).error, "failed", "code 2 → failed");
    assert.equal(res("t-garbage", side).error, "invalid_output");
    assert.equal(res("t-slow", side).error, "timeout");
    for (const c of ["t-crash", "t-garbage", "t-slow"]) assert.equal(res(c, side).passed, false, "a case with an error counts as failed");
    assert.equal(res("t-env", side).error, null);
    assert.equal(res("t-env", side).output_excerpt, "ENV:", "the runtime received no SKILLFORGE_* variables");
  }
  assert.equal(res("t-ok", "candidate").passed, true);
  assert.equal(res("t-ok", "baseline").passed, false);

  const jobs = h.jobs();
  assert.ok(jobs.length >= 10, `the runtime was called ${jobs.length} times`);
  for (const j of jobs) {
    assert.deepEqual(j.env_keys.filter((k) => k.startsWith("SKILLFORGE_")), [], "SKILLFORGE_* in the runtime environment");
    assert.ok(j.env_keys.includes("EVAL_LOG"), "a variable from the runtime env is passed through");
    assert.equal(j.job.protocol, 1);
    assert.ok(["trigger", "task"].includes(j.job.mode));
    assert.equal(existsSync(j.cwd), false, "the run's temporary cwd was removed");
    assert.ok(!j.cwd.startsWith(ROOT), "cwd is an empty temporary directory, not the repository root");
  }
  // the hung process is terminated together with the run
  assert.ok(existsSync(h.pidFile), "the hung runtime wrote its pid");
  await until(async () => {
    if (!existsSync(h.pidFile)) return true;
    const pid = Number(readFileSync(h.pidFile, "utf8"));
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  }, { timeout: 5000 });
  if (existsSync(h.pidFile)) {
    const pid = Number(readFileSync(h.pidFile, "utf8"));
    assert.throws(() => process.kill(pid, 0), "the hung runtime must be killed");
  }
});

test("trigger: recall, specificity, accuracy; per-case results; run list and permissions", async () => {
  const h = await mk();
  await h.publish("ev-trg", "0.1.0", OLD);
  await h.publish("ev-trg", "0.2.0", GOOD_NO_PDF);
  await h.suite("ev-trg");
  const good = await h.run("ev-trg", { kind: "trigger", version: "0.1.0" });
  assert.equal(good.status, "done", JSON.stringify(good));
  assert.deepEqual({ recall: good.summary.recall, specificity: good.summary.specificity, accuracy: good.summary.accuracy }, { recall: 1, specificity: 1, accuracy: 1 });
  assert.equal(good.results.length, 5, "only trigger cases (3 + 2)");
  assert.ok(good.results.every((r) => r.side === "main" && typeof r.triggered === "boolean" && typeof r.passed === "boolean" && "duration_ms" in r));
  assert.equal(good.requested_by, "alice");
  assert.equal(good.kind, "trigger");
  assert.equal(good.version, "0.1.0");
  const silent = await h.run("ev-trg", { kind: "trigger", version: "0.2.0" });
  assert.deepEqual({ recall: silent.summary.recall, specificity: silent.summary.specificity, accuracy: silent.summary.accuracy }, { recall: 0, specificity: 1, accuracy: 0.4 });
  const holdOnly = await h.run("ev-trg", { kind: "trigger", version: "0.1.0", scope: "holdout" });
  assert.equal(holdOnly.results.length, 1, "scope=holdout — only the holdout case");

  const list = await h.api("GET", `${h.A("ev-trg")}/evals/runs`);
  assert.equal(list.status, 200);
  assert.equal(list.data.items.length, 3);
  assert.equal(list.data.items[0].id, holdOnly.id, "newest first");
  assert.ok(list.data.items.every((r) => r.results === undefined), "list without results");
  assert.equal((await h.api("GET", `${h.A("ev-trg")}/evals/runs/999999`)).status, 404);
  for (const who of ["bob", "oscar"]) assert.equal((await h.api("GET", `${h.A("ev-trg")}/evals/runs`, undefined, who)).status, 403);
  assert.equal((await h.api("GET", `${h.A("ev-trg")}/evals/runs`, undefined, "anon")).status, 401);
  assert.ok((await h.audit("ev-trg")).some((e) => e.action === "eval_run" && e.actor === "alice"), "audit eval_run");
});

test("compare: blind A/B — per-side totals, wins, the runtime does not see versions and roles; against defaults to the stable head", async () => {
  const h = await mk();
  await h.publish("ev-ab", "0.1.0", OLD);
  await h.publish("ev-ab", "0.2.0", GOOD);
  await h.suite("ev-ab");
  const before = h.jobs().length;
  const run = await h.run("ev-ab", { kind: "compare", version: "0.2.0", against: "0.1.0" });
  assert.equal(run.status, "done", JSON.stringify(run));
  assert.equal(run.errors, 0);
  assert.deepEqual(run.summary.candidate, { version: "0.2.0", task_pass_rate: 1, trigger_accuracy: 1 });
  assert.deepEqual(run.summary.baseline, { version: "0.1.0", task_pass_rate: 0.4, trigger_accuracy: 1 });
  assert.equal(run.summary.wins_candidate, 3, "task-1, task-3, h-task-1");
  assert.equal(run.summary.wins_baseline, 0);
  assert.equal(run.summary.ties, 2, "task-2, h-task-2");
  assert.equal(run.results.length, 2 * SUITE.cases.length);
  assert.deepEqual([...new Set(run.results.map((r) => r.side))].sort(), ["baseline", "candidate"]);

  const jobs = h.jobs().slice(before);
  assert.equal(jobs.length, 2 * SUITE.cases.length, "one execution per case and side");
  for (const { job } of jobs) {
    const text = JSON.stringify(job);
    for (const leak of ["0.1.0", "0.2.0", "candidate", "baseline"]) assert.equal(text.includes(leak), false, `the runtime received "${leak}"`);
    assert.ok(job.skill && Array.isArray(job.skill.files) && job.skill.name === "ev-ab");
  }
  // a repeated run is deterministic in its totals
  const again = await h.run("ev-ab", { kind: "compare", version: "0.2.0", against: "0.1.0" });
  assert.deepEqual(again.summary, run.summary);

  // holdout scope
  const hold = await h.run("ev-ab", { kind: "compare", version: "0.2.0", against: "0.1.0", scope: "holdout" });
  assert.equal(hold.results.length, 2 * 3, "h-task-1, h-task-2, h-fire × 2 sides");
  assert.equal(hold.summary.candidate.task_pass_rate, 1);
  assert.equal(hold.summary.baseline.task_pass_rate, 0.5);
  assert.equal(hold.summary.wins_candidate, 1);
  assert.equal(hold.summary.ties, 1);

  // against defaults to the stable head (0.2.0); for the head itself against is required
  const noAgainst = await h.api("POST", `${h.A("ev-ab")}/evals/runs`, { kind: "compare", version: "0.2.0" });
  assert.equal(noAgainst.status, 422);
  assert.equal(noAgainst.data.error, "against_required");
  const def = await h.run("ev-ab", { kind: "compare", version: "0.1.0" });
  assert.equal(def.summary.baseline.version, "0.2.0", "the default baseline is the stable head");
  assert.equal(def.summary.candidate.version, "0.1.0");
});

test("run constraints: body, versions, cases, runtimes, permissions, one run per artifact", async () => {
  const h = await mk();
  await h.publish("ev-lim", "0.1.0", OLD);
  await h.publish("ev-lim", "0.2.0", GOOD);
  await h.suite("ev-lim", { cases: [{ id: "only-trigger", kind: "trigger", prompt: "pdf", expect_trigger: true }] });
  const P = `${h.A("ev-lim")}/evals/runs`;
  const post = (body, who = "alice") => h.api("POST", P, body, who);
  for (const body of [{}, { kind: "nope", version: "0.1.0" }, { kind: "trigger" }, { kind: "trigger", version: "0.1.0", scope: "x" }, { kind: "trigger", version: "not-a-version" }]) {
    const r = await post(body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.data.error, "run_invalid", JSON.stringify(body));
  }
  assert.equal((await post({ kind: "trigger", version: "9.9.9" })).status, 404);
  assert.equal((await h.api("POST", `${h.A("ev-none")}/evals/runs`, { kind: "trigger", version: "0.1.0" })).status, 404);
  for (const kind of ["compare", "ablation"]) {
    const r = await post({ kind, version: "0.1.0", against: "0.2.0" });
    assert.equal(r.status, 422, kind);
    assert.equal(r.data.error, "no_cases", `${kind}: the suite has no task cases`);
  }
  const ghost = await post({ kind: "compare", version: "0.1.0", against: "7.7.7" });
  assert.equal(ghost.status, 404, "unknown baseline");

  // runtimes: several → runner is required; unknown
  h.writeRunners([h.mock("mock"), h.mock("mock-b")]);
  const req = await post({ kind: "trigger", version: "0.1.0" });
  assert.equal(req.status, 422);
  assert.equal(req.data.error, "runner_required");
  const unk = await post({ kind: "trigger", version: "0.1.0", runner: "nope" });
  assert.equal(unk.status, 422);
  assert.equal(unk.data.error, "runner_unknown");
  const ok = await h.run("ev-lim", { kind: "trigger", version: "0.1.0", runner: "mock-b" });
  assert.equal(ok.runner, "mock-b");
  h.writeRunners([h.mock("mock")]);

  // permissions
  const tok = (await h.api("POST", "/api/v1/me/tokens", { name: "agent", mcp: true }, "alice")).data.token;
  assert.equal((await post({ kind: "trigger", version: "0.1.0" }, "bob")).status, 403);
  assert.equal((await post({ kind: "trigger", version: "0.1.0" }, "anon")).status, 401);
  const mcp = await rawApi(h.srv.base, "POST", P, { kind: "trigger", version: "0.1.0" }, { token: tok });
  assert.equal(mcp.status, 403);
  assert.equal(mcp.data.error, "mcp_token_forbidden");
  const byReviewer = await h.run("ev-lim", { kind: "trigger", version: "0.1.0" }, "rita");
  assert.equal(byReviewer.requested_by, "rita");

  // one run per artifact: while a slow one is running, a second gets 409
  await h.publish("ev-busy", "0.1.0", OLD);
  await h.publish("ev-busy", "0.2.0", GOOD);
  await h.suite("ev-busy", { cases: [{ id: "slow", kind: "task", prompt: "__slow__", checks: [{ type: "contains", value: "x" }] }] });
  const first = await h.api("POST", `${h.A("ev-busy")}/evals/runs`, { kind: "compare", version: "0.2.0", against: "0.1.0" });
  assert.equal(first.status, 202, JSON.stringify(first.data));
  const second = await h.api("POST", `${h.A("ev-busy")}/evals/runs`, { kind: "compare", version: "0.2.0", against: "0.1.0" });
  assert.equal(second.status, 409, JSON.stringify(second.data));
  assert.equal(second.data.error, "run_in_progress");
  const fin = await h.finish("ev-busy", first.data.run.id);
  assert.equal(fin.status, "failed", "no case executed (timeouts only)");
  assert.equal(fin.errors, 2);
  // after completion it is possible again
  assert.equal((await h.api("POST", `${h.A("ev-busy")}/evals/runs`, { kind: "compare", version: "0.2.0", against: "0.1.0" })).status, 202);
});

test("daily run limit per artifact", async () => {
  const h = await mk({ SKILLFORGE_EVAL_MAX_RUNS_PER_DAY: "3" });
  await h.publish("ev-day", "0.1.0", GOOD);
  await h.suite("ev-day", { cases: [{ id: "fire", kind: "trigger", prompt: "pdf", expect_trigger: true }] });
  for (let i = 0; i < 3; i++) await h.run("ev-day", { kind: "trigger", version: "0.1.0" });
  const r = await h.api("POST", `${h.A("ev-day")}/evals/runs`, { kind: "trigger", version: "0.1.0" });
  assert.equal(r.status, 429, JSON.stringify(r.data));
  assert.equal(r.data.error, "rate_limited");
  await h.publish("ev-day2", "0.1.0", GOOD);
  await h.suite("ev-day2", { cases: [{ id: "fire", kind: "trigger", prompt: "pdf", expect_trigger: true }] });
  assert.equal((await h.api("POST", `${h.A("ev-day2")}/evals/runs`, { kind: "trigger", version: "0.1.0" })).status, 202, "the limit is per artifact");
});

test("ablation: a run with and without the skill writes ablation evidence from the initiator; with an execution error — it does not", async () => {
  const h = await mk();
  await h.publish("ev-abl", "0.1.0", GOOD);
  await h.suite("ev-abl");
  const version = async () => (await h.api("GET", `${h.A("ev-abl")}/versions/0.1.0`)).data;
  const v0 = await version();
  const run = await h.run("ev-abl", { kind: "ablation", version: "0.1.0" });
  assert.equal(run.status, "done", JSON.stringify(run));
  assert.deepEqual(
    { tasks: run.summary.tasks, passed_with: run.summary.passed_with, passed_without: run.summary.passed_without, uplift: run.summary.uplift, ablation_recorded: run.summary.ablation_recorded },
    { tasks: 5, passed_with: 5, passed_without: 2, uplift: 0.6, ablation_recorded: true },
  );
  assert.deepEqual([...new Set(run.results.map((r) => r.side))].sort(), ["with", "without"]);
  const jobs = h.jobs().filter((j) => j.job.mode === "task");
  assert.ok(jobs.some((j) => j.job.skill === null), "a run without the skill passes skill: null");
  const v1 = await version();
  const ab = v1.evidence.filter((e) => e.kind === "ablation");
  assert.equal(ab.length, 1, JSON.stringify(v1.evidence));
  assert.equal(ab[0].data.tasks, 5);
  assert.equal(ab[0].data.passed_with, 5);
  assert.equal(ab[0].data.passed_without, 2);
  assert.equal(ab[0].data.runner, "mock");
  assert.equal(ab[0].uplift, 0.6);
  assert.equal(ab[0].by, "alice");
  assert.equal(ab[0].url, `/api/v1/artifacts/skill/ev-abl/evals/runs/${run.id}`);
  assert.equal(v1.validated_at ?? null, v0.validated_at ?? null, "ablation does not set validated_at");

  // holdout scope
  const hold = await h.run("ev-abl", { kind: "ablation", version: "0.1.0", scope: "holdout" });
  assert.deepEqual({ tasks: hold.summary.tasks, w: hold.summary.passed_with, wo: hold.summary.passed_without, u: hold.summary.uplift }, { tasks: 2, w: 2, wo: 1, u: 0.5 });

  // the journal sees the ablation
  const j = (await h.journal("ev-abl")).find((x) => x.version === "0.1.0");
  assert.deepEqual({ uplift: j.ablation.uplift, tasks: j.ablation.tasks, run_id: j.ablation.run_id }, { uplift: 0.5, tasks: 2, run_id: hold.id });

  // execution error → evidence is not written
  const evBefore = (await version()).evidence.length;
  await h.suite("ev-abl", { cases: [...SUITE.cases, { id: "t-crash", kind: "task", prompt: "__crash__", checks: [{ type: "contains", value: "x" }] }] });
  const bad = await h.run("ev-abl", { kind: "ablation", version: "0.1.0" });
  assert.ok(bad.errors > 0);
  assert.equal(bad.summary.ablation_recorded, false);
  assert.equal((await version()).evidence.length, evBefore, "evidence was not recorded");
});

test("edit journal: per-version blocks from the latest completed runs, ordering, gate not_applicable without a gate", async () => {
  const h = await mk();
  await h.publish("ev-j", "0.1.0", OLD);
  await h.publish("ev-j", "0.2.0", GOOD);
  await h.suite("ev-j");
  const empty = await h.journal("ev-j");
  assert.deepEqual(empty.map((i) => i.version), ["0.2.0", "0.1.0"], "newest first");
  for (const i of empty) {
    assert.deepEqual({ t: i.trigger, hd: i.holdout, vp: i.vs_previous, ab: i.ablation }, { t: null, hd: null, vp: null, ab: null }, i.version);
    assert.equal(i.gate, "not_applicable");
    assert.ok(i.channel && i.published_at);
  }
  const tr = await h.run("ev-j", { kind: "trigger", version: "0.2.0" });
  const cmp = await h.run("ev-j", { kind: "compare", version: "0.2.0", against: "0.1.0", scope: "holdout" });
  const j = (await h.journal("ev-j")).find((i) => i.version === "0.2.0");
  assert.deepEqual(j.trigger, { recall: 1, specificity: 1, accuracy: 1, run_id: tr.id });
  assert.deepEqual(j.holdout, { pass_rate: 1, run_id: cmp.id });
  assert.deepEqual(j.vs_previous, { against: "0.1.0", wins_candidate: 1, wins_baseline: 0, ties: 1, run_id: cmp.id });
  assert.equal(j.ablation, null);
  const old = (await h.journal("ev-j")).find((i) => i.version === "0.1.0");
  assert.equal(old.trigger, null, "candidate runs are not attributed to the baseline");
  for (const who of ["bob", "oscar"]) assert.equal((await h.api("GET", `${h.A("ev-j")}/evals/journal`, undefined, who)).status, 403);
});

test("gate: a new version goes to beta, an explicit stable is forbidden, promotion needs a fresh successful compare on holdout cases, regressions and errors are rejected, a reviewer disables", async () => {
  const h = await mk();
  const N = "ev-gate";
  await h.publish(N, "0.1.0", OLD);
  assert.equal((await h.putSuite(N, { gate: "required", ...SUITE })).status, 200);
  const channelOf = async (v) => (await h.versions(N)).find((x) => x.version === v)?.channel;
  const gateOf = async (v) => (await h.journal(N)).find((x) => x.version === v)?.gate;

  // 1. a new version without a channel — beta
  await h.publish(N, "0.2.0", GOOD);
  assert.equal(await channelOf("0.2.0"), "beta");
  assert.equal(await h.latest(N), "0.1.0");
  // 2. promotion without a run
  const miss = await h.channel(N, "0.2.0", "stable");
  assert.equal(miss.status, 409, JSON.stringify(miss.data));
  assert.equal(miss.data.error, "eval_gate_missing");
  assert.equal(await gateOf("0.2.0"), "missing");
  // 3. a successful run on holdout cases → promotion
  const good = await h.run(N, { kind: "compare", version: "0.2.0", scope: "holdout" });
  assert.equal(good.summary.baseline.version, "0.1.0", "the default baseline is the stable head");
  assert.equal(good.errors, 0);
  const okp = await h.channel(N, "0.2.0", "stable");
  assert.equal(okp.status, 200, JSON.stringify(okp.data));
  assert.equal(await h.latest(N), "0.2.0");
  assert.equal(await gateOf("0.2.0"), "passed");
  // 4. regression on tasks
  await h.publish(N, "0.3.0", WRONG);
  await h.run(N, { kind: "compare", version: "0.3.0", scope: "holdout" });
  const reg = await h.channel(N, "0.3.0", "stable");
  assert.equal(reg.status, 409, JSON.stringify(reg.data));
  assert.equal(reg.data.error, "eval_gate_failed");
  assert.equal(reg.data.reason, "task_regression");
  assert.equal(await h.latest(N), "0.2.0");
  assert.equal(await gateOf("0.3.0"), "failed");
  // 5. regression on triggering (tasks no worse)
  await h.publish(N, "0.4.0", GOOD_NO_PDF);
  await h.run(N, { kind: "compare", version: "0.4.0", scope: "holdout" });
  const trg = await h.channel(N, "0.4.0", "stable");
  assert.equal(trg.status, 409, JSON.stringify(trg.data));
  assert.equal(trg.data.reason, "trigger_regression");
  // 6. explicit stable on publication
  const explicit = await h.pub(N, "0.5.0", { ...GOOD, note: "rev 0.5.0" }, "alice", { channel: "stable" });
  assert.equal(explicit.status, 409, JSON.stringify(explicit.data));
  assert.equal(explicit.data.error, "eval_gate_required");
  assert.equal((await h.versions(N)).some((v) => v.version === "0.5.0"), false, "the version was not created");
  // 7. a run with errors does not open the gate; after the suite changes the run becomes stale
  await h.publish(N, "0.6.0", { ...GOOD, note: "rev 0.6.0" });
  const withCrash = { gate: "required", cases: [...SUITE.cases, { id: "h-crash", kind: "task", prompt: "__crash__", holdout: true, checks: [{ type: "contains", value: "x" }] }] };
  assert.equal((await h.putSuite(N, withCrash)).status, 200);
  const errRun = await h.run(N, { kind: "compare", version: "0.6.0", scope: "holdout" });
  assert.ok(errRun.errors > 0);
  const errP = await h.channel(N, "0.6.0", "stable");
  assert.equal(errP.status, 409);
  assert.equal(errP.data.error, "eval_gate_failed");
  assert.equal(errP.data.reason, "errors");
  await new Promise((r) => setTimeout(r, 30));
  assert.equal((await h.putSuite(N, { gate: "required", ...SUITE })).status, 200);
  const stale = await h.channel(N, "0.6.0", "stable");
  assert.equal(stale.status, 409, "a run from before the suite change is stale");
  assert.equal(stale.data.error, "eval_gate_missing");
  await new Promise((r) => setTimeout(r, 30));
  await h.run(N, { kind: "compare", version: "0.6.0", scope: "holdout" });
  assert.equal((await h.channel(N, "0.6.0", "stable")).status, 200);
  assert.equal(await h.latest(N), "0.6.0");
  // 8. a demotion is not restricted by the gate
  assert.equal((await h.channel(N, "0.6.0", "beta")).status, 200);
  // 9. only reviewer/admin disables; afterwards — the previous behavior
  assert.equal((await h.putSuite(N, { gate: "off", ...SUITE }, "alice")).status, 403);
  assert.equal((await h.putSuite(N, { gate: "off", ...SUITE }, "rita")).status, 200);
  await h.publish(N, "0.7.0", { ...GOOD, note: "rev 0.7.0" });
  assert.equal(await channelOf("0.7.0"), "stable");
  assert.equal(await h.latest(N), "0.7.0");
});

test("purge: runtime output (secret marker) is erased together with the version and with the artifact; purging a version does not lift the gate or delete the suite, purging the artifact deletes it", async () => {
  const SECRET = "SECRET-EVAL-XYZ-1234";
  const h = await mk();
  const suite = { cases: [{ id: "leak", kind: "task", prompt: "__secret__", checks: [{ type: "contains", value: "token=" }] }, { id: "h-keep", kind: "task", prompt: "keep", holdout: true, checks: [{ type: "contains", value: "x" }] }] }; // the secret marker is only in the runtime output, not in the suite
  for (const n of ["ev-pg", "ev-pg2"]) {
    await h.publish(n, "0.1.0", OLD);
    await h.publish(n, "0.2.0", GOOD);
    await h.suite(n, n === "ev-pg" ? { gate: "required", ...suite } : suite);
    const run = await h.run(n, { kind: "compare", version: "0.2.0", against: "0.1.0" });
    assert.ok(run.results.some((r) => (r.output_excerpt ?? "").includes(SECRET)), "marker in the results before purge");
  }
  assert.ok(h.dbBytes().some((b) => b.includes(SECRET)), "sanity: marker in the DB before purge");

  const pv = await h.api("POST", `${h.A("ev-pg")}/versions/0.2.0/purge`, { reason: "leaked token in eval output", confirm: "skill/ev-pg@0.2.0" }, "admin");
  assert.equal(pv.status, 200, JSON.stringify(pv.data));
  const runs = await h.api("GET", `${h.A("ev-pg")}/evals/runs`, undefined, "admin");
  assert.equal(runs.status, 200);
  assert.equal(runs.data.items.length, 0, "runs of the purged version were deleted");
  // purging a version does not lift the gate or delete the artifact's check suite
  const keptGate = (await h.api("GET", `${h.A("ev-pg")}/evals`, undefined, "admin")).data;
  assert.equal(keptGate.gate, "required", "the gate remained");
  assert.equal(keptGate.cases.length, 2, "the suite remained");
  assert.ok(h.dbBytes().some((b) => b.includes(SECRET)), "the second artifact's marker is still in the DB (sanity)");

  const pa = await h.api("POST", `${h.A("ev-pg2")}/purge`, { reason: "leaked token in eval output", confirm: "skill/ev-pg2" }, "admin");
  assert.equal(pa.status, 200, JSON.stringify(pa.data));
  assert.equal(h.dbBytes().some((b) => b.includes(SECRET)), false, "the secret from the runtime output remained in the DB files");
  const db = h.db();
  try {
    for (const t of ["eval_runs", "eval_results"]) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, `${t} is not empty after purge`);
    }
    const left = db.prepare("SELECT a.name AS name FROM eval_suites s JOIN artifacts a ON a.id = s.artifact_id").all().map((r) => r.name);
    assert.deepEqual(left, ["ev-pg"], "the purged artifact's suite is deleted, the suite of the artifact with a purged version remained");
  } finally {
    db.close();
  }
});

test("visibility: for a team artifact all evaluation routes give outsiders 404 as for a nonexistent one; members and reviewer have access", async () => {
  const h = await mk();
  assert.equal((await h.api("POST", "/api/v1/teams", { name: "hushed", lead: "lena" }, "admin")).status, 201);
  await h.publish("ev-vis", "0.1.0", GOOD, "lena", { visibility: "team", owner_team: "hushed" });
  await h.suite("ev-vis", SUITE, "lena");
  const paths = [["GET", "/evals"], ["PUT", "/evals", SUITE], ["POST", "/evals/runs", { kind: "trigger", version: "0.1.0" }], ["GET", "/evals/runs"], ["GET", "/evals/runs/1"], ["GET", "/evals/journal"]];
  const ghost = await h.api("GET", `${h.A("no-such-skill")}/evals`, undefined, "oscar");
  assert.equal(ghost.status, 404);
  for (const who of ["oscar", "bob", "anon"]) {
    for (const [m, p, body] of paths) {
      const r = await h.api(m, `${h.A("ev-vis")}${p}`, body, who);
      assert.equal(r.status, 404, `${who} ${m} ${p}`);
      assert.deepEqual(r.data, ghost.data, `${who} ${m} ${p}: the body differs from "no such artifact"`);
    }
  }
  for (const who of ["lena", "rita", "admin"]) assert.equal((await h.api("GET", `${h.A("ev-vis")}/evals`, undefined, who)).status, 200, who);
});
