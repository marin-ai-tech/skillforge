// fix-readable-codes: a publish conflict is one readable message in stderr with the next step, not a bare code twice.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

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
