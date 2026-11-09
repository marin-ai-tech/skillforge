// Acceptance tests for the CLI commands `skillforge evals …`. Requires `npm run build`.
// The runtime mock is tests/fixtures/eval-runners/mock-runner.mjs. Exit codes follow the existing CLI contract:
// 0 success, 1 server validation error, 2 conflict and local flag/file error, 3 registry not set, 4 not signed in / no permission, 6 not found.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, toB64, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const RUNNER = join(ROOT, "tests", "fixtures", "eval-runners", "mock-runner.mjs");
const N = "ev-cli";
const A = `/api/v1/artifacts/skill/${N}`;
let srv;
let work;
const T = {};
const C = {};

const cli = (args, who, env = {}) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: work,
      env: { ...process.env, SKILLFORGE_CONFIG: join(work, "config.json"), NO_COLOR: "1", SKILLFORGE_URL: srv.base, SKILLFORGE_TOKEN: who ? T[who] : "", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), 90000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
const rest = (method, path, body, who) => api(srv.base, method, path, body, { cookie: C[who].cookie });
const skill = (answer) => [{ path: `${N}/SKILL.md`, content: Buffer.from(`---\nname: ${N}\ndescription: Use for PDF extraction and merging\n---\n\n# ${N}\n\nANSWER: ${answer}\n`) }];
const file = (name, obj) => {
  const p = join(work, name);
  writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj));
  return p;
};

const GOOD_SUITE = {
  cases: [
    { id: "fire-1", kind: "trigger", prompt: "please extract pdf text", expect_trigger: true },
    { id: "quiet-1", kind: "trigger", prompt: "write a haiku", expect_trigger: false },
    { id: "task-1", kind: "task", prompt: "task one", checks: [{ type: "contains", value: "good-answer" }] },
    { id: "h-task-1", kind: "task", prompt: "holdout one", holdout: true, checks: [{ type: "contains", value: "good-answer" }] },
  ],
};

