// Acceptance tests: a path inside a clone or package is checked by its real location (realpath), not only lexically. A symlink
// directory (a junction on Windows) pointing outside does not allow reading files outside the root.
// Requires `npm run build`.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startServer, api, login, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const work = mkdtempSync(join(tmpdir(), "skillforge-symlinks-"));
const servers = [];
after(async () => {
  for (const s of servers) await s.stop?.().catch(() => {});
  rmSync(work, { recursive: true, force: true });
});

const skill = (name) => `---\nname: ${name}\ndescription: Symlink escape probe\n---\n\n# ${name}\n`;

// A directory "outside" with a skill that must not end up in the import.
const outside = join(work, "outside");
mkdirSync(join(outside, "leaked-skill"), { recursive: true });
writeFileSync(join(outside, "leaked-skill", "SKILL.md"), skill("leaked-skill"));

test("resolveUnderRoot: a directory link pointing outside is rejected, ordinary paths inside the root are not", async () => {
  const { resolveUnderRoot } = await import(pathToFileURL(join(ROOT, "packages", "server", "dist", "imports", "sources.js")).href);
  const root = join(work, "root");
  mkdirSync(join(root, "real", "inner"), { recursive: true });
  // "junction" on Windows requires no privileges; on POSIX the type is ignored and an ordinary symlink is created.
  symlinkSync(outside, join(root, "skills"), "junction");

  assert.equal(resolveUnderRoot(root, "real").ok, true, "ordinary subdirectory");
  assert.equal(resolveUnderRoot(root, "real/inner").ok, true, "nested subdirectory");
  assert.equal(resolveUnderRoot(root, "missing/dir").ok, true, "a nonexistent path inside the root is allowed (existence is checked later)");
  assert.equal(resolveUnderRoot(root, "skills").ok, false, "directory link pointing outside");
  assert.equal(resolveUnderRoot(root, "skills/leaked-skill").ok, false, "path through a directory link pointing outside");
  assert.equal(resolveUnderRoot(root, "../outside").ok, false, "lexical escape (the previous behavior)");
});

/** Whether git on this machine can create a symlink when cloning (on Windows without the privilege — no). */
function gitCanCheckoutSymlinks() {
  const probe = join(work, "probe");
  try {
    mkdirSync(probe, { recursive: true });
    symlinkSync(join(probe, "t"), join(probe, "l"), "file");
    return true;
  } catch {
    return false;
  }
}

function makeRepoWithDirSymlink() {
  const repo = join(work, "repo");
  mkdirSync(join(repo, "ok-skill"), { recursive: true });
  writeFileSync(join(repo, "ok-skill", "SKILL.md"), skill("ok-skill"));
  const git = (...args) => execFileSync("git", ["-c", "core.symlinks=true", ...args], { cwd: repo, stdio: "pipe" }).toString().trim();
  git("init", "-q");
  git("add", "ok-skill/SKILL.md");
  // The symlink directory `skills` → an absolute path outside, recorded in the index as a git object (mode 120000).
  const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: repo, input: outside }).toString().trim();
  git("update-index", "--add", "--cacheinfo", `120000,${blob},skills`);
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "symlink");
  return repo;
}

test("git import: a path through a symlink directory pointing outside is rejected, outside files are not read", async (t) => {
  if (!gitCanCheckoutSymlinks()) {
    t.skip("cannot create a symlink on this machine (Windows without the privilege): git will not create it when cloning; covered by the unit test above and on Linux/CI");
    return;
  }
  const repo = makeRepoWithDirSymlink();
  const srv = await startServer({ SKILLFORGE_IMPORT_ALLOW_FILE_URLS: "true" }, { prefix: "skillforge-symlinks-srv-" });
  assert.ok(srv.up, srv.stderr);
  servers.push(srv);
  const admin = await login(srv.base, "admin", ADMIN_PASSWORD);

  const viaPath = await api(srv.base, "POST", "/api/v1/imports/preview", { source: { kind: "git", url: repo, path: "skills" } }, admin);
  assert.equal(viaPath.status, 400, `a path through a symlink pointing outside must be rejected: ${viaPath.status} ${JSON.stringify(viaPath.data)}`);
  assert.ok(!JSON.stringify(viaPath.data).includes("leaked-skill"));

  const whole = await api(srv.base, "POST", "/api/v1/imports/preview", { source: { kind: "git", url: repo } }, admin);
  assert.equal(whole.status, 200, JSON.stringify(whole.data));
  const ids = whole.data.candidates.map((c) => c.id);
  assert.ok(ids.includes("skill/ok-skill"), `an ordinary skill from the repository must be imported: ${ids}`);
  assert.ok(!ids.includes("skill/leaked-skill"), "a skill from outside got into the import through a symlink");
});
