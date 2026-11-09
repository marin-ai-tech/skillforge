// Acceptance tests for lifecycle-by-data, part B (CLI): evidence ablation, hold, sweep, cleanup board.
// Requires `npm run build`.
// Exit codes are the existing CLI contract: 0 success, 1 server validation error and not_owner, 2 conflict and local flag error
// (as with `evidence add`), 3 registry not set, 4 not logged in / no permission, 6 not found.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, FIXTURES, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const DIR = join(FIXTURES, "skill-standard", "pdf-tools");
const A = "/api/v1/artifacts/skill/pdf-tools";
let srv;
let work;
const T = {};
const C = {}; // cookies

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
    const timer = setTimeout(() => child.kill(), 60000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
const rest = (method, path, body, who) => api(srv.base, method, path, body, { cookie: C[who].cookie });
const tomorrow = () => new Date(Date.now() + 86400000 * 3).toISOString();

before(async () => {
  assert.ok(existsSync(CLI), `built CLI not found: ${CLI} — run npm run build`);
  srv = await startServer({ SKILLFORGE_AGING_DAYS: "3650", SKILLFORGE_ZOMBIE_WINDOW_DAYS: "30", SKILLFORGE_ZOMBIE_RETIRE_DAYS: "0" }, { prefix: "skillforge-lcd-cli-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  C.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  T.admin = (await api(srv.base, "POST", "/api/v1/me/tokens", { name: "cli" }, { cookie: C.admin.cookie })).data.token;
  for (const [u, role] of [["alice", "contributor"], ["bob", "contributor"], ["rita", "reviewer"], ["r1", "contributor"], ["r2", "contributor"], ["r3", "contributor"]]) {
    await createUser(srv.base, C.admin.cookie, { username: u, password: `${u}-pw-123`, role });
    C[u] = await login(srv.base, u, `${u}-pw-123`);
    T[u] = (await api(srv.base, "POST", "/api/v1/me/tokens", { name: "cli" }, { cookie: C[u].cookie })).data.token;
  }
  work = mkdtempSync(join(tmpdir(), "skillforge-lcd-cli-work-"));
  const p = await cli(["publish", DIR, "--type", "skill", "--json"], "alice");
  assert.equal(p.code, 0, p.stdout + p.stderr);
  assert.equal((await rest("POST", `${A}/transitions`, { to: "active", reason: "go" }, "rita")).status, 200);
});

after(async () => {
  await srv?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("evidence add --kind ablation: ablation report, boundaries, permissions", async () => {
  const base = ["evidence", "add", "skill/pdf-tools@0.1.0", "--kind", "ablation", "--url", "https://ci.example/abl/1"];
  const ok = await cli([...base, "--tasks", "20", "--passed-with", "16", "--passed-without", "10", "--runner", "ci", "--json"], "alice");
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  const ev = JSON.parse(ok.stdout).evidence.filter((e) => e.kind === "ablation");
  assert.equal(ev.length, 1);
  assert.equal(ev[0].uplift, 0.3);
  assert.equal(ev[0].data.tasks, 20);
  const human = await cli([...base.slice(0, -1), "https://ci.example/abl/2", "--tasks", "20", "--passed-with", "16", "--passed-without", "10"], "alice");
  assert.equal(human.code, 0, human.stdout + human.stderr);
  assert.ok(/ablation/i.test(human.stdout), human.stdout);

  // boundaries: local flag errors (1 or 2) and server validation
  for (const flags of [["--tasks", "20", "--passed-with", "30", "--passed-without", "1"], ["--tasks", "0", "--passed-with", "0", "--passed-without", "0"], ["--passed-with", "1", "--passed-without", "1"], ["--tasks", "x", "--passed-with", "1", "--passed-without", "1"]]) {
    const r = await cli([...base.slice(0, -1), `https://ci.example/abl/bad-${flags.join("")}`, ...flags], "alice");
    assert.ok([1, 2].includes(r.code), `${flags.join(" ")} -> ${r.code}: ${r.stdout}${r.stderr}`);
  }
  const gate = await cli(["evidence", "add", "skill/pdf-tools@0.1.0", "--kind", "gate", "--url", "https://ci.example/g/1", "--tasks", "5"], "alice");
  assert.ok([1, 2].includes(gate.code), "--tasks is allowed only for ablation");
  assert.equal((await cli([...base.slice(0, -1), "https://ci.example/abl/3", "--tasks", "5", "--passed-with", "3", "--passed-without", "1"], "bob")).code, 1, "non-owner — not_owner");
  assert.equal((await cli([...base.slice(0, -1), "https://ci.example/abl/4", "--tasks", "5", "--passed-with", "3", "--passed-without", "1"], undefined)).code, 4, "not logged in");
});

test("lifecycle hold: set, remove, boundaries, permissions", async () => {
  const until = tomorrow();
  const set = await cli(["lifecycle", "hold", "skill/pdf-tools", "--until", until, "--reason", "release freeze", "--json"], "rita");
  assert.equal(set.code, 0, set.stdout + set.stderr);
  const hold = JSON.parse(set.stdout).hold;
  assert.equal(hold.reason, "release freeze");
  assert.equal(hold.set_by, "rita");
  assert.equal(Date.parse(hold.until), Date.parse(until));
  const seen = (await rest("GET", `${A}/lifecycle`, undefined, "alice")).data;
  assert.equal(seen.hold?.reason, "release freeze");

  for (const args of [["--until", "not-a-date", "--reason", "release freeze"], ["--until", "2020-01-01T00:00:00Z", "--reason", "release freeze"], ["--until", until, "--reason", "x"], ["--until", until]]) {
    const r = await cli(["lifecycle", "hold", "skill/pdf-tools", ...args], "rita");
    assert.ok([1, 2].includes(r.code), `${args.join(" ")} -> ${r.code}`);
  }
  assert.equal((await cli(["lifecycle", "hold", "skill/pdf-tools", "--until", until, "--reason", "release freeze"], "alice")).code, 4, "owner without the reviewer role");
  assert.equal((await cli(["lifecycle", "hold", "skill/nope", "--until", until, "--reason", "release freeze"], "rita")).code, 6);

  // while the hold is in effect, the sweep skips it
  const sweep = await cli(["lifecycle", "sweep", "--dry-run", "--json"], "admin");
  assert.equal(sweep.code, 0, sweep.stdout + sweep.stderr);
  assert.equal(JSON.parse(sweep.stdout).dry_run, true);

  const off = await cli(["lifecycle", "hold", "skill/pdf-tools", "--off", "--json"], "rita");
  assert.equal(off.code, 0, off.stdout + off.stderr);
  assert.equal(JSON.parse(off.stdout).hold, null);
  assert.equal((await rest("GET", `${A}/lifecycle`, undefined, "alice")).data.hold, null);
});

test("lifecycle sweep and board: dry run of the plan, real sweep, cleanup with a reason; permissions", async () => {
  for (const u of ["r1", "r2", "r3"]) assert.equal((await rest("POST", `${A}/usage`, { uses: 20, helped: 0 }, u)).status, 201);

  assert.equal((await cli(["lifecycle", "sweep", "--dry-run"], "rita")).code, 4, "not admin");
  assert.equal((await cli(["lifecycle", "sweep", "--dry-run"], undefined)).code, 4, "not logged in");

  const dry = await cli(["lifecycle", "sweep", "--dry-run", "--json"], "admin");
  assert.equal(dry.code, 0, dry.stdout + dry.stderr);
  const plan = JSON.parse(dry.stdout);
  assert.equal(plan.dry_run, true);
  assert.ok(plan.plan.some((p) => p.name === "pdf-tools" && p.to === "zombie" && p.rule === "low_transfer"), JSON.stringify(plan));
  assert.equal((await rest("GET", A, undefined, "alice")).data.artifact.status, "active", "dry run changes nothing");
  const humanDry = await cli(["lifecycle", "sweep", "--dry-run"], "admin");
  assert.equal(humanDry.code, 0);
  assert.ok(humanDry.stdout.includes("pdf-tools") && humanDry.stdout.includes("low_transfer"), humanDry.stdout);

  const real = await cli(["lifecycle", "sweep", "--json"], "admin");
  assert.equal(real.code, 0, real.stdout + real.stderr);
  assert.equal(JSON.parse(real.stdout).dry_run, false);
  assert.equal(JSON.parse(real.stdout).zombied, 1);
  assert.equal((await rest("GET", A, undefined, "alice")).data.artifact.status, "zombie");

  const board = await cli(["lifecycle", "--json"], "rita");
  assert.equal(board.code, 0, board.stdout + board.stderr);
  const item = JSON.parse(board.stdout).cleanup.find((c) => c.name === "pdf-tools");
  assert.ok(item, board.stdout);
  assert.equal(item.reasons[0].code, "low_transfer");
  const human = await cli(["lifecycle"], "rita");
  assert.equal(human.code, 0);
  assert.ok(human.stdout.includes("pdf-tools") && human.stdout.includes("low_transfer"), human.stdout);
  const plain = await cli(["lifecycle", "--json"], "alice");
  assert.equal(plain.code, 0);
  assert.deepEqual(JSON.parse(plain.stdout).cleanup, [], "an ordinary user does not see the section");
  assert.equal((await cli(["lifecycle", "--json"], undefined)).code, 4, "not logged in");
});
