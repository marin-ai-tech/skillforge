// Epic with gates on the workflow engine: a gate step stops the run until a human decides, "implementation ↔ review" loops
// are bounded by `max_visits`, a stopped run resumes from where it stopped; the "epic with gates" template.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, toB64, ADMIN_PASSWORD } from "./lib/client.mjs";

const NODE = process.execPath;
const A = "/api/v1/artifacts/skill/epic-skill";
let srv;
const auth = {};
let work;
const call = (method, path, body, who = auth.alice) => api(srv.base, method, path, body, who ? { cookie: who.cookie } : {});
const ok = (msg) => [NODE, "-e", `console.log(${JSON.stringify(msg)})`];
/** Fails until it has run `passAt` times; counts in a file. */
const countdown = (file, passAt) => [
  NODE,
  "-e",
  `const fs=require('fs');const p=${JSON.stringify(file)};const n=(fs.existsSync(p)?+fs.readFileSync(p,'utf8'):0)+1;fs.writeFileSync(p,String(n));process.exit(n>=${passAt}?0:1)`,
];

async function waitFor(id, statuses) {
  const deadline = Date.now() + 30000;
  for (;;) {
    const r = await call("GET", `${A}/workflows/runs/${id}`);
    if (statuses.includes(r.data.run?.status)) return r.data.run;
    assert.ok(Date.now() < deadline, `run ${id} stuck in ${r.data.run?.status}: ${r.data.run?.error ?? ""}`);
    await new Promise((res) => setTimeout(res, 150));
  }
}

const rows = (run, step, status) => run.steps.filter((s) => s.step_id === step && (!status || s.status === status));

before(async () => {
  srv = await startServer({ SKILLFORGE_ORCHESTRATION_ENABLED: "true" }, { prefix: "skillforge-epic-" });
  assert.ok(srv.up, srv.stderr);
  auth.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [["alice", "contributor"], ["vera", "viewer"]]) {
    await createUser(srv.base, auth.admin.cookie, { username: u, password: `${u}-pw-123456`, role });
    auth[u] = await login(srv.base, u, `${u}-pw-123456`);
  }
  const md = "---\nname: epic-skill\ndescription: Epic probe. Use when testing gates.\n---\n\n# epic-skill\n\nSteps.\n";
  assert.equal((await call("POST", "/api/v1/artifacts", { type: "skill", version: "0.1.0", files: toB64([{ path: "epic-skill/SKILL.md", content: md }]) })).status, 201);
  work = mkdtempSync(join(tmpdir(), "skillforge-epic-work-"));
});

after(async () => {
  await srv?.stop();
});

test("definition: a loop is allowed only through a step with max_visits; the epic template is available", async () => {
  const loop = (maxVisits) => ({
    definition: {
      version: 1,
      steps: [
        { id: "work", kind: "command", argv: ok("w"), ...(maxVisits ? { max_visits: maxVisits } : {}) },
        { id: "check", kind: "command", argv: ok("c"), on_failure: "work" },
        { id: "approve", kind: "gate" },
      ],
    },
  });
  assert.equal((await call("PUT", `${A}/workflows/loop`, loop(0), auth.admin)).status, 422, "loop without a limit");
  assert.equal((await call("PUT", `${A}/workflows/loop`, loop(11), auth.admin)).status, 422, "max_visits up to 10");
  assert.equal((await call("PUT", `${A}/workflows/loop`, loop(3), auth.admin)).status, 200);
  // Round trip: what was saved must validate again, since the engine re-checks the stored snapshot.
  const saved = (await call("GET", `${A}/workflows/loop`)).data.workflow.definition;
  assert.equal((await call("PUT", `${A}/workflows/loop`, { definition: saved }, auth.admin)).status, 200, "the saved definition passes validation again");
  const t = await call("GET", "/api/v1/workflow-templates");
  assert.equal(t.status, 200);
  const epic = t.data.items.find((x) => x.id === "epic-with-gates");
  assert.deepEqual(epic.slots, ["plan", "implement", "review"]);
});

