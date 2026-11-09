// Acceptance tests for the CLI sync commands. Requires `npm run build`.
// Runs the built CLI (packages/cli/dist/index.js) against the built server.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, loadDir, toB64, FIXTURES, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

let srv;
let base;
let admin;
let aliceToken;
let work;
let configPath;

function cli(args, { env = {}, stdin } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: work,
      env: { ...process.env, SKILLFORGE_CONFIG: configPath, NO_COLOR: "1", SKILLFORGE_URL: undefined, SKILLFORGE_TOKEN: undefined, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    if (stdin !== undefined) child.stdin.end(stdin);
    else child.stdin.end();
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

before(async () => {
  assert.ok(existsSync(CLI), `built CLI not found: ${CLI} — run npm run build`);
  srv = await startServer({}, { prefix: "skillforge-cli-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  await createUser(base, admin.cookie, { username: "alice", password: "alice-pw-1", role: "contributor" });
  await createUser(base, admin.cookie, { username: "rita", password: "rita-pw-123", role: "reviewer" });
  const alice = await login(base, "alice", "alice-pw-1");
  const tok = await api(base, "POST", "/api/v1/me/tokens", { name: "test" }, { cookie: alice.cookie });
  aliceToken = tok.data.token;
  work = mkdtempSync(join(tmpdir(), "skillforge-cli-work-"));
  configPath = join(work, "config.json");
});

after(async () => {
  if (srv?.up) await srv.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("no registry → exit code 3 with a hint; --version still works", async () => {
  const r = await cli(["list"]);
  assert.equal(r.code, 3, r.stderr);
  assert.ok(r.stderr.includes("SKILLFORGE_URL"), r.stderr);
  const v = await cli(["--version"]);
  assert.equal(v.code, 0);
  assert.match(v.stdout.trim(), /^\d+\.\d+\.\d+/);
  const help = await cli(["--help"]);
  for (const cmd of ["login", "publish", "install", "sync", "validate", "info"]) assert.ok(help.stdout.includes(cmd), `no command ${cmd} in --help`);
});

test("env registry: whoami; wrong token → exit code 4", async () => {
  const r = await cli(["whoami"], { env: { SKILLFORGE_URL: base, SKILLFORGE_TOKEN: aliceToken } });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.stdout.includes("alice"), r.stdout);
  const j = await cli(["whoami", "--json"], { env: { SKILLFORGE_URL: base, SKILLFORGE_TOKEN: aliceToken } });
  assert.equal(JSON.parse(j.stdout).user.username, "alice");
  const bad = await cli(["whoami"], { env: { SKILLFORGE_URL: base, SKILLFORGE_TOKEN: "sf_00000000_00000000000000000000000000000000" } });
  assert.equal(bad.code, 4, bad.stderr);
  assert.ok(/login/i.test(bad.stderr));
});

test("login by token and by password from stdin; config without a password; logout revokes the token", async () => {
  const byToken = await cli(["login", "--url", base, "--token", aliceToken]);
  assert.equal(byToken.code, 0, byToken.stderr);
  assert.ok(byToken.stdout.includes("alice"), `login must print the username: ${byToken.stdout}`);
  const cfg = JSON.parse(readFileSync(configPath, "utf8"));
  assert.ok(cfg.default, "no default in the config");
  assert.equal(cfg.registries[cfg.default].url, base);
  assert.equal(cfg.registries[cfg.default].token, aliceToken);
  const who = await cli(["whoami"]);
  assert.equal(who.code, 0, who.stderr);
  assert.ok(who.stdout.includes("alice"));

  const byPassword = await cli(["login", "--url", base, "--username", "rita", "--password-stdin"], { stdin: "rita-pw-123\n" });
  assert.equal(byPassword.code, 0, byPassword.stderr);
  const cfg2 = readFileSync(configPath, "utf8");
  assert.ok(!cfg2.includes("rita-pw-123"), "the password was saved to the config");
  assert.match(cfg2, /sf_[A-Za-z0-9]{8}_[A-Za-z0-9]{32}/);
  const rita = await login(base, "rita", "rita-pw-123");
  const tokens = await api(base, "GET", "/api/v1/me/tokens", undefined, { cookie: rita.cookie });
  assert.ok(tokens.data.items.some((t) => t.name.startsWith("cli ")), JSON.stringify(tokens.data));
  const who2 = await cli(["whoami"]);
  assert.ok(who2.stdout.includes("rita"), who2.stdout);

  const out = await cli(["logout"]);
  assert.equal(out.code, 0, out.stderr);
  const tokensAfter = await api(base, "GET", "/api/v1/me/tokens", undefined, { cookie: rita.cookie });
  assert.ok(!tokensAfter.data.items.some((t) => t.name.startsWith("cli ")), "the CLI token was not revoked");
  const none = await cli(["whoami"]);
  assert.notEqual(none.code, 0);
  await cli(["login", "--url", base, "--token", aliceToken]);
});

test("validate and publish: exit codes 0/1/2, type/name@version output, --json", async () => {
  const bad = mkdtempSync(join(tmpdir(), "skillforge-cli-bad-"));
  writeFileSync(join(bad, "SKILL.md"), "---\nname: Bad Name\ndescription: Broken.\n---\n\nBody.\n");
  const v = await cli(["validate", bad, "--type", "skill"]);
  assert.equal(v.code, 1, v.stdout + v.stderr);
  assert.ok(v.stdout.includes("E_NAME_INVALID"), v.stdout);
  rmSync(bad, { recursive: true, force: true });

  const dir = join(FIXTURES, "skill-standard", "pdf-tools");
  const ok = await cli(["validate", dir, "--type", "skill"]);
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  const pub = await cli(["publish", dir, "--type", "skill"]);
  assert.equal(pub.code, 0, pub.stdout + pub.stderr);
  assert.ok(pub.stdout.includes("skill/pdf-tools@0.1.0"), pub.stdout);
  assert.ok(pub.stdout.includes("/artifacts/skill/pdf-tools"), pub.stdout);
  const again = await cli(["publish", dir, "--type", "skill"]);
  assert.equal(again.code, 2, again.stdout + again.stderr);
  assert.ok((again.stdout + again.stderr).includes("digest_exists"));
  const v2 = await cli(["publish", join(FIXTURES, "skill-e2e", "pdf-tools-e2e"), "--type", "skill", "--version", "1.0.0", "--changelog", "First", "--provenance", "reckon:run-7", "--json"]);
  assert.equal(v2.code, 0, v2.stdout + v2.stderr);
  const parsed = JSON.parse(v2.stdout);
  assert.equal(parsed.version.version, "1.0.0");
  assert.deepEqual(parsed.version.provenance, { source: "reckon", ref: "run-7" });
  const cmd = await cli(["publish", join(FIXTURES, "command-propose", "propose.md"), "--type", "command"]);
  assert.equal(cmd.code, 0, cmd.stdout + cmd.stderr);
  const viewerless = await cli(["publish", dir, "--type", "skill"], { env: { SKILLFORGE_TOKEN: "sf_00000000_00000000000000000000000000000000" } });
  assert.equal(viewerless.code, 4);
});

test("list / search / info; not found → 6", async () => {
  const rita = await login(base, "rita", "rita-pw-123");
  await api(base, "POST", "/api/v1/artifacts/skill/pdf-tools-e2e/transitions", { to: "active" }, { cookie: rita.cookie });
  const list = await cli(["list", "--status", "active", "--json"]);
  assert.equal(list.code, 0, list.stderr);
  const items = JSON.parse(list.stdout).items;
  assert.ok(items.length >= 1 && items.every((a) => a.status === "active"));
  const table = await cli(["list"]);
  assert.ok(table.stdout.includes("pdf-tools") && table.stdout.includes("propose"), table.stdout);
  const search = await cli(["search", "pdf"]);
  assert.ok(search.stdout.includes("pdf-tools"), search.stdout);
  const info = await cli(["info", "skill/pdf-tools-e2e"]);
  assert.equal(info.code, 0, info.stderr);
  assert.ok(info.stdout.includes("1.0.0") && info.stdout.includes("active") && info.stdout.includes("reckon"), info.stdout);
  assert.ok(info.stdout.includes("/plugin install pdf-tools-e2e@skillforge"), info.stdout);
  const missing = await cli(["info", "skill/nope"]);
  assert.equal(missing.code, 6, missing.stderr);
  assert.ok(/not found/i.test(missing.stderr));
});

test("install: files and lock; repeat → up to date; local edit → 5, --force overwrites; uninstall", async () => {
  const into = join(work, "proj", ".claude");
  const r = await cli(["install", "skill/pdf-tools", "--into", into]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const skill = join(into, "skills", "pdf-tools", "SKILL.md");
  assert.ok(existsSync(skill));
  assert.ok(existsSync(join(into, "skills", "pdf-tools", "references", "REFERENCE.md")));
  const lock = JSON.parse(readFileSync(join(into, ".skillforge-lock.json"), "utf8"));
  assert.equal(lock.registry, base);
  const entry = lock.artifacts["skill/pdf-tools"];
  assert.equal(entry.version, "0.1.0");
  assert.match(entry.digest, /^[0-9a-f]{64}$/);
  assert.equal(entry.files["skills/pdf-tools/SKILL.md"], sha256(readFileSync(skill)));
  assert.ok(entry.installed_at);
  const again = await cli(["install", "skill/pdf-tools", "--into", into]);
  assert.equal(again.code, 0, again.stderr);
  assert.ok(/up to date/i.test(again.stdout), again.stdout);

  const v2 = loadDir(join(FIXTURES, "skill-standard")).map((f) => (f.path.endsWith("SKILL.md") ? { path: f.path, content: Buffer.from(f.content.toString("utf8") + "\nv2\n") } : f));
  const pub = await api(base, "POST", "/api/v1/artifacts", { type: "skill", version: "0.2.0", files: toB64(v2) }, { token: aliceToken });
  assert.equal(pub.status, 201);
  writeFileSync(skill, readFileSync(skill, "utf8") + "\nlocal edit\n");
  const blocked = await cli(["install", "skill/pdf-tools@0.2.0", "--into", into]);
  assert.equal(blocked.code, 5, blocked.stdout + blocked.stderr);
  assert.ok(/local/i.test(blocked.stderr));
  const forced = await cli(["install", "skill/pdf-tools@0.2.0", "--into", into, "--force"]);
  assert.equal(forced.code, 0, forced.stderr);
  assert.ok(readFileSync(skill, "utf8").includes("v2"));
  assert.equal(JSON.parse(readFileSync(join(into, ".skillforge-lock.json"), "utf8")).artifacts["skill/pdf-tools"].version, "0.2.0");

  const un = await cli(["uninstall", "skill/pdf-tools", "--into", into]);
  assert.equal(un.code, 0, un.stderr);
  assert.ok(!existsSync(join(into, "skills", "pdf-tools")));
  assert.ok(!("skill/pdf-tools" in JSON.parse(readFileSync(join(into, ".skillforge-lock.json"), "utf8")).artifacts));
});

test("sync --status active --prune: installs active, removes the others from the lock", async () => {
  const into = join(work, "proj2", ".claude");
  const a = await cli(["install", "command/propose", "--into", into]);
  assert.equal(a.code, 0, a.stderr);
  assert.ok(existsSync(join(into, "commands", "propose.md")));
  const s = await cli(["sync", "--into", into, "--status", "active", "--prune"]);
  assert.equal(s.code, 0, s.stdout + s.stderr);
  assert.ok(existsSync(join(into, "skills", "pdf-tools-e2e", "SKILL.md")), "the active skill was not installed");
  assert.ok(!existsSync(join(into, "commands", "propose.md")), "the non-active one was not removed with --prune");
  const lock = JSON.parse(readFileSync(join(into, ".skillforge-lock.json"), "utf8"));
  assert.deepEqual(Object.keys(lock.artifacts), ["skill/pdf-tools-e2e"]);
  const s2 = await cli(["sync", "--into", into, "--status", "active", "--json"]);
  assert.equal(s2.code, 0, s2.stderr);
  const summary = JSON.parse(s2.stdout);
  assert.ok("up_to_date" in summary || "up-to-date" in summary || "upToDate" in summary, s2.stdout);
});

test("security: the default registry token is not sent to another host", async () => {
  let seenAuth = "unset";
  const sniff = createServer((req, res) => {
    seenAuth = req.headers.authorization ?? "(none)";
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
  });
  await new Promise((r) => sniff.listen(0, "127.0.0.1", r));
  try {
    const other = `http://127.0.0.1:${sniff.address().port}`;
    const r = await cli(["whoami", "--url", other]);
    assert.equal(r.code, 4, r.stdout + r.stderr);
    assert.equal(seenAuth, "(none)", `the default registry token was sent to a foreign host: ${seenAuth}`);
    seenAuth = "unset";
    const viaEnv = await cli(["list"], { env: { SKILLFORGE_URL: other } });
    assert.equal(viaEnv.code, 4, viaEnv.stdout + viaEnv.stderr);
    assert.equal(seenAuth, "(none)", `the config token was sent to SKILLFORGE_URL of another host: ${seenAuth}`);
  } finally {
    await new Promise((r) => sniff.close(r));
  }
  const still = await cli(["whoami"]);
  assert.equal(still.code, 0, still.stderr);
  assert.ok(still.stdout.includes("alice"));
});

test("security: lock file paths are validated — uninstall / sync --prune / install do not escape --into", async () => {
  const proj = join(work, "proj3");
  const into = join(proj, ".claude");
  const victim = join(proj, "victim.txt");
  const evilLock = () => {
    mkdirSync(into, { recursive: true });
    writeFileSync(victim, "keep me\n");
    writeFileSync(
      join(into, ".skillforge-lock.json"),
      JSON.stringify({
        registry: base,
        artifacts: {
          "skill/pdf-tools": { version: "0.1.0", digest: "0".repeat(64), files: { "../victim.txt": sha256("keep me\n") }, installed_at: "2026-09-18T00:00:00.000Z" },
          "skill/evil": { version: "0.1.0", digest: "0".repeat(64), files: { "../victim.txt": sha256("keep me\n"), "skills/evil/SKILL.md": "00" }, installed_at: "2026-09-18T00:00:00.000Z" },
        },
      }),
    );
  };
  evilLock();
  const un = await cli(["uninstall", "skill/evil", "--into", into]);
  assert.equal(un.code, 1, un.stdout + un.stderr);
  assert.ok(/lock/i.test(un.stderr), un.stderr);
  assert.ok(existsSync(victim), "uninstall deleted a file outside --into");
  assert.ok(readFileSync(join(into, ".skillforge-lock.json"), "utf8").includes("skill/evil"), "the lock was changed on error");

  const sync = await cli(["sync", "--into", into, "--status", "active", "--prune"]);
  assert.equal(sync.code, 1, sync.stdout + sync.stderr);
  assert.ok(existsSync(victim), "sync --prune deleted a file outside --into");

  const inst = await cli(["install", "skill/pdf-tools@0.2.0", "--into", into]);
  assert.equal(inst.code, 1, inst.stdout + inst.stderr);
  assert.ok(existsSync(victim), "install deleted a file outside --into");
  assert.equal(readFileSync(victim, "utf8"), "keep me\n");

  for (const bad of ["C:/victim.txt", "/etc/passwd", "skills\\..\\victim.txt"]) {
    mkdirSync(into, { recursive: true });
    writeFileSync(join(into, ".skillforge-lock.json"), JSON.stringify({ registry: base, artifacts: { "skill/evil": { version: "0.1.0", digest: "0".repeat(64), files: { [bad]: "00" }, installed_at: "2026-09-18T00:00:00.000Z" } } }));
    const r = await cli(["uninstall", "skill/evil", "--into", into]);
    assert.equal(r.code, 1, `${bad}: ${r.stdout}${r.stderr}`);
  }
});

test("security: install does not overwrite existing files outside the lock without --force", async () => {
  const into = join(work, "proj4", ".claude");
  const skill = join(into, "skills", "pdf-tools", "SKILL.md");
  mkdirSync(join(into, "skills", "pdf-tools"), { recursive: true });
  writeFileSync(skill, "# hand-written\n");
  const blocked = await cli(["install", "skill/pdf-tools", "--into", into]);
  assert.equal(blocked.code, 5, blocked.stdout + blocked.stderr);
  assert.ok(blocked.stderr.includes("skills/pdf-tools/SKILL.md"), blocked.stderr);
  assert.equal(readFileSync(skill, "utf8"), "# hand-written\n");
  assert.ok(!existsSync(join(into, ".skillforge-lock.json")) || !("skill/pdf-tools" in JSON.parse(readFileSync(join(into, ".skillforge-lock.json"), "utf8")).artifacts));
  const forced = await cli(["install", "skill/pdf-tools", "--into", into, "--force"]);
  assert.equal(forced.code, 0, forced.stdout + forced.stderr);
  assert.ok(readFileSync(skill, "utf8").includes("pdf-tools"));
  const lock = JSON.parse(readFileSync(join(into, ".skillforge-lock.json"), "utf8"));
  assert.equal(lock.artifacts["skill/pdf-tools"].files["skills/pdf-tools/SKILL.md"], sha256(readFileSync(skill)));
});
