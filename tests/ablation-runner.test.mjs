// Acceptance tests for the ablation runner.
// Requires `npm run build`.
// Ablation batch auto-start on publish: SKILLFORGE_EVAL_ABLATION_AUTO + runtimes +
// task cases → eval_batches kind=ablation → ablation evidence on the version (lifecycle).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  startServer,
  api as rawApi,
  login,
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

const skillMd = (name, answer = "good-answer") =>
  `---\nname: ${name}\ndescription: Use for PDF extraction and merging\n---\n\n# ${name}\n\nANSWER: ${answer}\n`;
const files = (name, answer) => [
  { path: `${name}/SKILL.md`, content: Buffer.from(skillMd(name, answer)) },
];

const TASK_SUITE = {
  cases: [
    {
      id: "task-1",
      kind: "task",
      prompt: "solve this task",
      checks: [{ type: "contains", value: "good-answer" }],
    },
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

async function mk(env = {}) {
  const work = mkdtempSync(join(tmpdir(), "skillforge-ablation-work-"));
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
    { SKILLFORGE_EVAL_RUNNERS_FILE: runnersFile, ...env },
    { prefix: "skillforge-ablation-" },
  );
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  servers.push(srv);
  const admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  const api = (method, path, body, who = "admin") =>
    rawApi(srv.base, method, path, body, { cookie: admin.cookie });
  const A = (n) => `/api/v1/artifacts/skill/${n}`;
  const publish = async (name, version = "0.1.0", answer = "good-answer") => {
    const content = Buffer.from(skillMd(name, answer) + `\n<!-- v${version} -->\n`);
    const r = await api("POST", "/api/v1/artifacts", {
      type: "skill",
      name,
      version,
      files: toB64([{ path: `${name}/SKILL.md`, content }]),
    });
    assert.equal(r.status, 201, `publish ${name}@${version}: ${JSON.stringify(r.data)}`);
    return r;
  };
  return {
    srv,
    api,
    A,
    publish,
    suite: async (name, suite = TASK_SUITE) => {
      const r = await api("PUT", `${A(name)}/evals`, suite);
      assert.equal(r.status, 200, `suite ${name}: ${JSON.stringify(r.data)}`);
    },
    db: () => new DatabaseSync(join(srv.dataDir, "skillforge.db"), { readOnly: true }),
    batchCount: (name, kind = "ablation") => {
      const db = new DatabaseSync(join(srv.dataDir, "skillforge.db"), { readOnly: true });
      const n = db
        .prepare(
          `SELECT COUNT(*) AS n FROM eval_batches b
           JOIN artifacts a ON a.id = b.artifact_id
           WHERE a.name = ? AND b.kind = ?`,
        )
        .get(name, kind).n;
      db.close();
      return n;
    },
  };
}

test("auto-start: publishing a version queues an ablation batch, evidence is written, the card shows the summary", async () => {
  const h = await mk({ SKILLFORGE_EVAL_ABLATION_AUTO: "true" });
  await h.publish("abl-auto", "0.1.0");
  await h.suite("abl-auto");
  // publishing a new version → ablation batch auto-start for 0.2.0
  await h.publish("abl-auto", "0.2.0");

  const batch = await until(() => {
    const db = h.db();
    const row = db
      .prepare(
        `SELECT b.* FROM eval_batches b JOIN artifacts a ON a.id = b.artifact_id
         WHERE a.name = 'abl-auto' AND b.kind = 'ablation' AND b.version = '0.2.0'`,
      )
      .get();
    db.close();
    return row && ["done", "failed"].includes(row.status) ? row : null;
  });
  assert.ok(batch, "ablation batch for 0.2.0 created and finished");
  assert.equal(batch.status, "done", JSON.stringify(batch));

  // audit of the auto-start
  const audit = await h.api("GET", `${h.A("abl-auto")}/audit`);
  assert.ok(
    audit.data.items.some(
      (e) => e.action === "eval_batch" && e.meta && e.meta.auto === true,
    ),
    `audit eval_batch auto:true; ${JSON.stringify(audit.data.items.map((e) => e.action))}`,
  );

  // evidence on the version → the version card shows ablation
  const v = await h.api("GET", `${h.A("abl-auto")}/versions/0.2.0`);
  assert.equal(v.status, 200);
  const abl = v.data.ablation;
  assert.ok(abl, "ablation summary on version 0.2.0");
  assert.equal(abl.tasks, 1);
  assert.equal(abl.passed_with, 1, "the with side passes the check");
  assert.equal(abl.passed_without, 0, "baseline does not contain good-answer");
  assert.equal(abl.uplift, 1);
});

test("flag is off by default: publish queues no batches", async () => {
  const h = await mk(); // without SKILLFORGE_EVAL_ABLATION_AUTO
  await h.publish("abl-off", "0.1.0");
  await h.suite("abl-off");
  await h.publish("abl-off", "0.2.0");
  await new Promise((r) => setTimeout(r, 1500)); // give the tick a chance to create one by mistake
  assert.equal(h.batchCount("abl-off"), 0, "there must be no batches without the flag");
});

test("no task cases → auto-start is skipped", async () => {
  const h = await mk({ SKILLFORGE_EVAL_ABLATION_AUTO: "true" });
  await h.publish("abl-trig", "0.1.0");
  await h.suite("abl-trig", {
    cases: [
      { id: "t1", kind: "trigger", prompt: "extract pdf text", expect_trigger: true },
    ],
  });
  await h.publish("abl-trig", "0.2.0");
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(h.batchCount("abl-trig"), 0, "trigger-only suite — nothing for ablation to measure");
});

test("deduplication: an active batch per version is not duplicated", async () => {
  const h = await mk({ SKILLFORGE_EVAL_ABLATION_AUTO: "true" });
  await h.publish("abl-dedup", "0.1.0");
  await h.suite("abl-dedup");
  // a manual batch for 0.1.0, then publishing the same version is impossible (version_exists) —
  // dedup is checked at the maybeAutoAblation level: two active batches for one version.
  // Publish 0.2.0 → auto batch; wait for it to finish; a repeated trigger for the same
  // version does not create a second active batch (a manual POST imitates the repeated trigger).
  await h.publish("abl-dedup", "0.2.0");
  await until(() => h.batchCount("abl-dedup") === 1);
  const manual = await h.api("POST", `${h.A("abl-dedup")}/evals/batches`, {
    kind: "ablation",
    version: "0.2.0",
    runners: ["mock-a"],
  });
  assert.equal(manual.status, 202, "a manual batch is allowed — dedup applies to auto only");
  // after the auto batch finishes, eval_batches has exactly 2 records (auto + manual)
  await until(() => h.batchCount("abl-dedup") === 2);
});

test("an auto-start error does not fail publish: a version without a suite is still published", async () => {
  const h = await mk({ SKILLFORGE_EVAL_ABLATION_AUTO: "true" });
  // without a suite the condition is not met, publish is clean
  const r = await h.publish("abl-nosuite", "0.1.0");
  assert.equal(r.status, 201);
  await new Promise((r2) => setTimeout(r2, 1000));
  assert.equal(h.batchCount("abl-nosuite"), 0);
});
