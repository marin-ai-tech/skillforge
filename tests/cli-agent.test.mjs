// Acceptance tests for the `skillforge agent *` CLI commands.
// Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, loadDir, toB64, FIXTURES, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const LOCAL_NOTES = "---\nname: local-notes\ndescription: Keeps short project notes and reminders. Use when the user asks to remember or recall a note.\n---\n\n# Local notes\n\nStore notes in `notes.md`; recall them on request.\n";

let srv;
let base;
let work;
let configPath;
let agentDir;

function cli(args, { env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: work,
      env: { ...process.env, SKILLFORGE_CONFIG: configPath, NO_COLOR: "1", SKILLFORGE_URL: undefined, SKILLFORGE_TOKEN: undefined, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

before(async () => {
  assert.ok(existsSync(CLI), `built CLI not found: ${CLI}`);
  srv = await startServer({}, { prefix: "skillforge-cli-agent-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  const admin = await login(base, "admin", ADMIN_PASSWORD);
  await createUser(base, admin.cookie, { username: "alice", password: "alice-pw-1", role: "contributor" });
  const alice = await login(base, "alice", "alice-pw-1");
  const token = (await api(base, "POST", "/api/v1/me/tokens", { name: "cli" }, { cookie: alice.cookie })).data.token;
  for (const [type, dir] of [["skill", "skill-standard"], ["command", "command-propose"]]) {
    const r = await api(base, "POST", "/api/v1/artifacts", { type, files: toB64(loadDir(join(FIXTURES, dir))) }, { token });
    assert.equal(r.status, 201);
  }
  work = mkdtempSync(join(tmpdir(), "skillforge-cli-agent-work-"));
  configPath = join(work, "config.json");
  const login1 = await cli(["login", "--url", base, "--token", token]);
  assert.equal(login1.code, 0, login1.stderr);

  // Agent directory on disk: pdf-tools as in the registry (+ lock), local-notes new, propose modified, junk.
  agentDir = join(work, "proj", ".claude");
  mkdirSync(join(agentDir, "skills"), { recursive: true });
  cpSync(join(FIXTURES, "skill-standard", "pdf-tools"), join(agentDir, "skills", "pdf-tools"), { recursive: true });
  mkdirSync(join(agentDir, "skills", "local-notes"), { recursive: true });
  writeFileSync(join(agentDir, "skills", "local-notes", "SKILL.md"), LOCAL_NOTES);
  mkdirSync(join(agentDir, "commands"), { recursive: true });
  writeFileSync(join(agentDir, "commands", "propose.md"), `${loadDir(join(FIXTURES, "command-propose"))[0].content.toString("utf8")}\n\nLocal tweak.\n`);
  mkdirSync(join(agentDir, "node_modules", "x"), { recursive: true });
  writeFileSync(join(agentDir, "node_modules", "x", "SKILL.md"), "---\nname: x\ndescription: ignored\n---\n\nBody.\n");
  writeFileSync(join(agentDir, "settings.json"), "{}\n");
  writeFileSync(join(agentDir, ".skillforge-lock.json"), JSON.stringify({ registry: base, artifacts: { "skill/pdf-tools": { version: "0.1.0", digest: "", files: {}, installed_at: "2026-09-19T00:00:00.000Z" } } }));
});

after(async () => {
  if (srv?.up) await srv.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("agent scan: summary and table; node_modules and settings.json do not interfere", async () => {
  const noName = await cli(["agent", "scan", agentDir]);
  assert.equal(noName.code, 1, noName.stdout + noName.stderr);
  const noDir = await cli(["agent", "scan", join(work, "nope"), "--name", "laptop"]);
  assert.equal(noDir.code, 1, noDir.stdout + noDir.stderr);
  const r = await cli(["agent", "scan", agentDir, "--name", "laptop"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.includes("local_only=1") && r.stdout.includes("in_sync=1") && r.stdout.includes("modified=1"), r.stdout);
  assert.ok(/skill\/local-notes\s+local_only/.test(r.stdout.replace(/\s+/g, " ")) || /local-notes[^\n]*local_only/.test(r.stdout), r.stdout);
  assert.ok(/pdf-tools[^\n]*in_sync/.test(r.stdout), r.stdout);
  assert.ok(/propose[^\n]*modified/.test(r.stdout), r.stdout);
  assert.ok(!r.stdout.includes("node_modules"), "junk directories must not appear in the output");
  const json = await cli(["agent", "scan", agentDir, "--name", "laptop", "--json"]);
  assert.equal(json.code, 0, json.stderr);
  const parsed = JSON.parse(json.stdout);
  assert.deepEqual(parsed.summary, { local_only: 1, in_sync: 1, outdated: 0, modified: 1, registry_only: 0 });
  assert.equal(parsed.items.find((i) => i.key === "skill/pdf-tools").local.version, "0.1.0", "version is taken from .skillforge-lock.json");
  // A file outside the artifacts does not go to the server (empty `skipped`); the CLI reports it locally.
  assert.deepEqual(parsed.skipped, []);
  assert.deepEqual(parsed.not_sent, ["settings.json"]);
});

// fix-reckon-agent-scan: a scan from inside .reckon finds the learned skills, as a scan of its parent does.
test("agent scan --runtime reckon from inside .reckon: skills/<name>.md is a Reckon skill", async () => {
  const parent = join(work, "reckon-agent");
  const reckon = join(parent, ".reckon");
  mkdirSync(join(reckon, "skills"), { recursive: true });
  writeFileSync(join(reckon, "skills", "nutrition.md"), "---\nname: nutrition\ndescription: Plans meals. Use when asked about nutrition.\n---\n\nEat well.\n");
  const inside = await cli(["agent", "scan", reckon, "--name", "reckon-in", "--runtime", "reckon", "--json"]);
  assert.equal(inside.code, 0, inside.stdout + inside.stderr);
  const a = JSON.parse(inside.stdout);
  assert.ok(a.items.some((i) => i.key === "skill/nutrition"), JSON.stringify(a.items));
  assert.deepEqual(a.not_sent, []);
  // Negative: the entry point does not change the result.
  const outside = await cli(["agent", "scan", parent, "--name", "reckon-out", "--runtime", "reckon", "--json"]);
  assert.equal(outside.code, 0, outside.stdout + outside.stderr);
  assert.ok(JSON.parse(outside.stdout).items.some((i) => i.key === "skill/nutrition"), outside.stdout);
});

test("agent status / list / publish / rm and exit codes", async () => {
  const status = await cli(["agent", "status", "--name", "laptop", "--json"]);
  assert.equal(status.code, 0, status.stderr);
  const parsed = JSON.parse(status.stdout);
  assert.equal(parsed.agent.name, "laptop");
  assert.equal(parsed.items.length, 3);
  const table = await cli(["agent", "status", "--name", "laptop"]);
  assert.ok(table.stdout.includes("local_only=1"), table.stdout);
  const list = await cli(["agent", "list"]);
  assert.equal(list.code, 0, list.stderr);
  assert.ok(list.stdout.includes("laptop"), list.stdout);

  const pub = await cli(["agent", "publish", "skill/local-notes", "--name", "laptop"]);
  assert.equal(pub.code, 0, pub.stdout + pub.stderr);
  assert.ok(pub.stdout.includes("skill/local-notes@0.1.0"), pub.stdout);
  const again = await cli(["agent", "publish", "skill/local-notes", "--name", "laptop"]);
  assert.equal(again.code, 2, again.stdout + again.stderr);
  const after = await cli(["agent", "status", "--name", "laptop", "--json"]);
  assert.equal(JSON.parse(after.stdout).items.find((i) => i.key === "skill/local-notes").status, "in_sync");
  const missingItem = await cli(["agent", "publish", "skill/nope", "--name", "laptop"]);
  assert.equal(missingItem.code, 6, missingItem.stdout + missingItem.stderr);

  const rm = await cli(["agent", "rm", "--name", "laptop"]);
  assert.equal(rm.code, 0, rm.stderr);
  const gone = await cli(["agent", "status", "--name", "laptop"]);
  assert.equal(gone.code, 6, gone.stdout + gone.stderr);
  const unauth = await cli(["agent", "list"], { env: { SKILLFORGE_URL: base, SKILLFORGE_TOKEN: "sf_00000000_00000000000000000000000000000000" } });
  assert.equal(unauth.code, 4, unauth.stdout + unauth.stderr);
});
