// Acceptance tests for importing sources (files, zip, git) into artifacts.
// Requires `npm run build` and an installed git.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startServer, api as rawApi, login, createUser, loadDir, toB64, ADMIN_PASSWORD } from "./lib/client.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IMPORTS = join(ROOT, "tests", "fixtures", "imports");
const SAMPLE = join(IMPORTS, "plugin-sample");
const EXPECTED_IDS = ["agent/reviewer-bot", "command/deploy", "hook/ops-plugin", "skill/csv-tools", "skill/power-grid"];

let srv;
let base;
let admin;
let alice;
let bob;
const api = (method, path, body, auth) => rawApi(base, method, path, body, auth ?? { cookie: alice.cookie });
const preview = (source, auth) => api("POST", "/api/v1/imports/preview", { source }, auth);
const run = (body, auth) => api("POST", "/api/v1/imports/run", body, auth);

/** The plugin-sample tree with a shared top-level directory plugin-sample/ (as in a zip). */
const sampleFiles = () => toB64(loadDir(SAMPLE).map((f) => ({ path: `plugin-sample/${f.path}`, content: f.content })));

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-import-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  await createUser(base, admin.cookie, { username: "alice", password: "alice-pw-1", role: "contributor" });
  await createUser(base, admin.cookie, { username: "bob", password: "bob-pw-123", role: "viewer" });
  alice = await login(base, "alice", "alice-pw-1");
  bob = await login(base, "bob", "bob-pw-123");
});

after(async () => {
  if (srv?.up) await srv.stop();
});

test("roles: anonymous 401, viewer 403", async () => {
  const anon = await preview({ kind: "files", files: sampleFiles() }, {});
  assert.equal(anon.status, 401);
  const viewer = await preview({ kind: "files", files: sampleFiles() }, { cookie: bob.cookie });
  assert.equal(viewer.status, 403);
});

let importId;

test("preview files: shared directory stripped, 5 candidates, provenance reckon, hook from plugin.json, skipped", async () => {
  const r = await preview({ kind: "files", files: sampleFiles() });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const d = r.data;
  assert.ok(typeof d.import_id === "string" && d.import_id.length >= 16);
  assert.equal(d.source.kind, "files");
  assert.deepEqual(d.candidates.map((c) => c.id).sort(), EXPECTED_IDS);
  for (const c of d.candidates) {
    assert.equal(c.dry_run.ok, true, `${c.id}: ${JSON.stringify(c.dry_run.errors)}`);
    assert.deepEqual(c.dry_run.conflicts, [], c.id);
    assert.equal(c.dry_run.next_version, "0.1.0", c.id);
    assert.equal(c.dry_run.existing, null, c.id);
    assert.ok(!c.files.some((f) => f.path.startsWith("plugin-sample/")), `${c.id}: shared directory not stripped`);
  }
  const csv = d.candidates.find((c) => c.id === "skill/csv-tools");
  assert.equal(csv.files.length, 2);
  assert.deepEqual(csv.provenance, { source: "human", ref: null });
  const grid = d.candidates.find((c) => c.id === "skill/power-grid");
  assert.deepEqual(grid.provenance, { source: "reckon", ref: ".reckon/skills/power-grid.md" });
  assert.ok(grid.dry_run.warnings.some((w) => w.code === "W_SINGLE_FILE_SKILL"));
  const hook = d.candidates.find((c) => c.id === "hook/ops-plugin");
  assert.deepEqual(hook.files.map((f) => f.path).sort(), ["hooks/hooks.json", "scripts/guard.sh"]);
  assert.ok(d.skipped.some((s) => s.path.endsWith("node_modules/junk/index.js")), JSON.stringify(d.skipped));
  assert.ok(d.skipped.some((s) => s.path.endsWith(".claude-plugin/plugin.json")));
  importId = d.import_id;
});

