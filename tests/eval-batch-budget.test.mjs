// When the daily limit of eval runs (`SKILLFORGE_EVAL_MAX_RUNS_PER_DAY`) is exhausted, the batch finishes as `failed`
// with the error `budget_exhausted`, as the eval-orchestrator contract requires (not `rate_limited`).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, toB64, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const RUNNER = join(ROOT, "tests", "fixtures", "eval-runners", "mock-runner.mjs");
const work = mkdtempSync(join(tmpdir(), "skillforge-eval-budget-"));
let srv;
after(async () => {
  try {
    await srv?.stop?.();
  } catch {
    /* Windows EPERM */
  }
  rmSync(work, { recursive: true, force: true });
});

test("batch with an exhausted daily limit → failed budget_exhausted", { timeout: 180_000 }, async () => {
  const runnersFile = join(work, "runners.json");
  writeFileSync(runnersFile, JSON.stringify({
    runners: ["mock-a", "mock-b"].map((id) => ({ id, label: id, command: [process.execPath, RUNNER], timeout_s: 5 })),
  }));
  srv = await startServer({ SKILLFORGE_EVAL_RUNNERS_FILE: runnersFile, SKILLFORGE_EVAL_MAX_RUNS_PER_DAY: "1" }, { prefix: "skillforge-eval-budget-srv-" });
  assert.ok(srv.up, srv.stderr);
  const admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  const md = "---\nname: eb-skill\ndescription: Use for PDF extraction\n---\n\n# eb-skill\n\nANSWER: good-answer\n";
  assert.equal((await api(srv.base, "POST", "/api/v1/artifacts", { type: "skill", version: "0.1.0", files: toB64([{ path: "eb-skill/SKILL.md", content: md }]) }, admin)).status, 201);
  const suite = await api(srv.base, "PUT", "/api/v1/artifacts/skill/eb-skill/evals", {
    cases: [{ id: "fire-1", kind: "trigger", prompt: "please extract pdf text", expect_trigger: true }],
  }, admin);
  assert.equal(suite.status, 200, JSON.stringify(suite.data));
  const created = await api(srv.base, "POST", "/api/v1/artifacts/skill/eb-skill/evals/batches", { kind: "trigger", version: "0.1.0", runners: ["mock-a", "mock-b"] }, admin);
  assert.equal(created.status, 202, JSON.stringify(created.data));
  const id = created.data.batch.id;
  let batch;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const r = await api(srv.base, "GET", `/api/v1/artifacts/skill/eb-skill/evals/batches/${id}`, undefined, admin);
    batch = r.data?.batch;
    if (batch && ["done", "failed"].includes(batch.status)) break;
    await new Promise((res) => setTimeout(res, 300));
  }
  assert.equal(batch?.status, "failed", JSON.stringify(batch));
  assert.equal(batch.error, "budget_exhausted", `batch error: ${batch.error}`);
});
