// Acceptance tests for the eval orchestrator (batches of eval runs across runtimes).
// Requires `npm run build`.
// The runtime mock is tests/fixtures/eval-runners/mock-runner.mjs (as for skill evals).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  startServer,
  api as rawApi,
  login,
  createUser,
  toB64,
  ROOT,
  ADMIN_PASSWORD,
} from "./lib/client.mjs";

const RUNNER = join(ROOT, "tests", "fixtures", "eval-runners", "mock-runner.mjs");
const servers = [];
after(async () => {
  for (const s of servers) {
    try {
      await s.stop?.();
    } catch (e) {
      if (e?.code === "EPERM") {
        await new Promise((r) => setTimeout(r, 1500));
        try {
          rmSync(s.dataDir, { recursive: true, force: true });
        } catch {
          /* the temp directory stays in %TEMP%; not a product defect */
        }
      } else throw e;
    }
  }
});

const skillMd = (name, answer = "good-answer") =>
  `---\nname: ${name}\ndescription: Use for PDF extraction and merging\n---\n\n# ${name}\n\nANSWER: ${answer}\n`;
const files = (name, answer) => [
  { path: `${name}/SKILL.md`, content: Buffer.from(skillMd(name, answer)) },
];

// Two task cases (both pass on "good-answer") and two trigger cases.
const SUITE = {
  cases: [
    { id: "fire-1", kind: "trigger", prompt: "please extract pdf text", expect_trigger: true },
    { id: "quiet-1", kind: "trigger", prompt: "write a haiku", expect_trigger: false },
    { id: "task-1", kind: "task", prompt: "task one", checks: [{ type: "contains", value: "good-answer" }] },
    { id: "task-2", kind: "task", prompt: "task two", checks: [{ type: "not_contains", value: "wrong" }] },
  ],
};

const until = async (fn, { timeout = 60000, step = 200 } = {}) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return v;
    await new Promise((r) => setTimeout(r, step));
  }
};

async function mk(runnerIds = ["mock-a", "mock-b"]) {
  const work = mkdtempSync(join(tmpdir(), "skillforge-orch-work-"));
  const runnersFile = join(work, "runners.json");
  writeFileSync(
    runnersFile,
    JSON.stringify({
      runners: runnerIds.map((id) => ({
        id,
        label: id,
        command: [process.execPath, RUNNER],
        timeout_s: 5,
      })),
    }),
  );
  const srv = await startServer(
    { SKILLFORGE_EVAL_RUNNERS_FILE: runnersFile },
    { prefix: "skillforge-orch-" },
  );
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  servers.push(srv);
  const U = {};
  U.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [
    ["alice", "contributor"],
    ["rita", "reviewer"],
    ["vera", "viewer"],
  ]) {
    await createUser(srv.base, U.admin.cookie, {
      username: u,
      password: `${u}-pw-123`,
      role,
    });
    U[u] = await login(srv.base, u, `${u}-pw-123`);
  }
  const api = (method, path, body, who = "alice") =>
    rawApi(srv.base, method, path, body, who === "anon" ? {} : { cookie: U[who].cookie });
  const A = (n, t = "skill") => `/api/v1/artifacts/${t}/${n}`;
  const h = {
    srv,
    api,
    U,
    A,
    publish: async (name, answer = "good-answer") => {
      const r = await api("POST", "/api/v1/artifacts", {
        type: "skill",
        version: "0.1.0",
        files: toB64(files(name, answer)),
      });
      assert.equal(r.status, 201, `publish ${name}: ${JSON.stringify(r.data)}`);
    },
    suite: async (name) => {
      const r = await api("PUT", `${A(name)}/evals`, SUITE);
      assert.equal(r.status, 200, `suite ${name}: ${JSON.stringify(r.data)}`);
    },
    batch: (name, body, who = "alice") => api("POST", `${A(name)}/evals/batches`, body, who),
    batches: (name, who = "alice") => api("GET", `${A(name)}/evals/batches`, undefined, who),
    batchGet: (name, id, who = "alice") =>
      api("GET", `${A(name)}/evals/batches/${id}`, undefined, who),
    batchFinish: async (name, id, who = "alice") => {
      const b = await until(async () => {
        const r = await h.batchGet(name, id, who);
        const batch = r.data?.batch;
        return batch && ["done", "failed"].includes(batch.status) ? r.data : null;
      });
      assert.ok(b, `batch ${id} did not finish`);
      return b;
    },
    db: () => new DatabaseSync(join(srv.dataDir, "skillforge.db"), { readOnly: true }),
  };
  return h;
}

test("batch: creation, child runs per runtime, summary", async () => {
  const h = await mk(["mock-a", "mock-b"]);
  await h.publish("orch-basic");
  await h.suite("orch-basic");

  const created = await h.batch("orch-basic", { kind: "trigger", version: "0.1.0" });
  assert.equal(created.status, 202, JSON.stringify(created.data));
  const batchId = created.data.batch.id;

  const done = await h.batchFinish("orch-basic", batchId);
  assert.equal(done.batch.status, "done", JSON.stringify(done));
  assert.equal(done.runs.length, 2, "one run per runner");
  const runners = done.runs.map((r) => r.runner).sort();
  assert.deepEqual(runners, ["mock-a", "mock-b"]);
  assert.ok(done.runs.every((r) => r.status === "done"), "child runs done");
  assert.ok(done.batch.summary?.runners, "summary per runtime");
  // batch audit on the artifact
  const audit = await h.api("GET", `${h.A("orch-basic")}/audit`, undefined, "admin");
  assert.ok(audit.data.items.some((e) => e.action === "eval_batch"), "eval_batch audit");
});

