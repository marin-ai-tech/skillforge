// Workflow engine: definition validation, CRUD, runs, branching, timeouts, replay, cancellation, ACL, purge.
// Requires `npm run build`.
// Workflow steps run `node -e` — cross-platform, without external runtimes.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  startServer,
  api as rawApi,
  login,
  createUser,
  toB64,
  ADMIN_PASSWORD,
} from "./lib/client.mjs";

const servers = [];
after(async () => {
  for (const s of servers) {
    // Windows: rmSync of dataDir fails with EPERM while the OS releases the server's DB files —
    // stopping is required, removing the temp directory is best-effort (the OS will sweep it).
    try {
      await s.stop?.();
    } catch (e) {
      if (e?.code === "EPERM") {
        await new Promise((r) => setTimeout(r, 1500));
        try {
          rmSync(s.dataDir, { recursive: true, force: true });
        } catch {
          /* the temp directory stays in %TEMP% — not a product defect */
        }
      } else throw e;
    }
  }
});

const NODE = process.execPath;
const step = (id, code, extra = {}) => ({
  id,
  kind: "command",
  argv: [NODE, "-e", code],
  ...extra,
});
const DEF = {
  version: 1,
  name: "two-step",
  steps: [
    step("first", "console.log('hello one')"),
    step("second", "console.log('hello two')"),
  ],
};

const until = async (fn, { timeout = 30000, step = 150 } = {}) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return v;
    await new Promise((r) => setTimeout(r, step));
  }
};

const skillMd = (name, note = "") =>
  `---\nname: ${name}\ndescription: Workflow test skill\n---\n\n# ${name}\n${note}`;

async function mk() {
  const srv = await startServer({ SKILLFORGE_ORCHESTRATION_ENABLED: "true" }, { prefix: "skillforge-wf-" });
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
  // Definitions (PUT/DELETE, enabling a routine) are saved by admin only; everything else — by the owner.
  const api = (method, path, body, who = method === "PUT" || method === "DELETE" ? "admin" : "alice") =>
    rawApi(srv.base, method, path, body, who === "anon" ? {} : { cookie: U[who].cookie });
  const A = (n, t = "skill") => `/api/v1/artifacts/${t}/${n}`;
  const h = {
    srv,
    api,
    U,
    A,
    pub: async (name) => {
      const r = await api("POST", "/api/v1/artifacts", {
        type: "skill",
        version: "0.1.0",
        files: toB64([{ path: `${name}/SKILL.md`, content: skillMd(name) }]),
      });
      assert.equal(r.status, 201, `publish ${name}: ${JSON.stringify(r.data)}`);
    },
    wf: (name, wf) => `${A(name)}/workflows/${wf}`,
    run: async (name, wf, input, who = "alice") => {
      const r = await api("POST", `${h.wf(name, wf)}/runs`, { input }, who);
      assert.equal(r.status, 202, `run ${name}/${wf}: ${JSON.stringify(r.data)}`);
      return r.data.run;
    },
    finish: async (name, id, who = "alice") => {
      const run = await until(async () => {
        const x = await api("GET", `${A(name)}/workflows/runs/${id}`, undefined, who);
        return ["done", "failed", "cancelled"].includes(x.data.run?.status) ? x.data.run : null;
      });
      assert.ok(run, `run ${id} did not finish`);
      return run;
    },
    db: () => new DatabaseSync(join(srv.dataDir, "skillforge.db"), { readOnly: true }),
  };
  return h;
}