// fix-import-root-skill: a folder of one skill is the whole skill, not just its SKILL.md.
test("preview files: a single skill folder keeps all its files; other candidates stay separate", async () => {
  const md = (name) => `---\nname: ${name}\ndescription: Counts pages of PDF files. Use when a PDF is too long to read.\n---\n\n# ${name}\n\nRun the script.\n`;
  const one = await preview({
    kind: "files",
    files: toB64([
      { path: "pdf/SKILL.md", content: md("pdf") },
      { path: "pdf/scripts/count.py", content: "print(1)\n" },
      { path: "pdf/references/pages.md", content: "# Pages\n" },
    ]),
  });
  assert.equal(one.status, 200, JSON.stringify(one.data));
  assert.deepEqual(one.data.candidates.map((c) => c.id), ["skill/pdf"]);
  assert.deepEqual(one.data.candidates[0].files.map((f) => f.path).sort(), ["SKILL.md", "references/pages.md", "scripts/count.py"]);
  assert.deepEqual(one.data.skipped.filter((s) => s.reason === "unclaimed"), []);
  // Negative: a command beside the root skill stays a command and is not part of the skill.
  const mixed = await preview({
    kind: "files",
    files: toB64([
      { path: "SKILL.md", content: md("root-skill") },
      { path: "README.md", content: "# root\n" },
      { path: "commands/deploy.md", content: "Deploy the app.\n" },
    ]),
  });
  assert.equal(mixed.status, 200, JSON.stringify(mixed.data));
  assert.deepEqual(mixed.data.candidates.map((c) => c.id).sort(), ["command/deploy", "skill/root-skill"]);
  const skill = mixed.data.candidates.find((c) => c.id === "skill/root-skill");
  assert.deepEqual(skill.files.map((f) => f.path).sort(), ["README.md", "SKILL.md"]);
});

test("run all: 5 created 0.1.0, audit with meta.import, provenance reckon kept; a repeated run -> 410", async () => {
  const r = await run({ import_id: importId, selected: "all" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.results.map((x) => x.id).sort(), EXPECTED_IDS);
  for (const x of r.data.results) {
    assert.equal(x.status, "created", JSON.stringify(x));
    assert.equal(x.version, "0.1.0");
  }
  const h = await api("GET", "/api/v1/health");
  assert.equal(h.data.artifacts, 5);
  const audit = await api("GET", "/api/v1/artifacts/skill/csv-tools/audit");
  assert.equal(audit.data.items[0].action, "publish");
  assert.equal(audit.data.items[0].meta.import.kind, "files");
  assert.equal(audit.data.items[0].meta.import.import_id, importId);
  const grid = await api("GET", "/api/v1/artifacts/skill/power-grid/versions/latest");
  assert.deepEqual(grid.data.provenance, { source: "reckon", ref: ".reckon/skills/power-grid.md" });
  assert.equal(grid.data.published_by, "alice");
  const again = await run({ import_id: importId, selected: "all" });
  assert.equal(again.status, 410);
  assert.equal(again.data.error, "import_expired");
  const bogus = await run({ import_id: "0".repeat(32), selected: "all" });
  assert.equal(bogus.status, 410);
});

test("repeated preview -> digest_exists; skip_conflicts true -> skipped, false -> failed; partial selection", async () => {
  const p = await preview({ kind: "files", files: sampleFiles() });
  for (const c of p.data.candidates) {
    assert.ok(c.dry_run.conflicts.includes("digest_exists"), c.id);
    assert.equal(c.dry_run.existing.latest_version, "0.1.0");
  }
  const skipped = await run({ import_id: p.data.import_id, selected: "all", skip_conflicts: true });
  assert.equal(skipped.status, 200);
  for (const x of skipped.data.results) {
    assert.equal(x.status, "skipped", JSON.stringify(x));
    assert.equal(x.reason, "digest_exists");
  }
  const p2 = await preview({ kind: "files", files: sampleFiles() });
  const failed = await run({ import_id: p2.data.import_id, selected: ["command/deploy"], skip_conflicts: false });
  assert.equal(failed.data.results.length, 1);
  assert.equal(failed.data.results[0].id, "command/deploy");
  assert.equal(failed.data.results[0].status, "failed");
  assert.equal((await api("GET", "/api/v1/health")).data.artifacts, 5);
});

test("zip: the same candidates (with conflicts after import), unsafe path -> 400, zip-bomb -> import_too_large", async () => {
  const zip = readFileSync(join(IMPORTS, "plugin-sample.zip")).toString("base64");
  const r = await preview({ kind: "zip", content_base64: zip });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.candidates.map((c) => c.id).sort(), EXPECTED_IDS);
  assert.equal(r.data.source.kind, "zip");
  const unsafe = await preview({ kind: "zip", content_base64: readFileSync(join(IMPORTS, "unsafe.zip")).toString("base64") });
  assert.equal(unsafe.status, 400);
  assert.equal(unsafe.data.error, "import_unsafe_path");
  const bomb = await preview({ kind: "zip", content_base64: readFileSync(join(IMPORTS, "bomb.zip")).toString("base64") });
  assert.equal(bomb.status, 400);
  assert.equal(bomb.data.error, "import_too_large");
  const garbage = await preview({ kind: "zip", content_base64: Buffer.from("not a zip").toString("base64") });
  assert.equal(garbage.status, 400);
  assert.equal(garbage.data.error, "bad_request");
});

