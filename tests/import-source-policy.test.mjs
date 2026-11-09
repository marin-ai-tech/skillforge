// Acceptance tests for the import source policy. The policy is checked with address-parsing attacks, the release quarantine with
// a real git repository and by shifting the time of first appearance in the database.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { zipSync, strToU8 } from "fflate";
import { startServer, api, login, createUser, toB64, ADMIN_PASSWORD } from "./lib/client.mjs";

const POLICY = "/api/v1/admin/import-policy";
let srv;
let work;
let repo;
let url;
const auth = {};

const call = (method, path, body, who = auth.admin) => api(srv.base, method, path, body, { cookie: who.cookie });
const preview = (source, who = auth.alice) => call("POST", "/api/v1/imports/preview", { source }, who);
const run = (import_id, extra = {}, who = auth.alice) => call("POST", "/api/v1/imports/run", { import_id, selected: "all", ...extra }, who);
const setPolicy = (body, who = auth.admin) => call("PUT", POLICY, body, who);
const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: repo, stdio: "pipe" }).toString().trim();
const skillMd = (name, text = "") => `---\nname: ${name}\ndescription: A test skill. Use when testing imports.\n---\n\n# ${name}\n${text}\n`;

function commitSkill(name, text = "") {
  mkdirSync(join(repo, "skills", name), { recursive: true });
  writeFileSync(join(repo, "skills", name, "SKILL.md"), skillMd(name, text));
  git("add", "-A");
  git("commit", "-q", "-m", `add ${name}`);
  return git("rev-parse", "HEAD");
}
function firstSeenDaysAgo(sha, days) {
  const db = new DatabaseSync(join(srv.dataDir, "skillforge.db"));
  const at = new Date(Date.now() - days * 86_400_000).toISOString();
  const res = db.prepare("UPDATE import_commit_seen SET first_seen_at = ? WHERE commit_sha = ?").run(at, sha);
  db.close();
  assert.equal(Number(res.changes), 1, "the commit must be recorded at preview");
}

before(async () => {
  work = mkdtempSync(join(tmpdir(), "skillforge-policy-"));
  repo = join(work, "repo");
  mkdirSync(repo);
  git("init", "-q", "-b", "main");
  commitSkill("first-skill");
  url = pathToFileURL(repo).href;
  srv = await startServer({ SKILLFORGE_IMPORT_ALLOW_FILE_URLS: "true" }, { prefix: "skillforge-policy-srv-" });
  assert.ok(srv.up, srv.stderr);
  auth.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [["alice", "contributor"], ["rita", "reviewer"]]) {
    await createUser(srv.base, auth.admin.cookie, { username: u, password: `${u}-pw-123456`, role });
    auth[u] = await login(srv.base, u, `${u}-pw-123456`);
  }
});

after(async () => {
  await srv?.stop();
  rmSync(work, { recursive: true, force: true });
});

