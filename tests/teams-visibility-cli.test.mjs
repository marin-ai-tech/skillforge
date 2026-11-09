// Teams and visibility, part B (CLI): teams, scope and labels from the command line.
// Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, FIXTURES, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const DIR = join(FIXTURES, "skill-standard", "pdf-tools");
let srv;
let work;
const T = {};

const cli = (args, who) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: work,
      env: { ...process.env, SKILLFORGE_CONFIG: join(work, "config.json"), NO_COLOR: "1", SKILLFORGE_URL: srv.base, SKILLFORGE_TOKEN: T[who] },
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

before(async () => {
  assert.ok(existsSync(CLI), `built CLI not found: ${CLI} — run npm run build`);
  srv = await startServer({}, { prefix: "skillforge-teams-cli-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  const admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  T.admin = (await api(srv.base, "POST", "/api/v1/me/tokens", { name: "cli" }, { cookie: admin.cookie })).data.token;
  for (const u of ["lena", "mia", "oscar"]) {
    await createUser(srv.base, admin.cookie, { username: u, password: `${u}-pw-123`, role: "contributor" });
    const s = await login(srv.base, u, `${u}-pw-123`);
    T[u] = (await api(srv.base, "POST", "/api/v1/me/tokens", { name: "cli" }, { cookie: s.cookie })).data.token;
  }
  work = mkdtempSync(join(tmpdir(), "skillforge-teams-cli-work-"));
});

after(async () => {
  await srv?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("teams: create (admin), list, show, add, remove; exit codes and --json", async () => {
  let r = await cli(["teams", "create", "alpha", "--lead", "lena", "--json"], "lena");
  assert.notEqual(r.code, 0, "a non-admin does not create a team");
  r = await cli(["teams", "create", "alpha", "--lead", "lena", "--json"], "admin");
  assert.equal(r.code, 0, r.stdout + r.stderr);
  r = await cli(["teams", "create", "Bad Name", "--lead", "lena"], "admin");
  assert.equal(r.code, 1, "validation — exit code 1 per the existing CLI contract"+ r.stdout + r.stderr);
  r = await cli(["teams", "add", "alpha", "mia", "--role", "member", "--json"], "lena");
  assert.equal(r.code, 0, r.stdout + r.stderr);
  r = await cli(["teams", "list", "--json"], "mia");
  assert.equal(r.code, 0);
  const alpha = JSON.parse(r.stdout).items.find((t) => t.name === "alpha");
  assert.equal(alpha.is_member, true);
  r = await cli(["teams", "show", "alpha", "--json"], "mia");
  assert.deepEqual(JSON.parse(r.stdout).members.map((m) => m.username).sort(), ["lena", "mia"]);
  r = await cli(["teams", "show", "nope"], "mia");
  assert.equal(r.code, 6, r.stdout + r.stderr);
  r = await cli(["teams", "remove", "alpha", "lena"], "lena");
  assert.notEqual(r.code, 0, "the last lead cannot be removed (409)");
  r = await cli(["teams", "remove", "alpha", "mia", "--json"], "lena");
  assert.equal(r.code, 0, r.stdout + r.stderr);
  await cli(["teams", "add", "alpha", "mia"], "lena");
});

test("publish --visibility team --team: a member publishes, an outsider gets a clear refusal; info and list hide it", async () => {
  const ok = await cli(["publish", DIR, "--type", "skill", "--visibility", "team", "--team", "alpha", "--json"], "lena");
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  assert.equal(JSON.parse(ok.stdout).artifact.visibility, "team");
  const denied = await cli(["publish", DIR, "--type", "skill", "--visibility", "team", "--team", "alpha", "--version", "0.2.0"], "oscar");
  assert.equal(denied.code, 1, denied.stdout + denied.stderr);
  const noTeam = await cli(["publish", DIR, "--type", "skill", "--visibility", "team", "--version", "0.3.0"], "lena");
  assert.equal(noTeam.code, 1, noTeam.stdout + noTeam.stderr);

  const info = await cli(["info", "skill/pdf-tools"], "oscar");
  assert.equal(info.code, 6, "an outsider does not see it via the CLI");
  const list = JSON.parse((await cli(["list", "--json"], "oscar")).stdout);
  assert.ok(!list.items.some((i) => i.name === "pdf-tools"));
  const mine = JSON.parse((await cli(["list", "--team", "alpha", "--json"], "mia")).stdout);
  assert.deepEqual(mine.items.map((i) => i.name), ["pdf-tools"]);
  assert.equal(JSON.parse((await cli(["list", "--visibility", "team", "--json"], "mia")).stdout).items.length, 1);
  assert.equal(JSON.parse((await cli(["list", "--owner", "lena", "--json"], "mia")).stdout).items.length, 1);
});

test("scope and labels: scope change, labels, --label filter, refusals", async () => {
  let r = await cli(["scope", "skill/pdf-tools", "--visibility", "org", "--reason", "open it up", "--json"], "oscar");
  assert.equal(r.code, 6, "an outsider does not see the artifact — 404 → exit code 6");
  r = await cli(["labels", "skill/pdf-tools", "set", "payments,team-a", "--json"], "lena");
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const l = JSON.parse((await cli(["list", "--label", "payments", "--json"], "mia")).stdout);
  assert.deepEqual(l.items.map((i) => i.name), ["pdf-tools"]);
  r = await cli(["labels", "skill/pdf-tools", "set", "Bad Label"], "lena");
  assert.equal(r.code, 1, r.stdout + r.stderr);
  r = await cli(["scope", "skill/pdf-tools", "--visibility", "team"], "lena");
  assert.equal(r.code, 1, "team without --team — an input error, exit code 1");
  r = await cli(["scope", "skill/pdf-tools", "--visibility", "org", "--reason", "open it up", "--json"], "lena");
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal((await cli(["info", "skill/pdf-tools"], "oscar")).code, 0, "after widening, an outsider sees it");
  const help = await cli(["--help"], "lena");
  assert.ok(help.stdout.includes("teams") && help.stdout.includes("scope") && help.stdout.includes("labels"), help.stdout);
});