test("saturation flag: all cases passed on >=2 runtimes -> saturated", async () => {
  const h = await mk(["mock-a", "mock-b"]);
  await h.publish("orch-sat");
  await h.suite("orch-sat");
  const created = await h.batch("orch-sat", {
    kind: "trigger",
    version: "0.1.0",
    runners: ["mock-a", "mock-b"],
  });
  const done = await h.batchFinish("orch-sat", created.data.batch.id);
  const sat = done.batch.summary?.saturation;
  assert.ok(sat, "summary.saturation is present");
  assert.equal(sat.saturated, true, JSON.stringify(sat));
  assert.equal(sat.evaluated_runs, 2);
  assert.ok(sat.saturated_cases.includes("fire-1"), "fire-1 is saturated");
});

test("saturation: one runtime, not enough data", async () => {
  const h = await mk(["mock-a", "mock-b"]);
  await h.publish("orch-one");
  await h.suite("orch-one");
  const created = await h.batch("orch-one", {
    kind: "trigger",
    version: "0.1.0",
    runners: ["mock-a"],
  });
  const done = await h.batchFinish("orch-one", created.data.batch.id);
  assert.equal(done.batch.status, "done");
  assert.equal(done.batch.summary?.saturation?.saturated, false, "1 run is not saturation");
});

test("batch failed: a child run failed -> the batch failed; unsaturated set", async () => {
  const h = await mk(["mock-a", "mock-b"]);
  // hung case: mock-runner hangs -> timeout -> all cases failed -> run failed -> batch failed
  await h.publish("orch-crash");
  let r = await h.api("PUT", `${h.A("orch-crash")}/evals`, {
    cases: [{ id: "boom", kind: "trigger", prompt: "__slow__", expect_trigger: true }],
  });
  assert.equal(r.status, 200);
  const created = await h.batch("orch-crash", { kind: "trigger", version: "0.1.0" });
  const done = await h.batchFinish("orch-crash", created.data.batch.id);
  assert.equal(done.batch.status, "failed", JSON.stringify(done.batch));
  assert.ok(
    done.runs.length > 0 && done.runs.every((x) => x.status === "failed"),
    "child runs failed",
  );

  // unsaturated set: a case does not pass -> saturated=false when done
  await h.publish("orch-weak");
  r = await h.api("PUT", `${h.A("orch-weak")}/evals`, {
    cases: [
      { id: "weak-1", kind: "trigger", prompt: "write a haiku", expect_trigger: true },
    ],
  });
  assert.equal(r.status, 200);
  const c2 = await h.batch("orch-weak", { kind: "trigger", version: "0.1.0" });
  const d2 = await h.batchFinish("orch-weak", c2.data.batch.id);
  assert.equal(d2.batch.status, "done");
  assert.equal(d2.batch.summary.saturation.saturated, false);
});

test("validation and ACL", async () => {
  const h = await mk();
  await h.publish("orch-acl");
  await h.suite("orch-acl");

  for (const [body, expect] of [
    [{ version: "0.1.0" }, 400], // no kind
    [{ kind: "task" }, 400], // no version
    [{ kind: "nope", version: "0.1.0" }, 400],
    [{ kind: "trigger", version: "9.9.9" }, 404], // no such version
    [{ kind: "trigger", version: "0.1.0", runners: ["ghost"] }, 422],
    [{ kind: "trigger", version: "0.1.0", runners: [] }, 422],
  ]) {
    const r = await h.batch("orch-acl", body);
    assert.equal(r.status, expect, `${JSON.stringify(body)}: ${JSON.stringify(r.data)}`);
  }
  // permissions
  assert.equal((await h.batch("orch-acl", { kind: "trigger", version: "0.1.0" }, "anon")).status, 401);
  assert.equal((await h.batch("orch-acl", { kind: "trigger", version: "0.1.0" }, "vera")).status, 403);
  assert.equal((await h.batches("orch-acl", "vera")).status, 403);
  assert.equal((await h.batches("orch-acl", "anon")).status, 401);
  assert.equal((await h.batches("orch-acl", "rita")).status, 200);
  assert.equal((await h.batches("no-such", "rita")).status, 404);
});

test("purge: eval_batches and eval_batch_runs are cleared", async () => {
  const h = await mk(["mock-a", "mock-b"]);
  await h.publish("orch-purge");
  await h.suite("orch-purge");
  const created = await h.batch("orch-purge", { kind: "trigger", version: "0.1.0" });
  await h.batchFinish("orch-purge", created.data.batch.id);

  const db = h.db();
  for (const t of ["eval_batches", "eval_batch_runs"]) {
    assert.ok(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n > 0, `${t} is populated`);
  }
  const p = await h.api(
    "POST",
    `${h.A("orch-purge")}/purge`,
    { confirm: "skill/orch-purge", reason: "orch test cleanup" },
    "admin",
  );
  assert.equal(p.status, 200, JSON.stringify(p.data));
  for (const t of ["eval_batches", "eval_batch_runs"]) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, `${t} is cleared`);
  }
});
