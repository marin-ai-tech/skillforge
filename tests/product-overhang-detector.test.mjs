// Acceptance tests for the product overhang detector. Requires `npm run build`.
// GET /artifacts/:type/:name/overhang (reviewer+) and GET /lifecycle/overhang — the answer to
// "what can you delete today?" from the with/without behavior delta (ablation evidence).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
          /* the temp directory stays in %TEMP% — not a product defect */
        }
      } else throw e;
    }
  }
});

const skillMd = (name) =>
  `---\nname: ${name}\ndescription: Use for PDF extraction and merging\n---\n\n# ${name}\n\nANSWER: good-answer\n`;
const files = (name) => [
  { path: `${name}/SKILL.md`, content: Buffer.from(skillMd(name)) },
];
// uplift=0: "baseline answer" also contains "answer" → the without side passes.
const SUITE_ZERO_UPLIFT = {
  cases: [
    { id: "t1", kind: "task", prompt: "solve this task", checks: [{ type: "contains", value: "answer" }] },
  ],
};
// uplift=1: only the with side yields "good-answer".
const SUITE_POSITIVE = {
  cases: [
    { id: "t1", kind: "task", prompt: "solve this task", checks: [{ type: "contains", value: "good-answer" }] },
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

let H = null;
async function mk() {
  if (H) return H;
  const work = mkdtempSync(join(tmpdir(), "skillforge-overhang-work-"));
  const runnersFile = join(work, "runners.json");
  writeFileSync(
    runnersFile,
    JSON.stringify({
      runners: [
        { id: "mock-a", label: "mock-a", command: [process.execPath, RUNNER], timeout_s: 5 },
      ],
    }),
  );
  const srv = await startServer(
    { SKILLFORGE_EVAL_RUNNERS_FILE: runnersFile },
    { prefix: "skillforge-overhang-" },
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
  const api = (method, path, body, who = "admin") =>
    rawApi(srv.base, method, path, body, who === "anon" ? {} : { cookie: U[who].cookie });
  const A = (n) => `/api/v1/artifacts/skill/${n}`;
  const h = {
    api,
    A,
    publish: async (name) => {
      const r = await api("POST", "/api/v1/artifacts", {
        type: "skill",
        name,
        version: "0.1.0",
        files: toB64(files(name)),
      });
      assert.equal(r.status, 201, `publish ${name}: ${JSON.stringify(r.data)}`);
    },
    suite: async (name, suite) => {
      const r = await api("PUT", `${A(name)}/evals`, suite);
      assert.equal(r.status, 200, `suite ${name}: ${JSON.stringify(r.data)}`);
    },
    ablationDone: async (name) => {
      const r = await api("POST", `${A(name)}/evals/batches`, {
        kind: "ablation",
        version: "0.1.0",
        runners: ["mock-a"],
      });
      assert.equal(r.status, 202, `batch ${name}: ${JSON.stringify(r.data)}`);
      const id = r.data.batch.id;
      const done = await until(async () => {
        const g = await api("GET", `${A(name)}/evals/batches/${id}`);
        const b = g.data?.batch;
        return b && ["done", "failed"].includes(b.status) ? b : null;
      });
      assert.ok(done, `ablation batch ${name} did not finish`);
      assert.equal(done.status, "done", JSON.stringify(done));
    },
    overhang: (name, who = "rita") => api("GET", `${A(name)}/overhang`, undefined, who),
    report: (who = "rita") => api("GET", "/api/v1/lifecycle/overhang", undefined, who),
  };
  H = h;
  return h;
}

test("overhang: ablation with uplift=0 → verdict overhang with metrics", async () => {
  const h = await mk();
  await h.publish("oh-dead");
  await h.suite("oh-dead", SUITE_ZERO_UPLIFT);
  await h.ablationDone("oh-dead");

  const r = await h.overhang("oh-dead");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.verdict, "overhang", JSON.stringify(r.data));
  assert.equal(r.data.ablation.uplift, 0);
  assert.equal(r.data.ablation.tasks, 1);
  const codes = r.data.reasons.map((x) => x.code);
  assert.ok(codes.includes("no_uplift"), `reasons: ${codes}`);
  assert.ok(codes.includes("zero_usage"), `uses=0 in the window → zero_usage; ${codes}`);
});

test("healthy: ablation with uplift=1 → verdict healthy", async () => {
  const h = await mk();
  await h.publish("oh-alive");
  await h.suite("oh-alive", SUITE_POSITIVE);
  await h.ablationDone("oh-alive");

  const r = await h.overhang("oh-alive");
  assert.equal(r.status, 200);
  assert.equal(r.data.verdict, "healthy", JSON.stringify(r.data));
  assert.equal(r.data.ablation.uplift, 1);
});

test("unknown: no ablation evidence → verdict unknown + no_ablation_data", async () => {
  const h = await mk();
  await h.publish("oh-blank");
  const r = await h.overhang("oh-blank");
  assert.equal(r.status, 200);
  assert.equal(r.data.verdict, "unknown", JSON.stringify(r.data));
  assert.equal(r.data.ablation, null);
  assert.ok(r.data.reasons.some((x) => x.code === "no_ablation_data"));
});

test("report: /lifecycle/overhang lists only overhang artifacts", async () => {
  const h = await mk();
  // data left by the previous tests: oh-dead (overhang), oh-alive (healthy), oh-blank (unknown)
  const r = await h.report();
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const names = r.data.items.map((x) => x.name);
  assert.ok(names.includes("oh-dead"), `report: ${names}`);
  assert.ok(!names.includes("oh-alive"), `healthy must not be in the report: ${names}`);
  assert.ok(!names.includes("oh-blank"), `unknown must not be in the report: ${names}`);
  const dead = r.data.items.find((x) => x.name === "oh-dead");
  assert.equal(dead.uplift, 0);
  assert.equal(dead.tasks, 1);
});

test("ACL: anon 401, viewer/contributor 403, invisible 404, reviewer+ 200", async () => {
  const h = await mk();
  assert.equal((await h.overhang("oh-dead", "anon")).status, 401);
  assert.equal((await h.overhang("oh-dead", "vera")).status, 403);
  assert.equal((await h.overhang("oh-dead", "alice")).status, 403);
  assert.equal((await h.overhang("oh-dead", "rita")).status, 200);
  assert.equal((await h.overhang("no-such", "rita")).status, 404);
  // report
  assert.equal((await h.report("anon")).status, 401);
  assert.equal((await h.report("vera")).status, 403);
  assert.equal((await h.report("rita")).status, 200);
});

test("read-only: the verdict and the report write no audit and do not change the status", async () => {
  const h = await mk();
  const before = await h.api("GET", `${h.A("oh-dead")}/audit`);
  const n0 = before.data.items.length;
  const detail0 = await h.api("GET", h.A("oh-dead"));
  const status0 = detail0.data.status;
  await h.overhang("oh-dead");
  await h.report();
  const afterR = await h.api("GET", `${h.A("oh-dead")}/audit`);
  assert.equal(afterR.data.items.length, n0, "audit is not appended to");
  const detail1 = await h.api("GET", h.A("oh-dead"));
  assert.equal(detail1.data.status, status0, "status unchanged");
});
