// Routines engine. Requires `npm run build`.
// Routine commands run `node -e` — cross-platform, without external runtimes.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
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
    // Windows: rmSync of dataDir fails with EPERM while the OS is still releasing the server's DB files —
    // stopping is mandatory, deleting the temp directory is best-effort (the OS will sweep it).
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
const cmd = (code, extra = {}) => ({ argv: [NODE, "-e", code], ...extra });
const def = (schedule, command, extra = {}) => ({
  version: 1,
  schedule,
  command,
  ...extra,
});
const EVERY_1S = { kind: "every", seconds: 1 };

const until = async (fn, { timeout = 45000, step = 150 } = {}) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return v;
    await new Promise((r) => setTimeout(r, step));
  }
};

const skillMd = (name) =>
  `---\nname: ${name}\ndescription: Routine test skill\n---\n\n# ${name}\n`;

async function mk() {
  const srv = await startServer({ SKILLFORGE_ORCHESTRATION_ENABLED: "true" }, { prefix: "skillforge-rt-" });
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
  // Definitions (PUT/DELETE, enabling a routine) are saved by admin only; everything else by the owner.
  const adminOnly = (method, path) => method === "PUT" || method === "DELETE" || /\/routines\/[^/]+\/enable$/.test(path);
  const api = (method, path, body, who = adminOnly(method, path) ? "admin" : "alice") =>
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
    rt: (name, rt) => `${A(name)}/routines/${rt}`,
    save: async (name, rt, definition, who = "admin") => {
      const r = await api("PUT", h.rt(name, rt), { definition }, who);
      assert.equal(r.status, 200, `save ${name}/${rt}: ${JSON.stringify(r.data)}`);
      return r;
    },
    runs: async (name, who = "alice") => {
      const r = await api("GET", `${A(name)}/routines/runs`, undefined, who);
      assert.equal(r.status, 200, JSON.stringify(r.data));
      return r.data.items;
    },
    finished: async (name, n = 1, who = "alice") => {
      const items = await until(async () => {
        const list = await h.runs(name, who);
        const done = list.filter((r) => ["done", "failed", "skipped"].includes(r.status));
        return done.length >= n ? list : null;
      });
      assert.ok(items, `fewer than ${n} finished runs for ${name}`);
      return items;
    },
    stateDir: (name) => {
      const db = h.db();
      const art = db
        .prepare("SELECT id FROM artifacts WHERE name = ?")
        .get(name);
      return join(srv.dataDir, "routines", art.id);
    },
    db: () => new DatabaseSync(join(srv.dataDir, "skillforge.db"), { readOnly: true }),
  };
  return h;
}

