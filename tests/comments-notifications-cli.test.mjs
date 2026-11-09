// Acceptance tests for the comments, notification feed and watching CLI commands. Requires `npm run build`.
// Exit codes follow the existing CLI contract: 0 success, 1 validation/input error, 2 conflict, 3 registry not set, 4 not signed in / no permission, 6 not found.
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

const cli = (args, who, env = {}) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: work,
      env: { ...process.env, SKILLFORGE_CONFIG: join(work, "config.json"), NO_COLOR: "1", SKILLFORGE_URL: srv.base, SKILLFORGE_TOKEN: T[who], ...env },
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
  srv = await startServer({}, { prefix: "skillforge-comments-cli-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  const admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const u of ["alice", "bob", "carol"]) {
    await createUser(srv.base, admin.cookie, { username: u, password: `${u}-pw-123`, role: "contributor" });
    const s = await login(srv.base, u, `${u}-pw-123`);
    T[u] = (await api(srv.base, "POST", "/api/v1/me/tokens", { name: "cli" }, { cookie: s.cookie })).data.token;
  }
  work = mkdtempSync(join(tmpdir(), "skillforge-comments-cli-work-"));
  const p = await cli(["publish", DIR, "--type", "skill", "--json"], "alice");
  assert.equal(p.code, 0, p.stdout + p.stderr);
});

after(async () => {
  await srv?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("comment / comments: creation, version, reply, thread, exit codes and --json", async () => {
  let r = await cli(["comment", "skill/pdf-tools", "--body", "Hello @alice, question for 0.1.0", "--version", "0.1.0", "--json"], "bob");
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const c = JSON.parse(r.stdout).comment;
  assert.equal(c.author, "bob");
  assert.deepEqual(c.mentions, ["alice"]);
  r = await cli(["comment", "skill/pdf-tools", "--body", "Answer", "--reply", c.id, "--json"], "carol");
  assert.equal(r.code, 0, r.stdout + r.stderr);
  r = await cli(["comments", "skill/pdf-tools", "--version", "0.1.0", "--json"], "alice");
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const items = JSON.parse(r.stdout).items;
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].replies.map((x) => x.author), ["carol"]);
  const human = await cli(["comments", "skill/pdf-tools"], "alice");
  assert.equal(human.code, 0);
  assert.ok(human.stdout.includes("bob") && human.stdout.includes("Answer"), human.stdout);

  assert.equal((await cli(["comment", "skill/pdf-tools", "--body", ""], "bob")).code, 1, "empty text is an input error");
  assert.equal((await cli(["comment", "skill/pdf-tools", "--body", "x", "--version", "9.9.9"], "bob")).code, 6, "unknown version");
  assert.equal((await cli(["comment", "skill/nope", "--body", "x"], "bob")).code, 6, "no such artifact");
});

test("notifications: feed, --unread, read --all / <id>, counter; watch / --off", async () => {
  let r = await cli(["notifications", "--unread", "--json"], "alice");
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const feed = JSON.parse(r.stdout);
  assert.ok(feed.unread_count >= 1, JSON.stringify(feed));
  const kinds = feed.items.map((n) => n.kind);
  assert.ok(kinds.includes("mention") || kinds.includes("comment"), kinds.join(","));
  const human = await cli(["notifications"], "alice");
  assert.equal(human.code, 0);
  assert.ok(/unread/i.test(human.stdout), human.stdout);

  const one = feed.items[0].id;
  r = await cli(["notifications", "read", one, "--json"], "alice");
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).updated, 1);
  r = await cli(["notifications", "read", "--all", "--json"], "alice");
  assert.equal(r.code, 0);
  assert.equal(JSON.parse((await cli(["notifications", "--unread", "--json"], "alice")).stdout).unread_count, 0);

  r = await cli(["watch", "skill/pdf-tools", "--json"], "carol");
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).watching, true);
  r = await cli(["watch", "skill/pdf-tools", "--off", "--json"], "carol");
  assert.equal(JSON.parse(r.stdout).watching, false);
  assert.equal((await cli(["watch", "skill/nope"], "carol")).code, 6);
  const help = await cli(["--help"], "alice");
  for (const w of ["comments", "comment", "notifications", "watch"]) assert.ok(help.stdout.includes(w), `no ${w} in --help`);
});
