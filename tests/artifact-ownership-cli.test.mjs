// Acceptance tests for artifact ownership, part B (CLI): refusing to publish into someone else's artifact is clear to humans and machines.
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
let aliceToken;
let bobToken;

const cli = (args, token) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: work,
      env: { ...process.env, SKILLFORGE_CONFIG: join(work, "config.json"), NO_COLOR: "1", SKILLFORGE_URL: srv.base, SKILLFORGE_TOKEN: token },
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
  srv = await startServer({}, { prefix: "skillforge-own-cli-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  const admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const u of ["alice", "bob"]) await createUser(srv.base, admin.cookie, { username: u, password: `${u}-pw-123`, role: "contributor" });
  const token = async (u) => {
    const s = await login(srv.base, u, `${u}-pw-123`);
    return (await api(srv.base, "POST", "/api/v1/me/tokens", { name: "cli" }, { cookie: s.cookie })).data.token;
  };
  aliceToken = await token("alice");
  bobToken = await token("bob");
  work = mkdtempSync(join(tmpdir(), "skillforge-own-cli-work-"));
});

after(async () => {
  await srv?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("owner publishes; another contributor gets a clear refusal: exit code 1, owner name in stderr", async () => {
  const first = await cli(["publish", DIR, "--type", "skill"], aliceToken);
  assert.equal(first.code, 0, first.stdout + first.stderr);
  const denied = await cli(["publish", DIR, "--type", "skill", "--version", "0.2.0"], bobToken);
  assert.equal(denied.code, 1, denied.stdout + denied.stderr);
  assert.ok(denied.stderr.includes("alice"), `owner missing from stderr: ${denied.stderr}`);
  assert.match(denied.stderr, /owner/i, denied.stderr);
});

test("--json: error body as is", async () => {
  const denied = await cli(["publish", DIR, "--type", "skill", "--version", "0.3.0", "--json"], bobToken);
  assert.equal(denied.code, 1, denied.stdout + denied.stderr);
  const body = JSON.parse(denied.stdout);
  assert.equal(body.error, "not_owner");
  assert.equal(body.owner, "alice");
});