test("definition: DSL validation, CRUD, audit", async () => {
  const h = await mk();
  await h.pub("wf-def");
  // invalid definitions → 422 with a list of errors
  for (const bad of [
    { version: 1, steps: [step("x", "1", { on_success: "ghost" })] }, // unresolvable reference
    { version: 1, steps: [step("a", "1", { on_success: "a" })] }, // cycle
    { version: 1, steps: [step("a", "1"), step("b", "1", { on_success: "a" })] }, // cycle: a->b->a
    { version: 1, steps: [{ id: "bad id!", kind: "command", argv: ["node"] }] },
    { version: 1, steps: [step("x", "1", { env: ["SKILLFORGE_TOKEN"] })] },
    { version: 1, steps: [step("x", "1", { timeout_s: 0 })] },
    { version: 1, steps: [] },
  ]) {
    const r = await h.api("PUT", h.wf("wf-def", "pipe"), { definition: bad });
    assert.equal(r.status, 422, `${JSON.stringify(bad)}: ${JSON.stringify(r.data)}`);
    assert.ok(Array.isArray(r.data.errors) && r.data.errors.length > 0, "errors list");
  }
  // a valid one is saved and read back
  const ok = await h.api("PUT", h.wf("wf-def", "pipe"), { definition: DEF });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const got = await h.api("GET", h.wf("wf-def", "pipe"));
  assert.equal(got.status, 200);
  assert.equal(got.data.workflow.definition.version, 1);
  const list = await h.api("GET", `${h.A("wf-def")}/workflows`);
  assert.ok(list.data.items.some((w) => w.workflow_id === "pipe"), "workflow in the list");
  const audit = await h.api("GET", `${h.A("wf-def")}/audit`, undefined, "admin");
  assert.ok(
    audit.data.items.some((e) => e.action === "workflow_save"),
    "audit workflow_save",
  );
});

test("run: two steps done, trace and outputs recorded", async () => {
  const h = await mk();
  await h.pub("wf-run");
  await h.api("PUT", h.wf("wf-run", "pipe"), { definition: DEF });
  const run = await h.run("wf-run", "pipe", { ticket: "T-1" });
  assert.equal(run.status, "queued");
  const done = await h.finish("wf-run", run.id);
  assert.equal(done.status, "done");
  const steps = done.steps;
  assert.deepEqual(
    steps.map((s) => s.step_id),
    ["first", "second"],
  );
  assert.ok(steps.every((s) => s.status === "done" && s.exit_code === 0));
  // step outputs and the final trace go to run_outputs
  const outs = await h.api(
    "GET",
    `${h.A("wf-run")}/run-outputs?run_id=wf:${run.id}`,
    undefined,
    "rita",
  );
  assert.equal(outs.status, 200, JSON.stringify(outs.data));
  const streams = outs.data.items.map((o) => o.stream).sort();
  assert.ok(streams.includes("stdout"), "step stdout in run_outputs");
  assert.ok(streams.includes("trace"), "final trace in run_outputs");
  const traceRow = outs.data.items.find((o) => o.stream === "trace");
  const trace = await h.api(
    "GET",
    `${h.A("wf-run")}/run-outputs/${traceRow.id}/content`,
    undefined,
    "rita",
  );
  assert.equal(trace.status, 200);
  const traceJson = JSON.parse(Buffer.from(trace.data).toString("utf8"));
  assert.equal(traceJson.steps.length, 2);
});

test("branching: a step failure goes via on_failure to compensation", async () => {
  const h = await mk();
  await h.pub("wf-branch");
  await h.api("PUT", h.wf("wf-branch", "pipe"), {
    definition: {
      version: 1,
      steps: [
        step("boom", "process.exit(3)", { on_failure: "fix", on_success: "end" }),
        step("fix", "console.log('recovered')", { on_success: "end", on_failure: "fail" }),
      ],
    },
  });
  const run = await h.run("wf-branch", "pipe");
  const done = await h.finish("wf-branch", run.id);
  assert.equal(done.status, "done");
  assert.equal(done.steps[0].status, "failed");
  assert.equal(done.steps[0].exit_code, 3);
  assert.equal(done.steps[0].next_step, "fix");
  assert.equal(done.steps[1].step_id, "fix");
  assert.equal(done.steps[1].status, "done");
});

test("step timeout: failed + timed_out, transition via on_failure", async () => {
  const h = await mk();
  await h.pub("wf-timeout");
  await h.api("PUT", h.wf("wf-timeout", "pipe"), {
    definition: {
      version: 1,
      steps: [
        step("slow", "setTimeout(()=>{},60000)", { timeout_s: 1, on_failure: "fail" }),
      ],
    },
  });
  const run = await h.run("wf-timeout", "pipe");
  const done = await h.finish("wf-timeout", run.id);
  assert.equal(done.status, "failed");
  assert.equal(done.steps[0].status, "failed");
  assert.ok(done.steps[0].timed_out === 1 || done.steps[0].timed_out === true);
});