test("git: file:// is forbidden by default, http:// is not allowed, it is permitted by a flag and yields the same candidates; disabling by flag", async () => {
  const work = mkdtempSync(join(tmpdir(), "skillforge-gitsrc-"));
  const repo = join(work, "repo");
  cpSync(SAMPLE, repo, { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString();
  git("init", "-q", "-b", "main");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "sample");
  const url = pathToFileURL(repo).href;
  try {
    const denied = await preview({ kind: "git", url });
    assert.equal(denied.status, 400);
    assert.equal(denied.data.error, "import_url_not_allowed");
    const http = await preview({ kind: "git", url: "http://example.com/repo.git" });
    assert.equal(http.status, 400);
    assert.equal(http.data.error, "import_url_not_allowed");

    const allowed = await startServer({ SKILLFORGE_IMPORT_ALLOW_FILE_URLS: "true" }, { prefix: "skillforge-gitok-" });
    assert.ok(allowed.up, allowed.stderr);
    try {
      const a = await login(allowed.base, "admin", ADMIN_PASSWORD);
      const r = await rawApi(allowed.base, "POST", "/api/v1/imports/preview", { source: { kind: "git", url, ref: "main" } }, { cookie: a.cookie });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.deepEqual(r.data.candidates.map((c) => c.id).sort(), EXPECTED_IDS);
      assert.equal(r.data.source.kind, "git");
      assert.ok(!r.data.candidates.some((c) => c.files.some((f) => f.path.startsWith(".git/"))));
      const ran = await rawApi(allowed.base, "POST", "/api/v1/imports/run", { import_id: r.data.import_id, selected: ["skill/csv-tools"] }, { cookie: a.cookie });
      assert.equal(ran.status, 200, JSON.stringify(ran.data));
      assert.equal(ran.data.results[0].status, "created");
      const audit = await rawApi(allowed.base, "GET", "/api/v1/artifacts/skill/csv-tools/audit");
      assert.equal(audit.data.items[0].meta.import.kind, "git");
      const bad = await rawApi(allowed.base, "POST", "/api/v1/imports/preview", { source: { kind: "git", url: pathToFileURL(join(work, "missing")).href } }, { cookie: a.cookie });
      assert.equal(bad.status, 400);
      assert.equal(bad.data.error, "import_git_failed");
    } finally {
      await allowed.stop();
    }

    const disabled = await startServer({ SKILLFORGE_IMPORT_GIT: "false", SKILLFORGE_IMPORT_ALLOW_FILE_URLS: "true" }, { prefix: "skillforge-gitoff-" });
    assert.ok(disabled.up, disabled.stderr);
    try {
      const a = await login(disabled.base, "admin", ADMIN_PASSWORD);
      const r = await rawApi(disabled.base, "POST", "/api/v1/imports/preview", { source: { kind: "git", url } }, { cookie: a.cookie });
      assert.equal(r.status, 400);
      assert.equal(r.data.error, "import_git_disabled");
    } finally {
      await disabled.stop();
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("git: path and ref are validated; directory traversal and git options are rejected as bad_request", async () => {
  const work = mkdtempSync(join(tmpdir(), "skillforge-gitsafe-"));
  const repo = join(work, "repo");
  cpSync(SAMPLE, repo, { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString();
  git("init", "-q", "-b", "main");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "sample");
  const url = pathToFileURL(repo).href;
  const allowed = await startServer({ SKILLFORGE_IMPORT_ALLOW_FILE_URLS: "true" }, { prefix: "skillforge-gitsafe-" });
  assert.ok(allowed.up, allowed.stderr);
  try {
    const a = await login(allowed.base, "admin", ADMIN_PASSWORD);
    for (const badPath of ["../../..", "..", "skills/../..", "/etc", "C:\Windows"]) {
      const r = await rawApi(allowed.base, "POST", "/api/v1/imports/preview", { source: { kind: "git", url, path: badPath } }, { cookie: a.cookie });
      assert.equal(r.status, 400, `path=${badPath}: ${JSON.stringify(r.data)}`);
      assert.equal(r.data.error, "bad_request", `path=${badPath}`);
    }
    for (const badRef of ["--upload-pack=calc", "-x", "main; rm -rf /", "a b"]) {
      const r = await rawApi(allowed.base, "POST", "/api/v1/imports/preview", { source: { kind: "git", url, ref: badRef } }, { cookie: a.cookie });
      assert.equal(r.status, 400, `ref=${badRef}: ${JSON.stringify(r.data)}`);
      assert.equal(r.data.error, "bad_request", `ref=${badRef}`);
    }
    const okPath = await rawApi(allowed.base, "POST", "/api/v1/imports/preview", { source: { kind: "git", url, ref: "main", path: "skills" } }, { cookie: a.cookie });
    assert.equal(okPath.status, 200, JSON.stringify(okPath.data));
    assert.deepEqual(okPath.data.candidates.map((c) => c.id), ["skill/csv-tools"]);
    // fix-import-root-skill: the folder's other files come with SKILL.md, whether path names the parent or the folder.
    assert.deepEqual(okPath.data.candidates[0].files.map((f) => f.path).sort(), ["SKILL.md", "references/REFERENCE.md"]);
    const skillPath = await rawApi(allowed.base, "POST", "/api/v1/imports/preview", { source: { kind: "git", url, ref: "main", path: "skills/csv-tools" } }, { cookie: a.cookie });
    assert.equal(skillPath.status, 200, JSON.stringify(skillPath.data));
    assert.deepEqual(skillPath.data.candidates.map((c) => c.id), ["skill/csv-tools"]);
    assert.deepEqual(skillPath.data.candidates[0].files.map((f) => f.path).sort(), ["SKILL.md", "references/REFERENCE.md"]);
    const missingPath = await rawApi(allowed.base, "POST", "/api/v1/imports/preview", { source: { kind: "git", url, path: "nope" } }, { cookie: a.cookie });
    assert.equal(missingPath.status, 400);
    assert.equal(missingPath.data.error, "import_git_failed");
  } finally {
    await allowed.stop();
    rmSync(work, { recursive: true, force: true });
  }
});

test("git: userinfo is masked in ref and messages", async () => {
  const allowed = await startServer({ SKILLFORGE_IMPORT_ALLOW_FILE_URLS: "true" }, { prefix: "skillforge-gitmask-" });
  assert.ok(allowed.up, allowed.stderr);
  try {
    const a = await login(allowed.base, "admin", ADMIN_PASSWORD);
    const r = await rawApi(allowed.base, "POST", "/api/v1/imports/preview", { source: { kind: "git", url: "https://user:s3cr3t-token@example.invalid/repo.git" } }, { cookie: a.cookie });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, "import_git_failed");
    assert.ok(!JSON.stringify(r.data).includes("s3cr3t-token"), "the token leaked into the response");
  } finally {
    await allowed.stop();
  }
});
