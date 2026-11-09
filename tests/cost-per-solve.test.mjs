// An eval runtime may report token usage and a model, a runtime in the runtimes file may have a price; the registry computes from ablation runs
// a "runtime × variant" matrix with the share of solved tasks, cost and cost per solved task. The cheapest model
// is not necessarily cheaper per solved task.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, toB64, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const RUNNER = join(ROOT, "tests", "fixtures", "eval-runners", "cost-runner.mjs");
const A = "/api/v1/artifacts/skill/cost-skill";
let srv;
let admin;
const call = (method, path, body, cookie = admin.cookie) => api(srv.base, method, path, body, cookie ? { cookie } : {});
const near = (a, b) => Math.abs(a - b) < 1e-9;

// Prices per million tokens: small is cheaper per task but solves fewer.
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

async function runAblation(runner) {
  const r = await call("POST", `${A}/evals/runs`, { kind: "ablation", version: "0.1.0", runner });
  assert.equal(r.status, 202, JSON.stringify(r.data));
  const deadline = Date.now() + 40000;
  for (;;) {
    const x = await call("GET", `${A}/evals/runs/${r.data.run.id}`);
    if (["done", "failed"].includes(x.data.run?.status)) return x.data.run;
    assert.ok(Date.now() < deadline, `run ${runner} did not finish`);
    await new Promise((res) => setTimeout(res, 150));
  }
}

let matrix;
before(async () => {
  const work = mkdtempSync(join(tmpdir(), "skillforge-cost-work-"));
  const runnersFile = join(work, "runners.json");
  writeFileSync(
    runnersFile,
    JSON.stringify({ runners: RUNNERS.map((r) => ({ ...r, command: [process.execPath, RUNNER, r.id], timeout_s: 5 })) }),
  );
  srv = await startServer({ SKILLFORGE_EVAL_RUNNERS_FILE: runnersFile }, { prefix: "skillforge-cost-" });
  assert.ok(srv.up, srv.stderr);
  admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  const md = "---\nname: cost-skill\ndescription: Answers test tasks. Use when measuring cost.\n---\n\n# cost-skill\n\nANSWER: good-answer\n";
  const pub = await call("POST", "/api/v1/artifacts", { type: "skill", version: "0.1.0", files: toB64([{ path: "cost-skill/SKILL.md", content: md }]) });
  assert.equal(pub.status, 201, JSON.stringify(pub.data));
  assert.equal((await call("PUT", `${A}/evals`, SUITE)).status, 200);
  for (const runner of ["small", "large", "silent"]) assert.equal((await runAblation(runner)).status, "done");
  const m = await call("GET", `${A}/evals/cost`);
  assert.equal(m.status, 200, JSON.stringify(m.data));
  matrix = m.data.items;
});

after(async () => {
  await srv?.stop();
});

const cell = (runner, side) => matrix.find((i) => i.runner === runner && i.side === side);

test("cell: solved, tokens, cost and cost per solved task", () => {
  const small = cell("small", "with");
  assert.ok(small, JSON.stringify(matrix));
  assert.equal(small.kind, "ablation");
  assert.equal(small.version, "0.1.0");
  assert.equal(small.model, "small-1");
  assert.equal(small.agent, "mock-agent");
  assert.deepEqual([small.tasks, small.passed], [4, 1]);
  assert.ok(near(small.pass_rate, 0.25));
  assert.deepEqual([small.input_tokens, small.output_tokens], [4000, 800]);
  // 4 tasks × (1000 × $1 + 200 × $2) / 1e6
  assert.ok(near(small.cost_usd, 0.0056), String(small.cost_usd));
  assert.ok(near(small.cost_per_solve, 0.0056), String(small.cost_per_solve));
  const large = cell("large", "with");
  assert.deepEqual([large.tasks, large.passed], [4, 4]);
  // 4 × (1500 × $2 + 300 × $4) / 1e6 = 0.0168, solved 4
  assert.ok(near(large.cost_usd, 0.0168), String(large.cost_usd));
  assert.ok(near(large.cost_per_solve, 0.0042), String(large.cost_per_solve));
});

test("a model cheaper per task is more expensive per solved task; order is by cost per solved task", () => {
  const small = cell("small", "with");
  const large = cell("large", "with");
  assert.ok(small.cost_usd / small.tasks < large.cost_usd / large.tasks, "small is cheaper per task");
  assert.ok(large.cost_per_solve < small.cost_per_solve, "large is cheaper per solved task");
  const solvable = matrix.filter((i) => i.cost_per_solve !== null).map((i) => i.cost_per_solve);
  assert.deepEqual(solvable, [...solvable].sort((a, b) => a - b), "not in ascending order of cost per solved task");
  assert.ok(matrix.findIndex((i) => i.cost_per_solve === null) > matrix.findIndex((i) => i.runner === "small" && i.side === "with"), "cells without cost go last");
});

test("without solved tasks and without usage data — null, not 0", () => {
  const without = cell("large", "without");
  assert.equal(without.passed, 0);
  assert.ok(near(without.cost_usd, 0.0168), "usage without the skill is counted");
  assert.equal(without.cost_per_solve, null);
  const silent = cell("silent", "with");
  assert.equal(silent.passed, 4);
  assert.deepEqual([silent.input_tokens, silent.output_tokens, silent.cost_usd, silent.cost_per_solve], [null, null, null, null]);
  assert.equal(silent.model, null);
});

test("permissions as for eval runs: not logged in — 401, nonexistent artifact — 404", async () => {
  const anon = await call("GET", `${A}/evals/cost`, undefined, null);
  assert.equal(anon.status, 401);
  const missing = await call("GET", "/api/v1/artifacts/skill/no-such-skill/evals/cost");
  assert.equal(missing.status, 404);
});
