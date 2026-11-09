// Installing skill artifacts into the Reckon runtime: the canonical directory form `.reckon/skills/<name>/SKILL.md` (a flat <name>.md is
// the format of Reckon's "learned" skills; the registry neither writes nor touches it), project scope only,
// other types are rejected with an explicit reason.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, loadDir, toB64, FIXTURES, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
let srv;
let base;
let admin;
let work;

function cli(args, { cwd, home } = {}) {
  return new Promise((resolve) => {
    const h = home ?? join(work, "home");
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: cwd ?? work,
      env: { ...process.env, SKILLFORGE_CONFIG: join(work, "config.json"), SKILLFORGE_URL: base, SKILLFORGE_TOKEN: undefined, NO_COLOR: "1", HOME: h, USERPROFILE: h },
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

async function publishActive(body, type, name) {
  const p = await api(base, "POST", "/api/v1/artifacts", body, { cookie: admin.cookie });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  const t = await api(base, "POST", `/api/v1/artifacts/${type}/${name}/transitions`, { to: "active", reason: "reckon test" }, { cookie: admin.cookie });
  assert.equal(t.status, 200);
}

const newProject = (name) => {
  const d = join(work, name);
  mkdirSync(d, { recursive: true });
  return d;
};

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-reckon-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  work = mkdtempSync(join(tmpdir(), "skillforge-reckon-work-"));
  mkdirSync(join(work, "home"), { recursive: true });
  await publishActive({ type: "skill", files: toB64(loadDir(join(FIXTURES, "skill-standard"))) }, "skill", "pdf-tools");
  await publishActive(
    { type: "command", files: [{ path: "summarize.md", content_base64: Buffer.from("---\ndescription: d\n---\n\nBody.\n").toString("base64") }] },
    "command",
    "summarize",
  );
});

after(async () => {
  if (srv?.up) await srv.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("install --runtime reckon: .reckon/skills/<name>/SKILL.md unchanged, aux installed, lock with runtime", async () => {
  const original = readFileSync(join(FIXTURES, "skill-standard", "pdf-tools", "SKILL.md"), "utf8");
  const proj = newProject("reckon-skill");
  const r = await cli(["install", "skill/pdf-tools", "--runtime", "reckon"], { cwd: proj });
  assert.equal(r.code, 0, `${r.out}\n${r.err}`);
  const skillMd = join(proj, ".reckon", "skills", "pdf-tools", "SKILL.md");
  assert.ok(existsSync(skillMd), "no .reckon/skills/pdf-tools/SKILL.md");
  assert.equal(readFileSync(skillMd, "utf8"), original, "SKILL.md content was changed");
  assert.ok(
    existsSync(join(proj, ".reckon", "skills", "pdf-tools", "references", "REFERENCE.md")),
    "bundle aux files were not installed",
  );
  assert.ok(!existsSync(join(proj, ".reckon", "skills", "pdf-tools.md")), "a flat <name>.md is the format of learned skills, the registry does not write it");
  const lock = JSON.parse(readFileSync(join(proj, ".reckon", ".skillforge-lock.json"), "utf8"));
  assert.equal(lock.artifacts["skill/pdf-tools"].runtime, "reckon", "runtime in lock");
});

test("install --runtime reckon: unsupported types are rejected with a reason", async () => {
  const proj = newProject("reckon-cmd");
  const r = await cli(["install", "command/summarize", "--runtime", "reckon"], { cwd: proj });
  assert.equal(r.code, 1, `refusal expected: ${r.out}`);
  assert.match(r.err, /command\/summarize/i);
  assert.match(r.err, /not supported by reckon|publish.*skill/i, `no reason: ${r.err}`);
  assert.ok(!existsSync(join(proj, ".reckon")), "files must not be created");
});

test("install --runtime reckon --scope user rejected: Reckon has no user directory", async () => {
  const proj = newProject("reckon-user");
  const r = await cli(["install", "skill/pdf-tools", "--runtime", "reckon", "--scope", "user"], { cwd: proj });
  assert.equal(r.code, 1, `refusal expected: ${r.out}`);
  assert.match(r.err, /user|reckon/i, `no reason: ${r.err}`);
});

test("sync --runtime reckon: installs skills, command goes to skipped, learned <name>.md files are untouched", async () => {
  const proj = newProject("reckon-sync");
  const learned = join(proj, ".reckon", "skills", "my-learned.md");
  mkdirSync(join(proj, ".reckon", "skills"), { recursive: true });
  writeFileSync(learned, "---\nstatus: learned\nuse_count: 3\n---\n\nLearned body.\n");
  const before_ = readFileSync(learned, "utf8");
  const r = await cli(["sync", "--runtime", "reckon"], { cwd: proj });
  assert.equal(r.code, 0, `${r.out}\n${r.err}`);
  assert.ok(existsSync(join(proj, ".reckon", "skills", "pdf-tools", "SKILL.md")), "sync did not install the skill");
  assert.match(r.out + r.err, /skipped.*command\/summarize|command\/summarize.*skipped/is, "command is not in skipped");
  assert.equal(readFileSync(learned, "utf8"), before_, "the learned skill was changed by sync");
});

test("install --runtime reckon: local edits -> exit 5 without --force", async () => {
  const proj = newProject("reckon-dirty");
  const r1 = await cli(["install", "skill/pdf-tools", "--runtime", "reckon"], { cwd: proj });
  assert.equal(r1.code, 0, `${r1.out}\n${r1.err}`);
  const skillMd = join(proj, ".reckon", "skills", "pdf-tools", "SKILL.md");
  writeFileSync(skillMd, readFileSync(skillMd, "utf8") + "\nlocal edit\n");
  const r2 = await cli(["install", "skill/pdf-tools", "--runtime", "reckon"], { cwd: proj });
  assert.equal(r2.code, 5, `expected code 5: ${r2.out}\n${r2.err}`);
  assert.match(r2.err, /local changes/i);
});
