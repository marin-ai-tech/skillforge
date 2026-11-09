// A backup is packed as a stream and does not block
// the server. While a large data directory is being backed up, /api/v1/health responds without long pauses, and a second backup request
// gets 409 backup_in_progress (the mutex really works under parallel requests). The archive contains all blobs.
// Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startServer, api, login, ADMIN_PASSWORD } from "./lib/client.mjs";

const BLOBS = 60; // 60 x 2 MiB of random data ≈ 120 MiB: synchronous packing noticeably blocks the event loop
const BLOB_SIZE = 2 * 1024 * 1024;
const MAX_GAP_MS = 1500;

let srv;
let admin;

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-backup-stream-" });
  assert.ok(srv.up, srv.stderr);
  admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  // The blob store is content-addressed: blobs/<sha[0..2]>/<sha>. Write the files directly — the backup walks the directory.
  for (let i = 0; i < BLOBS; i++) {
    const content = randomBytes(BLOB_SIZE);
    const sha = createHash("sha256").update(content).digest("hex");
    mkdirSync(join(srv.dataDir, "blobs", sha.slice(0, 2)), { recursive: true });
    writeFileSync(join(srv.dataDir, "blobs", sha.slice(0, 2), sha), content);
  }
});

after(async () => {
  try {
    await srv?.stop?.();
  } catch {
    try {
      rmSync(srv.dataDir, { recursive: true, force: true });
    } catch {
      /* Windows EPERM — the OS will sweep it up */
    }
  }
});

test("backup of a large directory: health with no pauses > 1.5 s, second request → 409, all blobs in the archive", { timeout: 300_000 }, async () => {
  let running = true;
  let maxGap = 0;
  let healthOk = 0;
  const poll = (async () => {
    while (running) {
      const t0 = Date.now();
      const r = await fetch(`${srv.base}/api/v1/health`, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
      const dt = Date.now() - t0;
      if (r?.status === 200) healthOk += 1;
      maxGap = Math.max(maxGap, dt);
      await new Promise((res) => setTimeout(res, 50));
    }
  })();

  const first = api(srv.base, "POST", "/api/v1/admin/backups", {}, admin);
  await new Promise((res) => setTimeout(res, 300));
  const second = await api(srv.base, "POST", "/api/v1/admin/backups", {}, admin);
  const done = await first;
  running = false;
  await poll;

  assert.equal(done.status, 201, JSON.stringify(done.data));
  assert.ok(done.data.backup.counts.blobs >= BLOBS, `archive has ${done.data.backup.counts.blobs} blobs out of ${BLOBS}+`);
  assert.ok(done.data.backup.size > BLOBS * BLOB_SIZE * 0.9, `archive is suspiciously small: ${done.data.backup.size}`);
  assert.equal(second.status, 409, `second backup during the first: ${second.status} ${JSON.stringify(second.data)}`);
  assert.equal(second.data.error, "backup_in_progress");
  assert.ok(healthOk > 0, "health never responded");
  assert.ok(maxGap < MAX_GAP_MS, `health did not respond for ${maxGap} ms during the backup (threshold ${MAX_GAP_MS} ms)`);

  const list = await api(srv.base, "GET", "/api/v1/admin/backups", undefined, admin);
  assert.equal(list.status, 200);
  assert.equal(list.data.items.length, 1, "there must be exactly one copy");
});