before(async () => {
  assert.ok(existsSync(CLI), `built CLI not found: ${CLI} — run npm run build`);
  work = mkdtempSync(join(tmpdir(), "skillforge-evals-cli-work-"));
  const runners = join(work, "runners.json");
  writeFileSync(runners, JSON.stringify({ runners: [{ id: "mock", label: "Mock", command: [process.execPath, RUNNER], timeout_s: 2 }] }));
  srv = await startServer({ SKILLFORGE_EVAL_RUNNERS_FILE: runners }, { prefix: "skillforge-evals-cli-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  C.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [["alice", "contributor"], ["bob", "contributor"], ["rita", "reviewer"]]) {
    await createUser(srv.base, C.admin.cookie, { username: u, password: `${u}-pw-123`, role });
    C[u] = await login(srv.base, u, `${u}-pw-123`);
    T[u] = (await api(srv.base, "POST", "/api/v1/me/tokens", { name: "cli" }, { cookie: C[u].cookie })).data.token;
  }
  for (const [v, a] of [["0.1.0", "old-answer"], ["0.2.0", "good-answer"]]) {
    const r = await rest("POST", "/api/v1/artifacts", { type: "skill", version: v, files: toB64(skill(a)) }, "alice");
    assert.equal(r.status, 201, JSON.stringify(r.data));
  }
});

after(async () => {
  await srv?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("evals push / evals: suite, gate, file errors and permissions", async () => {
  const empty = await cli(["evals", `skill/${N}`, "--json"], "alice");
  assert.equal(empty.code, 0, empty.stdout + empty.stderr);
  const e = JSON.parse(empty.stdout);
  assert.equal(e.gate, "off");
  assert.deepEqual(e.cases, []);
  assert.deepEqual(e.runners.map((r) => r.id), ["mock"]);

  const push = await cli(["evals", "push", `skill/${N}`, "--file", file("suite.json", GOOD_SUITE), "--json"], "alice");
  assert.equal(push.code, 0, push.stdout + push.stderr);
  const got = JSON.parse((await cli(["evals", `skill/${N}`, "--json"], "alice")).stdout);
  assert.equal(got.cases.length, 4);
  assert.equal(got.cases.find((c) => c.id === "h-task-1").holdout, true);
  const human = await cli(["evals", `skill/${N}`], "alice");
  assert.equal(human.code, 0);
  assert.ok(human.stdout.includes("fire-1") && human.stdout.includes("h-task-1"), human.stdout);

  // bad files: the suite on the server does not change
  const badRegex = file("bad-regex.json", { cases: [{ id: "x", kind: "task", prompt: "p", checks: [{ type: "regex", value: "a+" }] }] });
  const r1 = await cli(["evals", "push", `skill/${N}`, "--file", badRegex], "alice");
  assert.ok([1, 2].includes(r1.code), `regex -> ${r1.code}`);
  const r2 = await cli(["evals", "push", `skill/${N}`, "--file", file("not-json.json", "{oops")], "alice");
  assert.ok([1, 2].includes(r2.code), `not JSON -> ${r2.code}`);
  const r3 = await cli(["evals", "push", `skill/${N}`, "--file", join(work, "missing.json")], "alice");
  assert.ok([1, 2].includes(r3.code), `no file -> ${r3.code}`);
  assert.equal(JSON.parse((await cli(["evals", `skill/${N}`, "--json"], "alice")).stdout).cases.length, 4, "the suite did not change");

  // gate: a manager turns it on, a reviewer turns it off
  assert.equal((await cli(["evals", "push", `skill/${N}`, "--file", file("suite.json", GOOD_SUITE), "--gate", "required"], "alice")).code, 0);
  assert.equal((await cli(["evals", "push", `skill/${N}`, "--file", file("suite.json", GOOD_SUITE), "--gate", "off"], "alice")).code, 4, "the owner does not turn the gate off");
  assert.equal((await cli(["evals", "push", `skill/${N}`, "--file", file("suite.json", GOOD_SUITE), "--gate", "off"], "rita")).code, 0);
  const badGate = await cli(["evals", "push", `skill/${N}`, "--file", file("suite.json", GOOD_SUITE), "--gate", "maybe"], "alice");
  assert.ok([1, 2].includes(badGate.code));

  // permissions and not found
  assert.equal((await cli(["evals", `skill/${N}`], "bob")).code, 4);
  assert.equal((await cli(["evals", `skill/${N}`], undefined)).code, 4);
  assert.equal((await cli(["evals", "skill/nope"], "alice")).code, 6);
});

test("evals run --wait / runs / journal: trigger, compare, ablation", async () => {
  const trg = await cli(["evals", "run", `skill/${N}`, "--kind", "trigger", "--version", "0.1.0", "--wait", "--json"], "alice");
  assert.equal(trg.code, 0, trg.stdout + trg.stderr);
  const run = JSON.parse(trg.stdout).run ?? JSON.parse(trg.stdout);
  assert.equal(run.status, "done");
  assert.equal(run.summary.accuracy, 1);

  const cmp = await cli(["evals", "run", `skill/${N}`, "--kind", "compare", "--version", "0.2.0", "--against", "0.1.0", "--scope", "holdout", "--runner", "mock", "--wait", "--json"], "alice");
  assert.equal(cmp.code, 0, cmp.stdout + cmp.stderr);
  const c = JSON.parse(cmp.stdout).run ?? JSON.parse(cmp.stdout);
  assert.equal(c.summary.wins_candidate, 1);

  const human = await cli(["evals", "run", `skill/${N}`, "--kind", "trigger", "--version", "0.2.0", "--wait"], "alice");
  assert.equal(human.code, 0, human.stdout + human.stderr);
  assert.ok(/done|accuracy/i.test(human.stdout), human.stdout);

  const abl = await cli(["evals", "run", `skill/${N}`, "--kind", "ablation", "--version", "0.2.0", "--wait", "--json"], "alice");
  assert.equal(abl.code, 0, abl.stdout + abl.stderr);
  const a = JSON.parse(abl.stdout).run ?? JSON.parse(abl.stdout);
  assert.equal(a.summary.tasks, 2);
  assert.equal(a.summary.ablation_recorded, true);

  const runs = await cli(["evals", "runs", `skill/${N}`, "--json"], "alice");
  assert.equal(runs.code, 0);
  assert.equal(JSON.parse(runs.stdout).items.length, 4);
  const journal = await cli(["evals", "journal", `skill/${N}`, "--json"], "alice");
  assert.equal(journal.code, 0, journal.stdout + journal.stderr);
  const j = JSON.parse(journal.stdout).items.find((i) => i.version === "0.2.0");
  assert.equal(j.trigger.accuracy, 1);
  assert.equal(j.ablation.tasks, 2);
  const jh = await cli(["evals", "journal", `skill/${N}`], "alice");
  assert.equal(jh.code, 0);
  assert.ok(jh.stdout.includes("0.2.0") && jh.stdout.includes("0.1.0"), jh.stdout);

  // permissions and errors
  assert.equal((await cli(["evals", "run", `skill/${N}`, "--kind", "trigger", "--version", "0.1.0"], "bob")).code, 4);
  assert.equal((await cli(["evals", "run", `skill/${N}`, "--kind", "trigger", "--version", "9.9.9"], "alice")).code, 6);
  const badKind = await cli(["evals", "run", `skill/${N}`, "--kind", "nope", "--version", "0.1.0"], "alice");
  assert.ok([1, 2].includes(badKind.code), `kind -> ${badKind.code}`);
  const noVersion = await cli(["evals", "run", `skill/${N}`, "--kind", "trigger"], "alice");
  assert.ok([1, 2].includes(noVersion.code), `without --version -> ${noVersion.code}`);
});

test("evals run: without --wait returns the run immediately; a conflict while a run is in progress — code 2; a run with no executed case — code 1 with --wait", async () => {
  const slow = { cases: [{ id: "slow", kind: "task", prompt: "__slow__", checks: [{ type: "contains", value: "x" }] }] };
  assert.equal((await cli(["evals", "push", `skill/${N}`, "--file", file("slow.json", slow)], "alice")).code, 0);
  const first = await cli(["evals", "run", `skill/${N}`, "--kind", "compare", "--version", "0.2.0", "--against", "0.1.0", "--json"], "alice");
  assert.equal(first.code, 0, first.stdout + first.stderr);
  const started = JSON.parse(first.stdout).run ?? JSON.parse(first.stdout);
  assert.ok(["queued", "running"].includes(started.status), started.status);
  const second = await cli(["evals", "run", `skill/${N}`, "--kind", "compare", "--version", "0.2.0", "--against", "0.1.0"], "alice");
  assert.equal(second.code, 2, second.stdout + second.stderr);
  // wait for the first one to finish
  const deadline = Date.now() + 30000;
  for (;;) {
    const st = (await rest("GET", `${A}/evals/runs/${started.id}`, undefined, "alice")).data.run.status;
    if (st === "done" || st === "failed") break;
    assert.ok(Date.now() < deadline, "the run did not finish");
    await new Promise((r) => setTimeout(r, 200));
  }
  const failed = await cli(["evals", "run", `skill/${N}`, "--kind", "compare", "--version", "0.2.0", "--against", "0.1.0", "--wait", "--json"], "alice");
  assert.equal(failed.code, 1, failed.stdout + failed.stderr);
});
