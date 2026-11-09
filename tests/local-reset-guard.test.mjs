// Acceptance tests: `npm run local:reset` deletes the data directory only if it is a SkillForge data
// directory. A directory without the markers (skillforge.db or blobs/) stays in place, the command exits with a
// non-zero code and explains why.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, freePort } from "./lib/client.mjs";

const work = mkdtempSync(join(tmpdir(), "skillforge-reset-guard-"));
after(() => rmSync(work, { recursive: true, force: true }));

async function reset(dataDir) {
  const port = await freePort();
  return spawnSync("npm", ["run", "local:reset"], {
    shell: true,
    cwd: ROOT,
    env: { ...process.env, SKILLFORGE_DATA_DIR: dataDir, SKILLFORGE_PORT: String(port), LOCAL_RESET_CONFIRM: "1" },
    encoding: "utf8",
    timeout: 120_000,
  });
}

test("reset does not delete a directory without SkillForge data markers", { timeout: 180_000 }, async () => {
  const foreign = join(work, "not-skillforge");
  mkdirSync(foreign, { recursive: true });
  writeFileSync(join(foreign, "keep.txt"), "user data");
  const r = await reset(foreign);
  assert.notEqual(r.status, 0, `reset succeeded: ${r.stdout}\n${r.stderr}`);
  assert.ok(existsSync(join(foreign, "keep.txt")), "reset deleted a directory without SkillForge markers");
});

test("reset deletes a real data directory (control)", { timeout: 180_000 }, async () => {
  const real = join(work, "data");
  mkdirSync(join(real, "blobs"), { recursive: true });
  writeFileSync(join(real, "skillforge.db"), "");
  const r = await reset(real);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.ok(!existsSync(real), "the real data directory was not deleted");
});