test("epic: gates wait for a decision, implementation and review go in a loop, rejection returns to work", async () => {
  const review = join(work, "review-count");
  const body = { template: "epic-with-gates", max_review_rounds: 3, commands: { plan: ok("plan"), implement: ok("impl"), review: countdown(review, 2) } };
  assert.equal((await call("POST", `${A}/workflows/epic/from-template`, body)).status, 403, "definitions — admin only");
  assert.equal((await call("POST", `${A}/workflows/epic/from-template`, body, auth.admin)).status, 200);
  const started = await call("POST", `${A}/workflows/epic/runs`, {});
  assert.equal(started.status, 202, JSON.stringify(started.data));
  const id = started.data.run.id;

  let run = await waitFor(id, ["waiting"]);
  assert.equal(rows(run, "plan", "done").length, 1);
  assert.equal(rows(run, "plan-approval", "waiting").length, 1);
  assert.equal((await call("POST", `${A}/workflows/runs/${id}/gates/plan-approval`, { decision: "approve" }, auth.vera)).status, 403);
  assert.equal((await call("POST", `${A}/workflows/runs/${id}/gates/release-approval`, { decision: "approve" })).status, 409, "a different step is waiting");
  assert.equal((await call("POST", `${A}/workflows/runs/${id}/gates/plan-approval`, { decision: "approve", reason: "plan ok" })).status, 200);

  run = await waitFor(id, ["waiting"]);
  assert.equal(rows(run, "implement", "done").length, 2, "review sent it back to implementation once");
  assert.equal(rows(run, "review", "failed").length, 1);
  assert.equal(rows(run, "release-approval", "waiting").length, 1);
  const approval = rows(run, "plan-approval")[0];
  assert.deepEqual([approval.status, approval.decided_by, approval.reason], ["done", "alice", "plan ok"]);

  assert.equal((await call("POST", `${A}/workflows/runs/${id}/gates/release-approval`, { decision: "reject", reason: "missing docs" })).status, 200);
  run = await waitFor(id, ["waiting"]);
  assert.equal(rows(run, "implement", "done").length, 3, "rejection sent it back to implementation");
  assert.equal((await call("POST", `${A}/workflows/runs/${id}/gates/release-approval`, { decision: "approve" })).status, 200);
  run = await waitFor(id, ["done"]);
  assert.equal(run.status, "done");
});

test("loops are bounded: on exhaustion the run stops; resuming continues from the same step", async () => {
  const always = [NODE, "-e", "process.exit(1)"];
  const body = { template: "epic-with-gates", max_review_rounds: 2, commands: { plan: ok("plan"), implement: ok("impl"), review: always } };
  assert.equal((await call("POST", `${A}/workflows/bounded/from-template`, body, auth.admin)).status, 200);
  const id = (await call("POST", `${A}/workflows/bounded/runs`, {})).data.run.id;
  await waitFor(id, ["waiting"]);
  assert.equal((await call("POST", `${A}/workflows/runs/${id}/gates/plan-approval`, { decision: "approve" })).status, 200);
  let run = await waitFor(id, ["failed"]);
  assert.equal(rows(run, "implement", "done").length, 2, "exactly two loops");
  assert.equal(rows(run, "implement", "exhausted").length, 1);
  assert.match(run.error ?? "", /implement/);

  assert.equal((await call("POST", `${A}/workflows/runs/${id}/resume`, {}, auth.vera)).status, 403);
  const resumed = await call("POST", `${A}/workflows/runs/${id}/resume`, {});
  assert.equal(resumed.status, 202, JSON.stringify(resumed.data));
  run = await waitFor(id, ["failed"]);
  assert.equal(rows(run, "implement", "resumed").length, 1, "resume mark");
  assert.equal(rows(run, "implement", "done").length, 4, "after resuming — two more loops");
  assert.equal(rows(run, "plan", "done").length, 1, "work done before the stop is not repeated");
  assert.equal((await call("POST", `${A}/workflows/runs/${id}/gates/plan-approval`, { decision: "approve" })).status, 409, "the run is not waiting");
});
