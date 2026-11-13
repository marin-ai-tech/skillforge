// fix-seed-demo: `npm run seed:demo` fills a fresh local registry and is safe to run again (exists/skip).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, ROOT } from "./lib/client.mjs";

test("seed:demo on a fresh data folder: exit 0 twice; the second run creates nothing", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "skillforge-seed-demo-"));
  try {
    // The first start bootstraps the admin, as `npm run local:start` does; seed:demo refuses an empty database.
    const srv = await startServer({}, { dataDir });
    assert.ok(srv.up, srv.stderr);
    await srv.stop();
    const env = { ...process.env, SKILLFORGE_DATA_DIR: dataDir, SEED_DEMO_PASSWORD: "demo-test-pw-1234" };
    delete env.NODE_ENV;
    const seed = () =>
      spawnSync(process.execPath, ["--experimental-strip-types", join(ROOT, "scripts", "seed-demo.ts")], { cwd: ROOT, env, encoding: "utf8", timeout: 120_000 });
    const first = seed();
    assert.equal(first.status, 0, first.stdout + first.stderr);
    assert.match(first.stdout, /\[created\]/);
    const second = seed();
    assert.equal(second.status, 0, second.stdout + second.stderr);
    // Negative: a re-run only finds what is there.
    assert.doesNotMatch(second.stdout, /\[created\]/, second.stdout);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
