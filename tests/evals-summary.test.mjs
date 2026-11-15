// evals-summary: one row per eval runtime across the registry, from the latest finished ablation run of each skill on
// that runtime — tasks solved with and without the skill, uplift and cost per solved task. Compare runs and earlier runs
// of the same pair do not count; reviewers and above only.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, toB64, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const RUNNER = join(ROOT, "tests", "fixtures", "eval-runners", "cost-runner.mjs");
const RUNNERS = [
  { id: "small", label: "Small", model: "small-1", agent: "mock-agent", price: { input_per_mtok: 1, output_per_mtok: 2 } },
  { id: "large", label: "Large", model: "large-1", agent: "mock-agent", price: { input_per_mtok: 2, output_per_mtok: 4 } },
  { id: "silent", label: "Silent" },
];
const SUITE = {
  cases: [
    { id: "t-easy", kind: "task", prompt: "easy task", checks: [{ type: "contains", value: "good-answer" }] },
    { id: "t-hard-1", kind: "task", prompt: "hard task one", checks: [{ type: "contains", value: "good-answer" }] },
    { id: "t-hard-2", kind: "task", prompt: "hard task two", checks: [{ type: "contains", value: "good-answer" }] },
    { id: "t-hard-3", kind: "task", prompt: "hard task three", checks: [{ type: "contains", value: "good-answer" }] },
  ],
};
const near = (a, b) => Math.abs(a - b) < 1e-9;
let srv;
let admin, rita, carol;
const call = (method, path, body, who = admin) => api(srv.base, method, path, body, who ? { cookie: who.cookie } : {});

async function publish(name, version) {
  const md = `---\nname: ${name}\ndescription: Answers test tasks for the evals summary. Use when measuring agents.\n---\n\n# ${name}\n\nVersion ${version}.\n\nANSWER: good-answer\n`;
  const r = await call("POST", "/api/v1/artifacts", { type: "skill", version, files: toB64([{ path: `${name}/SKILL.md`, content: md }]) });
  assert.equal(r.status, 201, JSON.stringify(r.data));
}

async function run(name, body) {
  const A = `/api/v1/artifacts/skill/${name}`;
  const r = await call("POST", `${A}/evals/runs`, body);
  assert.equal(r.status, 202, JSON.stringify(r.data));
  const deadline = Date.now() + 40000;
  for (;;) {
    const x = await call("GET", `${A}/evals/runs/${r.data.run.id}`);
    if (["done", "failed"].includes(x.data.run?.status)) {
      assert.equal(x.data.run.status, "done", JSON.stringify(x.data.run));
      return x.data.run;
    }
    assert.ok(Date.now() < deadline, `run on ${name} did not finish`);
    await new Promise((res) => setTimeout(res, 150));
  }
}

let empty;
let summary;
before(async () => {
  const work = mkdtempSync(join(tmpdir(), "skillforge-evals-summary-work-"));
  const runnersFile = join(work, "runners.json");
  writeFileSync(runnersFile, JSON.stringify({ runners: RUNNERS.map((r) => ({ ...r, command: [process.execPath, RUNNER, r.id], timeout_s: 5 })) }));
  srv = await startServer({ SKILLFORGE_EVAL_RUNNERS_FILE: runnersFile }, { prefix: "skillforge-evals-summary-" });
  assert.ok(srv.up, srv.stderr);
  admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  await createUser(srv.base, admin.cookie, { username: "rita", password: "rita-pw-123", role: "reviewer" });
  await createUser(srv.base, admin.cookie, { username: "carol", password: "carol-pw-123", role: "contributor" });
  rita = await login(srv.base, "rita", "rita-pw-123");
  carol = await login(srv.base, "carol", "carol-pw-123");

  empty = await call("GET", "/api/v1/evals/summary", undefined, rita);

  await publish("summary-skill-a", "0.1.0");
  await publish("summary-skill-b", "0.1.0");
  await publish("summary-skill-b", "0.2.0");
  for (const name of ["summary-skill-a", "summary-skill-b"]) {
    assert.equal((await call("PUT", `/api/v1/artifacts/skill/${name}/evals`, SUITE)).status, 200);
  }
  for (const runner of ["small", "large", "silent", "large"]) await run("summary-skill-a", { kind: "ablation", version: "0.1.0", runner });
  await run("summary-skill-b", { kind: "ablation", version: "0.2.0", runner: "large" });
  await run("summary-skill-b", { kind: "compare", version: "0.2.0", against: "0.1.0", runner: "large" });

  const s = await call("GET", "/api/v1/evals/summary", undefined, rita);
  assert.equal(s.status, 200, JSON.stringify(s.data));
  summary = s.data;
});

after(async () => {
  await srv?.stop();
});

const row = (runner) => summary.items.find((i) => i.runner === runner);

test("no ablation runs yet: an empty summary", () => {
  assert.equal(empty.status, 200, JSON.stringify(empty.data));
  assert.deepEqual(empty.data, { items: [], runs: 0 });
});

test("one row per runtime from the latest ablation of each skill; compare and earlier runs do not count", () => {
  assert.deepEqual(summary.items.map((i) => i.runner), ["large", "silent", "small"]);
  assert.equal(summary.runs, 4, "A on small, large (latest), silent; B on large");
  const large = row("large");
  assert.deepEqual(
    [large.runner_label, large.agent, large.model, large.artifacts, large.tasks, large.passed_with, large.passed_without],
    ["Large", "mock-agent", "large-1", 2, 8, 8, 0],
  );
  assert.equal(large.pass_rate_with, 1);
  assert.equal(large.pass_rate_without, 0);
  assert.equal(large.uplift, 1);
  // 8 tasks × (1500 × $2 + 300 × $4) / 1e6 = 0.0336; solved 8
  assert.ok(near(large.cost_usd, 0.0336), String(large.cost_usd));
  assert.ok(near(large.cost_per_solve, 0.0042), String(large.cost_per_solve));
});

test("a runtime that reports no usage has no cost; a weaker one has a lower pass rate and uplift", () => {
  const silent = row("silent");
  assert.deepEqual([silent.artifacts, silent.tasks, silent.passed_with, silent.pass_rate_with], [1, 4, 4, 1]);
  assert.deepEqual([silent.cost_usd, silent.cost_per_solve, silent.model, silent.agent], [null, null, null, null]);
  const small = row("small");
  assert.deepEqual([small.tasks, small.passed_with, small.passed_without], [4, 1, 0]);
  assert.equal(small.pass_rate_with, 0.25);
  assert.equal(small.uplift, 0.25);
  assert.ok(near(small.cost_per_solve, 0.0056), String(small.cost_per_solve));
});

test("the summary names no skill", () => {
  const text = JSON.stringify(summary);
  assert.ok(!text.includes("summary-skill"), text);
});

test("reviewers and above only", async () => {
  assert.equal((await call("GET", "/api/v1/evals/summary", undefined, null)).status, 401);
  const c = await call("GET", "/api/v1/evals/summary", undefined, carol);
  assert.equal(c.status, 403);
  assert.equal(c.data.error, "forbidden");
  assert.equal((await call("GET", "/api/v1/evals/summary", undefined, admin)).status, 200);
});