test("nothing changes by default; only admin sees and changes the policy; values are validated", async () => {
  const d = await call("GET", POLICY);
  assert.deepEqual(d.data.policy, { git_mode: "open", allowed_sources: [], allow_archives: true, min_release_age_days: 0 });

  assert.equal((await preview({ kind: "git", url })).status, 200);
  assert.equal((await call("GET", POLICY, undefined, auth.rita)).status, 403);
  assert.equal((await setPolicy({ git_mode: "allowlist" }, auth.rita)).status, 403);

  for (const bad of [
    { git_mode: "maybe" },
    { allowed_sources: ["https://github.com/acme"] },
    { allowed_sources: ["*"] },
    { allowed_sources: ["github.com/*"] },
    { allowed_sources: ["github.com/../x"] },
    { allowed_sources: ["user@github.com/acme"] },
    { min_release_age_days: -1 },
    { min_release_age_days: 1.5 },
    { allow_archives: "no" },
    { unknown: 1 },
  ]) {
    const r = await setPolicy(bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  const norm = await setPolicy({ allowed_sources: ["GitHub.com/Acme/", "gitlab.example.com:8443/team"] });
  assert.deepEqual(norm.data.policy.allowed_sources, ["github.com/acme", "gitlab.example.com:8443/team"]);
  await setPolicy({ allowed_sources: [] });
});

test("allow list: address spoofing does not pass", async () => {
  await setPolicy({ git_mode: "allowlist", allowed_sources: ["github.com/acme"] });
  for (const attack of [
    "https://github.com.evil.example/acme/x.git",
    "https://evil.example/github.com/acme/x.git",
    "https://github.com@evil.example/acme/x.git",
    "https://github.com:443@evil.example/acme/x.git",
    "https://github.com/acmeevil/x.git",
    "https://github.com/other/x.git",
    "https://github.com/acme%2f..%2fother/x.git",
    "https://github.com/acme/../other/x.git",
    "https://github.com:8443/acme/x.git",
    "ssh://git@evil.example/acme/x.git",
    "git@evil.example:acme/x.git",
    "git@github.com:other/x.git",
    "git@github.com:acme/../other/x.git",
    url,
  ]) {
    const r = await preview({ kind: "git", url: attack });
    assert.equal(r.status, 403, `${attack}: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.error, "import_source_not_allowed", attack);
  }
});

test("allow list: an allowed address reaches the clone; port and case; local is only its own example", async () => {
  await setPolicy({ git_mode: "allowlist", allowed_sources: ["127.0.0.1:9/acme", "local"] });
  // No network or server: what matters is that the refusal comes from git, not from the policy.
  for (const ok of ["https://127.0.0.1:9/acme/x.git", "https://127.0.0.1:9/ACME/x.git", "ssh://git@127.0.0.1:9/acme/x.git"]) {
    const r = await preview({ kind: "git", url: ok });
    assert.notEqual(r.data.error, "import_source_not_allowed", ok);
    assert.equal(r.data.error, "import_git_failed", `${ok}: ${JSON.stringify(r.data)}`);
  }
  assert.equal((await preview({ kind: "git", url })).status, 200);
});

test("the policy is checked at run time too: tightened after preview, the import does not go through", async () => {
  await setPolicy({ git_mode: "open", allowed_sources: [] });
  const p = await preview({ kind: "git", url });
  assert.equal(p.status, 200);
  await setPolicy({ git_mode: "allowlist", allowed_sources: ["github.com/acme"] });
  const r = await run(p.data.import_id);
  assert.equal(r.status, 403, JSON.stringify(r.data));
  assert.equal(r.data.error, "import_source_not_allowed");
  assert.equal((await call("GET", "/api/v1/artifacts/skill/first-skill")).status, 404);
  await setPolicy({ git_mode: "open", allowed_sources: [] });
});

test("archives and folders: when forbidden, only admin; git is unaffected", async () => {
  const zip = Buffer.from(zipSync({ "arch-skill/SKILL.md": strToU8(skillMd("arch-skill")) })).toString("base64");
  const files = toB64([{ path: "folder-skill/SKILL.md", content: skillMd("folder-skill") }]);
  await setPolicy({ allow_archives: false });
  for (const source of [{ kind: "zip", content_base64: zip }, { kind: "files", files }]) {
    const r = await preview(source);
    assert.equal(r.status, 403, source.kind);
    assert.equal(r.data.error, "import_archives_disabled");
    assert.equal((await preview(source, auth.admin)).status, 200, `admin: ${source.kind}`);
  }
  assert.equal((await preview({ kind: "git", url })).status, 200);
  await setPolicy({ allow_archives: true });
});

test("the archive ban is checked at run time too", async () => {
  const files = toB64([{ path: "late-skill/SKILL.md", content: skillMd("late-skill") }]);
  const p = await preview({ kind: "files", files });
  await setPolicy({ allow_archives: false });
  const r = await run(p.data.import_id);
  assert.equal(r.status, 403);
  assert.equal(r.data.error, "import_archives_disabled");
  await setPolicy({ allow_archives: true });
});

test("quarantine: age is counted from the commit's first appearance in the registry; forging the commit date does not help", async () => {
  await setPolicy({ min_release_age_days: 7 });
  const sha = commitSkill("fresh-skill");
  const p = await preview({ kind: "git", url });
  assert.equal(p.status, 200);
  assert.equal(p.data.source.commit, sha);
  assert.equal(p.data.source.freshness.ready, false);
  assert.equal(p.data.source.freshness.required_days, 7);
  assert.ok(p.data.source.freshness.ready_at > new Date().toISOString());

  const r = await run(p.data.import_id);
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.error, "import_too_fresh");
  assert.ok(r.data.ready_at);
  assert.equal((await call("GET", "/api/v1/artifacts/skill/fresh-skill")).status, 404);

  // A commit dated in the past: the author controls the date, so it decides nothing.
  writeFileSync(join(repo, "skills", "fresh-skill", "SKILL.md"), skillMd("fresh-skill", "backdated"));
  git("add", "-A");
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "old", "--date=2001-01-01T00:00:00Z"], {
    cwd: repo,
    env: { ...process.env, GIT_COMMITTER_DATE: "2001-01-01T00:00:00Z" },
  });
  const backdated = await preview({ kind: "git", url });
  assert.equal(backdated.data.source.freshness.ready, false, "the commit date fooled the quarantine");

  // Seven days after the first appearance the same commit passes; the first request does not shift the time.
  const head = git("rev-parse", "HEAD");
  firstSeenDaysAgo(head, 8);
  const again = await preview({ kind: "git", url });
  assert.equal(again.data.source.freshness.ready, true);
  assert.equal((await run(again.data.import_id)).status, 200);
  assert.equal((await call("GET", "/api/v1/artifacts/skill/fresh-skill")).status, 200);
  await setPolicy({ min_release_age_days: 0 });
});

test("quarantine: only admin with a reason can bypass it, and it is visible in the audit", async () => {
  await setPolicy({ min_release_age_days: 7 });
  commitSkill("urgent-skill");
  const p = await preview({ kind: "git", url });

  const denied = await run(p.data.import_id, { age_override_reason: "very urgent fix" });
  assert.equal(denied.status, 403, "a contributor bypassed the quarantine");
  assert.equal(denied.data.error, "forbidden");

  const padmin = await preview({ kind: "git", url }, auth.admin);
  assert.equal((await run(padmin.data.import_id, { age_override_reason: "x" }, auth.admin)).status, 400, "a one-character reason");

  const padmin2 = await preview({ kind: "git", url }, auth.admin);
  const ok = await run(padmin2.data.import_id, { age_override_reason: "very urgent fix" }, auth.admin);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const audit = await call("GET", "/api/v1/artifacts/skill/urgent-skill/audit");
  const entry = audit.data.items.find((e) => e.meta?.import);
  assert.equal(entry.meta.import.age_override, "very urgent fix");
  await setPolicy({ min_release_age_days: 0 });
});
