// fix-readable-codes: a publish conflict is one readable message in stderr with the next step, not a bare code twice.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, toB64, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
let srv;
let work;
let env;

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-cli-messages-" });
  assert.ok(srv.up, srv.stderr);
  const admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  const token = (await api(srv.base, "POST", "/api/v1/me/tokens", { name: "cli" }, { cookie: admin.cookie })).data.token;
  work = mkdtempSync(join(tmpdir(), "skillforge-cli-messages-"));
  env = { ...process.env, SKILLFORGE_URL: srv.base, SKILLFORGE_TOKEN: token, SKILLFORGE_CONFIG: join(work, "cli.json"), NO_COLOR: "1" };
  await seedPacks();
});
after(async () => {
  await srv?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("publishing the same version again: exit 2, version_exists once, in stderr, with the next step", () => {
  const dir = join(work, "twice");
  mkdirSync(dir);
  writeFileSync(join(dir, "SKILL.md"), "---\nname: twice\ndescription: A skill published twice. Use when testing conflicts.\n---\n\nBody.\n");
  const run = (body) => {
    writeFileSync(join(dir, "SKILL.md"), `---\nname: twice\ndescription: A skill published twice. Use when testing conflicts.\n---\n\n${body}\n`);
    return spawnSync(process.execPath, [CLI, "publish", dir, "--type", "skill", "--version", "1.0.0"], { env, encoding: "utf8", timeout: 30_000 });
  };
  assert.equal(run("First.").status, 0);
  const r = run("Second.");
  assert.equal(r.status, 2, r.stdout + r.stderr);
  const all = r.stdout + r.stderr;
  assert.equal(all.split("version_exists").length - 1, 1, `printed more than once:\n${all}`);
  assert.doesNotMatch(r.stdout, /version_exists/);
  assert.match(r.stderr, /already exists/i);
  assert.match(r.stderr, /--version/);
});

// fix-cli-server-message (#210): the server's own text reaches the person; "run skillforge login" only when signing in helps.
const tokens = {};
async function tokenFor(username, { mcp = false, role = "contributor" } = {}) {
  const pw = username === "admin" ? ADMIN_PASSWORD : `${username}-pw-123456`;
  if (username !== "admin" && !tokens[`user:${username}`]) {
    const admin = await login(srv.base, "admin", ADMIN_PASSWORD);
    await createUser(srv.base, admin.cookie, { username, password: pw, role });
    tokens[`user:${username}`] = true;
  }
  const who = await login(srv.base, username, pw);
  const r = await api(srv.base, "POST", "/api/v1/me/tokens", { name: mcp ? "agent" : "cli", ...(mcp ? { mcp: true } : {}) }, { cookie: who.cookie });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.token;
}
function cliAs(token, args) {
  const e = { ...env };
  if (token) e.SKILLFORGE_TOKEN = token;
  else delete e.SKILLFORGE_TOKEN;
  return spawnSync(process.execPath, [CLI, ...args], { env: e, cwd: work, encoding: "utf8", timeout: 30_000 });
}
function packFile(version) {
  const p = join(work, `pack-${version}.json`);
  const roles = [{ name: "developer", description: "Builds", items: [{ type: "skill", name: "probe-it", version: "0.1.0" }] }];
  writeFileSync(p, JSON.stringify({ name: "team-method", version, title: "Team method", description: "How we work.", roles }));
  return p;
}

/** Root-level before hooks of node:test do not wait for each other, so the first hook calls this. */
async function seedPacks() {
  const admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  const md = "---\nname: probe-it\ndescription: Pack probe. Use when testing CLI messages.\n---\n\nBody.\n";
  const pub = await api(srv.base, "POST", "/api/v1/artifacts", { type: "skill", version: "0.1.0", files: toB64([{ path: "probe-it/SKILL.md", content: md }]) }, { cookie: admin.cookie });
  assert.equal(pub.status, 201, JSON.stringify(pub.data));
  const act = await api(srv.base, "POST", "/api/v1/artifacts/skill/probe-it/transitions", { to: "active", reason: "cli messages" }, { cookie: admin.cookie });
  assert.equal(act.status, 200, JSON.stringify(act.data));
  tokens.admin = await tokenFor("admin");
  tokens.lena = await tokenFor("lena");
  tokens.vera = await tokenFor("vera", { role: "viewer" });
  tokens.mcp = await tokenFor("admin", { mcp: true });
  const first = cliAs(tokens.admin, ["pack", "publish", packFile("1.0.0")]);
  assert.equal(first.status, 0, first.stdout + first.stderr);
}

test("a refusal with the server's text: version_not_newer prints the code and the text; exit code unchanged", () => {
  const r = cliAs(tokens.admin, ["pack", "publish", packFile("0.9.0")]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /version_not_newer: version must be greater than 1\.0\.0/);
});

test("a role that does not allow the command: exit 4, the role is named, no advice to sign in", () => {
  const r = cliAs(tokens.vera, ["pack", "publish", packFile("1.1.0"), "--dry-run"]);
  assert.equal(r.status, 4, r.stdout + r.stderr);
  assert.match(r.stderr, /your role does not allow this/);
  assert.doesNotMatch(r.stderr, /run skillforge login/);
});

test("a pack of another owner: not_owner names the pack and its owner, not the artifact", () => {
  const r = cliAs(tokens.lena, ["pack", "publish", packFile("2.0.0")]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /not_owner: pack team-method belongs to admin/);
  assert.doesNotMatch(r.stderr, /the artifact is owned/);
});

test("an MCP token for a regular command: mcp_token_forbidden says a regular token is needed; exit 4", () => {
  const r = cliAs(tokens.mcp, ["list"]);
  assert.equal(r.status, 4, r.stdout + r.stderr);
  assert.match(r.stderr, /mcp_token_forbidden/);
  assert.match(r.stderr, /regular token/);
  assert.doesNotMatch(r.stderr, /run skillforge login/);
});

test("negative case: without a token (HTTP 401, pack list needs a user) the advice to sign in stays; exit 4", () => {
  const r = cliAs(undefined, ["pack", "list"]);
  assert.equal(r.status, 4, r.stdout + r.stderr);
  assert.match(r.stderr, /run skillforge login/);
  assert.doesNotMatch(r.stderr, /your role does not allow this/);
});
