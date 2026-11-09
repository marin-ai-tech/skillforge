// Acceptance tests for the `settings` artifact type (approved Claude Code settings profiles), checks and risks,
// exclusion from the marketplace, and the CLI `skillforge settings apply` with a merge that does not replace arrays,
// a backup and --dry-run.
// Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, loadDir, toB64, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const FIX = join(ROOT, "tests", "fixtures", "settings");
const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const files = (name, mutate = (f) => f) => toB64(mutate(loadDir(join(FIX, name))).map((f) => ({ path: `${name}/${f.path}`, content: f.content })));
const replace = (path, text) => (fs) => fs.map((f) => (f.path === path ? { path, content: Buffer.from(text) } : f));

let srv;
let base;
let admin;
let work;

function runCli(args, { home, cwd } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: cwd ?? work,
      env: {
        ...process.env,
        SKILLFORGE_CONFIG: join(work, "config.json"),
        SKILLFORGE_URL: base,
        SKILLFORGE_TOKEN: undefined,
        NO_COLOR: "1",
        HOME: home ?? join(work, "home"),
        USERPROFILE: home ?? join(work, "home"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill(), 30000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-settings-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  work = mkdtempSync(join(tmpdir(), "skillforge-settings-work-"));
  mkdirSync(join(work, "home"), { recursive: true });
});

after(async () => {
  if (srv?.up) await srv.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("the settings type is in the type table", async () => {
  const r = await api(base, "GET", "/api/v1/artifact-types");
  const t = r.data.items.find((x) => x.id === "settings");
  assert.ok(t, JSON.stringify(r.data.items.map((x) => x.id)));
  assert.equal(t.label, "Settings profile");
  // settings is no longer last in the table; it comes right after plugin.
  assert.equal(r.data.items[r.data.items.findIndex((x) => x.id === "plugin") + 1].id, "settings");
});

test("profile check: type detection, settings file and secret errors, risks in the quality report", async () => {
  const ok = await api(base, "POST", "/api/v1/artifacts/validate", { files: files("team-baseline") }, { cookie: admin.cookie });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.detected_type, "settings");
  assert.deepEqual(ok.data.errors, [], JSON.stringify(ok.data.errors));
  assert.equal(ok.data.artifact.name, "team-baseline");
  assert.ok(!ok.data.quality.checks.some((c) => c.code.startsWith("Q_SETTINGS_")), JSON.stringify(ok.data.quality.checks));

  const risky = await api(base, "POST", "/api/v1/artifacts/validate", { files: files("risky-profile") }, { cookie: admin.cookie });
  assert.deepEqual(risky.data.errors, []);
  const codes = risky.data.quality.checks.map((c) => c.code).filter((c) => c.startsWith("Q_SETTINGS_")).sort();
  assert.deepEqual(codes, ["Q_SETTINGS_API_KEY_HELPER", "Q_SETTINGS_BROAD_ALLOW", "Q_SETTINGS_BYPASS", "Q_SETTINGS_HOOKS"]);

  const check = async (mutate, code) => {
    const r = await api(base, "POST", "/api/v1/artifacts/validate", { type: "settings", files: files("team-baseline", mutate) }, { cookie: admin.cookie });
    assert.ok(r.data.errors.some((e) => e.code === code), `${code}: ${JSON.stringify(r.data.errors)}`);
    return r;
  };
  await check((fs) => fs.filter((f) => f.path !== "settings.json"), "E_SETTINGS_JSON_MISSING");
  await check(replace("settings.json", "[1, 2]"), "E_SETTINGS_JSON_INVALID");
  await check(replace("settings.json", "{ not json"), "E_SETTINGS_JSON_INVALID");
  const secret = await check(replace("settings.json", '{ "env": { "GITHUB_TOKEN": "ghp_0123456789abcdef0123456789abcdef0123" } }'), "E_SETTINGS_SECRET");
  assert.ok(secret.data.errors.some((e) => e.code === "E_SETTINGS_SECRET" && String(e.path).includes("settings.json")));
  const ref = await api(base, "POST", "/api/v1/artifacts/validate", { type: "settings", files: files("team-baseline", replace("settings.json", '{ "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" } }')) }, { cookie: admin.cookie });
  assert.deepEqual(ref.data.errors, [], "a reference to an environment variable is not a secret");
  await check(replace("SETTINGS.md", "---\nname: team-baseline\ndescription: Baseline profile for a runtime that is not supported yet. Use when testing.\nruntime: vim\nscope: project\n---\n\n# X\n"), "E_SETTINGS_RUNTIME");
});

test("the profile is published but does not reach the plugin marketplace", async () => {
  const pub = await api(base, "POST", "/api/v1/artifacts", { files: files("team-baseline") }, { cookie: admin.cookie });
  assert.equal(pub.status, 201, JSON.stringify(pub.data));
  const t = await api(base, "POST", "/api/v1/artifacts/settings/team-baseline/transitions", { to: "active", reason: "settings test" }, { cookie: admin.cookie });
  assert.equal(t.status, 200);
  const mp = await api(base, "GET", "/marketplace.json");
  assert.ok(!mp.data.plugins.some((p) => p.name.startsWith("team-baseline")), "a settings profile is not a Claude Code plugin");
  const tgz = await fetch(`${base}/api/v1/plugins/settings/team-baseline/latest.tar.gz`);
  assert.equal(tgz.status, 404);
  const card = await api(base, "GET", "/api/v1/artifacts/settings/team-baseline");
  assert.match(card.data.install.cli ?? "", /skillforge settings apply settings\/team-baseline --scope project/);
});

test("apply to a project: merge without replacing arrays, the profile wins for scalars, a backup, a restart reminder", async () => {
  const proj = join(work, "proj");
  mkdirSync(join(proj, ".claude"), { recursive: true });
  const existing = { permissions: { allow: ["Read", "WebFetch"], deny: ["Bash(rm:*)"] }, model: "sonnet", env: { A: "1" }, statusLine: { type: "command", command: "echo hi" } };
  writeFileSync(join(proj, ".claude", "settings.json"), JSON.stringify(existing, null, 2));
  const r = await runCli(["settings", "apply", "settings/team-baseline", "--scope", "project"], { cwd: proj });
  assert.equal(r.code, 0, `${r.out}\n${r.err}`);
  const merged = JSON.parse(readFileSync(join(proj, ".claude", "settings.json"), "utf8"));
  assert.deepEqual(merged.permissions.allow, ["Read", "WebFetch", "Grep", "Glob"], "arrays are merged, order: existing items first");
  assert.deepEqual(merged.permissions.deny, ["Bash(rm:*)", "Bash(git push --force:*)", "Bash(rm -rf:*)"]);
  assert.equal(merged.model, "opus");
  assert.deepEqual(merged.env, { A: "1", DISABLE_TELEMETRY: "1" });
  assert.deepEqual(merged.statusLine, existing.statusLine, "keys absent from the profile are left alone");
  assert.equal(merged.includeCoAuthoredBy, true);
  const backups = readdirSync(join(proj, ".claude")).filter((n) => n.startsWith("settings.json.bak-"));
  assert.equal(backups.length, 1, "a backup was made before writing");
  assert.deepEqual(JSON.parse(readFileSync(join(proj, ".claude", backups[0]), "utf8")), existing);
  assert.match(r.out, /model: sonnet → opus/);
  assert.match(r.out, /[Rr]estart/);
});

test("--dry-run writes nothing; scope local and user; a broken existing file and a non-profile give exit code 1", async () => {
  const proj = join(work, "proj2");
  mkdirSync(join(proj, ".claude"), { recursive: true });
  writeFileSync(join(proj, ".claude", "settings.local.json"), '{ "model": "haiku" }');
  const dry = await runCli(["settings", "apply", "settings/team-baseline", "--scope", "local", "--dry-run"], { cwd: proj });
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /model: haiku → opus/);
  assert.equal(readFileSync(join(proj, ".claude", "settings.local.json"), "utf8"), '{ "model": "haiku" }', "dry-run writes nothing");
  assert.equal(readdirSync(join(proj, ".claude")).filter((n) => n.includes(".bak-")).length, 0);

  const local = await runCli(["settings", "apply", "settings/team-baseline", "--scope", "local"], { cwd: proj });
  assert.equal(local.code, 0, local.err);
  assert.equal(JSON.parse(readFileSync(join(proj, ".claude", "settings.local.json"), "utf8")).model, "opus");

  const home = join(work, "home-user");
  mkdirSync(home, { recursive: true });
  const user = await runCli(["settings", "apply", "settings/team-baseline", "--scope", "user"], { cwd: proj, home });
  assert.equal(user.code, 0, user.err);
  const userFile = join(home, ".claude", "settings.json");
  assert.ok(existsSync(userFile), "the user file was created");
  assert.deepEqual(JSON.parse(readFileSync(userFile, "utf8")).permissions.allow, ["Read", "Grep", "Glob"]);

  writeFileSync(join(proj, ".claude", "settings.json"), "{ broken");
  const broken = await runCli(["settings", "apply", "settings/team-baseline", "--scope", "project"], { cwd: proj });
  assert.equal(broken.code, 1, broken.out);
  assert.equal(readFileSync(join(proj, ".claude", "settings.json"), "utf8"), "{ broken", "a broken file is not overwritten");

  const pubSkill = await api(base, "POST", "/api/v1/artifacts", { type: "skill", files: [{ path: "SKILL.md", content_base64: Buffer.from("---\nname: plain-skill\ndescription: Plain skill for the settings CLI check. Use when testing.\n---\n\nBody.\n").toString("base64") }] }, { cookie: admin.cookie });
  assert.equal(pubSkill.status, 201);
  const wrong = await runCli(["settings", "apply", "skill/plain-skill", "--scope", "project"], { cwd: proj });
  assert.equal(wrong.code, 1);
  assert.match(wrong.err, /settings/i);
});