test("replay: a new run from a snapshot of the definition and input", async () => {
  const h = await mk();
  await h.pub("wf-replay");
  await h.api("PUT", h.wf("wf-replay", "pipe"), { definition: DEF });
  const r1 = await h.run("wf-replay", "pipe", { v: 1 });
  await h.finish("wf-replay", r1.id);
  // change the definition — replay must run the OLD one
  await h.api("PUT", h.wf("wf-replay", "pipe"), {
    definition: { version: 1, steps: [step("only", "console.log('new def')")] },
  });
  const rp = await h.api("POST", `${h.A("wf-replay")}/workflows/runs/${r1.id}/replay`, {});
  assert.equal(rp.status, 202, JSON.stringify(rp.data));
  const r2 = await h.finish("wf-replay", rp.data.run.id);
  assert.deepEqual(
    r2.steps.map((s) => s.step_id),
    ["first", "second"],
    "replay runs the snapshot of definition R1",
  );
});

test("cancellation: cooperative at a step boundary", async () => {
  const h = await mk();
  await h.pub("wf-cancel");
  await h.api("PUT", h.wf("wf-cancel", "pipe"), {
    definition: {
      version: 1,
      steps: [
        step("s1", "setTimeout(()=>{console.log('s1 done')},1500)", { timeout_s: 30 }),
        step("s2", "console.log('should not run')"),
      ],
    },
  });
  const run = await h.run("wf-cancel", "pipe");
  // request cancellation while the first step is running
  const c = await h.api("POST", `${h.A("wf-cancel")}/workflows/runs/${run.id}/cancel`, {});
  assert.ok([200, 202].includes(c.status), JSON.stringify(c.data));
  const done = await h.finish("wf-cancel", run.id);
  assert.equal(done.status, "cancelled");
  assert.equal(done.steps.length, 1, "the second step did not start");
});

test("ACL: the 404/401/403 chain as in evals", async () => {
  const h = await mk();
  await h.pub("wf-acl");
  await h.api("PUT", h.wf("wf-acl", "pipe"), { definition: DEF });
  // anonymous: visibility first (a public artifact is visible), then auth
  const anon = await h.api("GET", `${h.A("wf-acl")}/workflows`, undefined, "anon");
  assert.equal(anon.status, 401);
  // viewer: sees the artifact but cannot manage it
  const viewer = await h.api("GET", `${h.A("wf-acl")}/workflows`, undefined, "vera");
  assert.equal(viewer.status, 403);
  const viewerPost = await h.api("POST", `${h.wf("wf-acl", "pipe")}/runs`, {}, "vera");
  assert.equal(viewerPost.status, 403);
  // reviewer — has the permission
  const rev = await h.api("GET", `${h.A("wf-acl")}/workflows`, undefined, "rita");
  assert.equal(rev.status, 200);
  // nonexistent artifact — 404
  const ghost = await h.api("GET", `${h.A("no-such")}/workflows`, undefined, "rita");
  assert.equal(ghost.status, 404);
});

test("purge: workflow tables are cleaned by the eraser registry", async () => {
  const h = await mk();
  await h.pub("wf-purge");
  await h.api("PUT", h.wf("wf-purge", "pipe"), { definition: DEF });
  const run = await h.run("wf-purge", "pipe");
  await h.finish("wf-purge", run.id);
  const db = h.db();
  const tables = ["workflows", "workflow_runs", "workflow_run_steps"];
  for (const t of tables) {
    assert.ok(
      db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n > 0,
      `${t} filled before purge`,
    );
  }
  const p = await h.api(
    "POST",
    `${h.A("wf-purge")}/purge`,
    { confirm: "skill/wf-purge", reason: "workflow test cleanup" },
    "admin",
  );
  assert.equal(p.status, 200, JSON.stringify(p.data));
  for (const t of tables) {
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n,
      0,
      `${t} cleared by purge`,
    );
  }
});
