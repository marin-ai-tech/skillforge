// sync-adopt-identical (#187): files of a version that are already on disk without a lock entry and match what the CLI
// would write (bytes, or only line endings for text) are adopted: the lock gets an entry, the result is `adopted`.
// A differing file keeps the old refusal and only differing files are named. Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { startServer, api, login, createUser, toB64, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const SKILL = (name) =>
  `---\nname: ${name}\ndescription: Adopt probe ${name}. Use when testing adoption.\n---\n\n# ${name}\n\nStep one.\nStep two.\n`;
const REF = "Reference notes.\nLine two.\n";
let srv;
let work;
let env;
const auth = {};
const call = (method, path, body, who = auth.admin) => api(srv.base, method, path, body, { cookie: who.cookie });
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { env, encoding: "utf8", timeout: 60_000 });
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

async function publishActive(name, files) {
  const r = await call("POST", "/api/v1/artifacts", { type: "skill", version: "0.1.0", files: toB64(files) }, auth.lena);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const t = await call("POST", `/api/v1/artifacts/skill/${name}/transitions`, { to: "active", reason: "adopt test" }, auth.rita);
  assert.equal(t.status, 200, JSON.stringify(t.data));
}

/** Writes the given files under <into>/skills/<name>/ as if they had been copied there before SkillForge. */
function place(into, name, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(into, "skills", name, ...rel.split("/"));
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
}
const lockOf = (into) => {
  const p = join(into, ".skillforge-lock.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
};

before(async () => {
  work = mkdtempSync(join(tmpdir(), "skillforge-adopt-"));
  srv = await startServer({ SKILLFORGE_DATA_DIR: join(work, "data") }, { prefix: "skillforge-adopt-srv-" });
  assert.ok(srv.up, srv.stderr);
  auth.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [["lena", "contributor"], ["rita", "reviewer"]]) {
    await createUser(srv.base, auth.admin.cookie, { username: u, password: `${u}-pw-123456`, role });
    auth[u] = await login(srv.base, u, `${u}-pw-123456`);
  }
  await publishActive("adopt-one", [{ path: "adopt-one/SKILL.md", content: SKILL("adopt-one") }]);
  await publishActive("adopt-two", [
    { path: "adopt-two/SKILL.md", content: SKILL("adopt-two") },
    { path: "adopt-two/references/notes.md", content: REF },
  ]);
  const tok = await call("POST", "/api/v1/me/tokens", { name: "adopt-cli" }, auth.lena);
  assert.equal(tok.status, 201, JSON.stringify(tok.data));
  env = { ...process.env, SKILLFORGE_URL: srv.base, SKILLFORGE_TOKEN: tok.data.token, SKILLFORGE_CONFIG: join(work, "cli.json"), NO_COLOR: "1" };
});

after(async () => {
  await srv?.stop();
  rmSync(work, { recursive: true, force: true });
});

test("sync adopts skills installed before SkillForge; an extra local file stays", () => {
  const into = join(work, "D");
  place(into, "adopt-one", { "SKILL.md": SKILL("adopt-one") });
  place(into, "adopt-two", { "SKILL.md": SKILL("adopt-two"), "references/notes.md": REF, "local-extra.md": "mine\n" });
  const r = cli("sync", "--into", into, "--status", "active");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /adopted=2/);
  assert.match(r.stdout, /adopted skill\/adopt-one@0\.1\.0/);
  assert.match(r.stdout, /adopted skill\/adopt-two@0\.1\.0/);
  const lock = lockOf(into);
  assert.equal(lock.artifacts["skill/adopt-one"].version, "0.1.0");
  const files = lock.artifacts["skill/adopt-one"].files;
  const [rel] = Object.keys(files);
  assert.equal(files[rel], sha(readFileSync(join(into, ...rel.split("/")))));
  assert.equal(readFileSync(join(into, "skills", "adopt-two", "local-extra.md"), "utf8"), "mine\n");

  const again = cli("sync", "--into", into, "--status", "active", "--json");
  assert.equal(again.status, 0, again.stderr);
  const summary = JSON.parse(again.stdout);
  assert.deepEqual(summary.adopted, []);
  assert.equal(summary.up_to_date.length, 2);
});

test("sync --json lists adopted artifacts", () => {
  const into = join(work, "DJ");
  place(into, "adopt-one", { "SKILL.md": SKILL("adopt-one") });
  const r = cli("sync", "--into", into, "--status", "active", "--type", "skill", "--json");
  assert.equal(r.status, 0, r.stderr);
  const summary = JSON.parse(r.stdout);
  assert.deepEqual(summary.adopted, ["skill/adopt-one@0.1.0"]);
  assert.deepEqual(summary.installed, ["skill/adopt-two@0.1.0"]);
});

test("only line endings differ: adopted, the file gets the registry bytes", () => {
  const into = join(work, "D2");
  place(into, "adopt-one", { "SKILL.md": SKILL("adopt-one").replace(/\n/g, "\r\n") });
  const r = cli("install", "skill/adopt-one", "--into", into);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /Adopted skill\/adopt-one@0\.1\.0/);
  assert.equal(readFileSync(join(into, "skills", "adopt-one", "SKILL.md"), "utf8").includes("\r\n"), false);
  assert.ok(lockOf(into).artifacts["skill/adopt-one"]);
});

test("negative: a local edit is refused; nothing changes", () => {
  const into = join(work, "D3");
  const edited = SKILL("adopt-one").replace("Step two.", "Step two, my way.");
  place(into, "adopt-one", { "SKILL.md": edited });
  const r = cli("install", "skill/adopt-one", "--into", into);
  assert.equal(r.status, 5, r.stdout + r.stderr);
  assert.match(r.stderr, /SKILL\.md/);
  assert.equal(readFileSync(join(into, "skills", "adopt-one", "SKILL.md"), "utf8"), edited);
  assert.equal(lockOf(into), null);
});

test("negative: one file matches, the other differs — the refusal names only the differing file", () => {
  const into = join(work, "D4");
  place(into, "adopt-two", { "SKILL.md": SKILL("adopt-two"), "references/notes.md": "Changed notes.\n" });
  const r = cli("install", "skill/adopt-two", "--into", into);
  assert.equal(r.status, 5, r.stdout + r.stderr);
  assert.match(r.stderr, /references\/notes\.md/);
  assert.doesNotMatch(r.stderr, /SKILL\.md/);
  assert.equal(readFileSync(join(into, "skills", "adopt-two", "references", "notes.md"), "utf8"), "Changed notes.\n");
  assert.equal(lockOf(into), null);
});