test("definition: validation, CRUD, audit", async () => {
  const h = await mk();
  await h.pub("rt-def");
  // invalid definitions → 422 with a list of errors
  for (const bad of [
    def({ kind: "cron", expr: "* * * * * *" }, cmd("1")), // cron: 6 fields
    def({ kind: "every", seconds: 0 }, cmd("1")), // seconds < 1
    def({ kind: "weekly", day: 1 }, cmd("1")), // unknown kind
    def(EVERY_1S, { argv: "node -e 1" }), // argv is not an array
    def(EVERY_1S, cmd("1", { env: ["SKILLFORGE_TOKEN"] })),
    def(EVERY_1S, cmd("1", { timeout_s: 0 })),
    def(EVERY_1S, cmd("1"), { budgets: { max_runs_per_day: 0 } }),
    { version: 2, schedule: EVERY_1S, command: cmd("1") },
  ]) {
    const r = await h.api("PUT", h.rt("rt-def", "tick"), { definition: bad });
    assert.equal(r.status, 422, `${JSON.stringify(bad)}: ${JSON.stringify(r.data)}`);
    assert.ok(Array.isArray(r.data.errors) && r.data.errors.length > 0, "errors list");
  }
  // invalid routine_id
  const badId = await h.api("PUT", h.rt("rt-def", "BAD ID"), {
    definition: def(EVERY_1S, cmd("1")),
  });
  assert.equal(badId.status, 422);
  // a valid one is saved, next_run_at is set
  const ok = await h.api("PUT", h.rt("rt-def", "tick"), {
    definition: def({ kind: "cron", expr: "0 3 * * *" }, cmd("console.log('x')"), {
      timeout_s: 30,
    }),
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const got = await h.api("GET", h.rt("rt-def", "tick"));
  assert.equal(got.status, 200);
  assert.equal(got.data.routine.enabled, 1);
  assert.ok(got.data.routine.next_run_at, "next_run_at is computed for cron");
  const list = await h.api("GET", `${h.A("rt-def")}/routines`);
  assert.ok(list.data.items.some((w) => w.routine_id === "tick"), "routine is in the list");
  const audit = await h.api("GET", `${h.A("rt-def")}/audit`, undefined, "admin");
  assert.ok(audit.data.items.some((e) => e.action === "routine_save"), "audit routine_save");
});

test("schedule: firing, runs and outputs, isolated memory", async () => {
  const h = await mk();
  await h.pub("rt-fire");
  // the command writes a mark into its OWN persistent cwd → the second run sees the first run's file
  await h.save(
    "rt-fire",
    "tick",
    def(EVERY_1S, cmd("require('fs').appendFileSync('marks.txt','x'); console.log('ticked')")),
  );
  const runs = await h.finished("rt-fire", 2);
  const done = runs.filter((r) => r.status === "done");
  assert.ok(done.length >= 2, `expected ≥2 done, got ${done.length}`);
  assert.ok(
    done.every((r) => r.trigger === "schedule"),
    "scheduled runs have trigger=schedule",
  );
  // isolated memory: the file accumulated two marks
  const dir = h.stateDir("rt-fire");
  assert.ok(existsSync(join(dir, "tick", "marks.txt")), "the routine state directory exists");
  assert.equal(readFileSync(join(dir, "tick", "marks.txt"), "utf8"), "xx");
  // outputs are in run_outputs
  const outs = await h.api(
    "GET",
    `${h.A("rt-fire")}/run-outputs?run_id=${encodeURIComponent(`rt:${done[0].id}`)}`,
    undefined,
    "rita",
  );
  assert.equal(outs.status, 200, JSON.stringify(outs.data));
  assert.ok(
    outs.data.items.some((o) => o.stream === "stdout" && o.run_kind === "routine"),
    "stdout of the routine run is in run_outputs",
  );
});

test("manual start: trigger=manual, 202", async () => {
  const h = await mk();
  await h.pub("rt-manual");
  // the schedule is far off — only the manual start fires
  await h.save("rt-manual", "tick", def({ kind: "every", seconds: 3600 }, cmd("console.log('hi')")));
  const r = await h.api("POST", `${h.rt("rt-manual", "tick")}/run`, {});
  assert.equal(r.status, 202, JSON.stringify(r.data));
  const items = await h.finished("rt-manual", 1);
  assert.equal(items[0].status, "done");
  assert.equal(items[0].trigger, "manual");
});

test("daily budget: max_runs_per_day → skipped, manual → 429", async () => {
  const h = await mk();
  await h.pub("rt-budget");
  await h.save(
    "rt-budget",
    "tick",
    def(EVERY_1S, cmd("1"), { budgets: { max_runs_per_day: 1 } }),
  );
  // the first run is done, the second firing is skipped
  const items = await h.finished("rt-budget", 2);
  const statuses = items.map((r) => r.status).sort();
  assert.ok(statuses.includes("done"), "the first run was executed");
  assert.ok(statuses.includes("skipped"), "the second firing was skipped by the budget");
  const manual = await h.api("POST", `${h.rt("rt-budget", "tick")}/run`, {});
  assert.equal(manual.status, 429, JSON.stringify(manual.data));
});

test("auto-disable: a series of failures → enabled=0 + audit", async () => {
  const h = await mk();
  await h.pub("rt-fail");
  await h.save(
    "rt-fail",
    "tick",
    def(EVERY_1S, cmd("process.exit(2)"), { budgets: { max_consecutive_failures: 2 } }),
  );
  const items = await h.finished("rt-fail", 2);
  const failed = items.filter((r) => r.status === "failed");
  assert.ok(failed.length >= 2, "two failed runs");
  const got = await h.api("GET", h.rt("rt-fail", "tick"));
  assert.equal(got.data.routine.enabled, 0, "the routine is disabled after a series of failures");
  const audit = await h.api("GET", `${h.A("rt-fail")}/audit`, undefined, "admin");
  assert.ok(
    audit.data.items.some((e) => e.action === "routine_auto_disabled"),
    "audit routine_auto_disabled",
  );
});

test("kill switch: disable stops firings", async () => {
  const h = await mk();
  await h.pub("rt-kill");
  await h.save("rt-kill", "tick", def(EVERY_1S, cmd("1")));
  await h.finished("rt-kill", 1);
  const d = await h.api("POST", `${h.rt("rt-kill", "tick")}/disable`, {});
  assert.equal(d.status, 200, JSON.stringify(d.data));
  const got = await h.api("GET", h.rt("rt-kill", "tick"));
  assert.equal(got.data.routine.enabled, 0);
  // wait two schedule intervals — there must be no new runs
  const countBefore = (await h.runs("rt-kill")).length;
  await new Promise((r) => setTimeout(r, 3000));
  const countAfter = (await h.runs("rt-kill")).length;
  assert.equal(countAfter, countBefore, "no runs after disable");
});

test("timeout: run failed + timed_out", async () => {
  const h = await mk();
  await h.pub("rt-timeout");
  await h.save(
    "rt-timeout",
    "tick",
    def({ kind: "every", seconds: 3600 }, cmd("setTimeout(()=>{},60000)", { timeout_s: 1 })),
  );
  await h.api("POST", `${h.rt("rt-timeout", "tick")}/run`, {});
  const items = await h.finished("rt-timeout", 1);
  assert.equal(items[0].status, "failed");
  assert.ok(items[0].timed_out === 1 || items[0].timed_out === true, "timed_out");
});

test("ACL: 404/401/403 chain as for evals", async () => {
  const h = await mk();
  await h.pub("rt-acl");
  await h.save("rt-acl", "tick", def({ kind: "every", seconds: 3600 }, cmd("1")));
  const anon = await h.api("GET", `${h.A("rt-acl")}/routines`, undefined, "anon");
  assert.equal(anon.status, 401);
  const viewer = await h.api("GET", `${h.A("rt-acl")}/routines`, undefined, "vera");
  assert.equal(viewer.status, 403);
  const viewerPost = await h.api("POST", `${h.rt("rt-acl", "tick")}/run`, {}, "vera");
  assert.equal(viewerPost.status, 403);
  const rev = await h.api("GET", `${h.A("rt-acl")}/routines`, undefined, "rita");
  assert.equal(rev.status, 200);
  const ghost = await h.api("GET", `${h.A("no-such")}/routines`, undefined, "rita");
  assert.equal(ghost.status, 404);
});

test("purge: routine tables and the state directory are cleaned", async () => {
  const h = await mk();
  await h.pub("rt-purge");
  await h.save("rt-purge", "tick", def(EVERY_1S, cmd("require('fs').writeFileSync('s.txt','1')")));
  await h.finished("rt-purge", 1);
  const dir = h.stateDir("rt-purge");
  assert.ok(existsSync(dir), "the state directory exists before purge");
  const db = h.db();
  for (const t of ["routines", "routine_runs"]) {
    assert.ok(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n > 0, `${t} is populated`);
  }
  const p = await h.api(
    "POST",
    `${h.A("rt-purge")}/purge`,
    { confirm: "skill/rt-purge", reason: "routines test cleanup" },
    "admin",
  );
  assert.equal(p.status, 200, JSON.stringify(p.data));
  for (const t of ["routines", "routine_runs"]) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, `${t} is cleaned`);
  }
  assert.ok(!existsSync(dir), "the state directory is removed by purge");
});
