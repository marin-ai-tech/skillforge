// Backup is complete (signing key and plugins from the data directory) and restoring into an empty directory returns the same key.
// Without the key the restored server creates a new one, and every CLI that remembered the key at login refuses to install ("signing key changed").
// Negative cases: initial-admin-password.txt and backups/ are not in the backup; the backup file is owner-only. Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, ADMIN_PASSWORD, ROOT } from "./lib/client.mjs";

const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const cleanup = [];
let srv;
let admin;
let backup;
let entries;

/** Unpack the backup archive into a directory; GNU tar on Windows reads `C:\…` as a host — so use relative paths. */
function extract(archive, dir) {
  const x = spawnSync("tar", ["-xzf", archive.replace(/\\/g, "/"), "-C", dir.replace(/\\/g, "/")], { encoding: "utf8" });
  if (x.status === 0) return;
  const name = "copy.tar.gz";
  cpSync(archive, join(dir, name));
  const y = spawnSync("tar", ["-xzf", name], { cwd: dir, encoding: "utf8" });
  assert.equal(y.status, 0, y.stderr);
  rmSync(join(dir, name));
}

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-backup-key-" });
  assert.ok(srv.up, srv.stderr);
  admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  // A custom plugin in the data directory (default SKILLFORGE_PLUGINS_DIR = <data>/plugins) and the initial password file.
  cpSync(join(ROOT, "tests", "fixtures", "plugins", "badge-probe"), join(srv.dataDir, "plugins", "badge-probe"), { recursive: true });
  writeFileSync(join(srv.dataDir, "initial-admin-password.txt"), "not-a-real-password\n");
  const created = await api(srv.base, "POST", "/api/v1/admin/backups", undefined, admin);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  backup = join(srv.dataDir, "backups", created.data.backup.name);
  const listing = spawnSync("tar", ["-tzf", created.data.backup.name], { cwd: join(srv.dataDir, "backups"), encoding: "utf8" });
  assert.equal(listing.status, 0, listing.stderr);
  entries = listing.stdout.split(/\r?\n/).filter(Boolean).map((e) => e.replace(/^\.\//, ""));
});

after(async () => {
  await srv?.stop?.();
  for (const d of cleanup) rmSync(d, { recursive: true, force: true });
});

test("backup contains the signing key and plugin files, but not the initial password or backups/", () => {
  assert.ok(entries.includes("signing/ed25519.pem"), `no signing key: ${entries.join(",")}`);
  assert.ok(entries.includes("plugins/badge-probe/index.js"), `no plugin files: ${entries.join(",")}`);
  assert.ok(entries.includes("plugins/badge-probe/skillforge-plugin.json"), entries.join(","));
  assert.ok(entries.includes("skillforge.db") && entries.includes("manifest.json"), entries.join(","));
  for (const bad of ["initial-admin-password.txt"]) assert.ok(!entries.includes(bad), `backup contains ${bad}`);
  assert.ok(!entries.some((e) => e.startsWith("backups/") || e.startsWith(".backup-tmp")), entries.join(","));
});

test("backup file is accessible only to the owner (POSIX)", { skip: process.platform === "win32" ? "POSIX permissions" : false }, () => {
  assert.equal(statSync(backup).mode & 0o077, 0, `permissions${(statSync(backup).mode & 0o777).toString(8)}`);
});

test("manifest.signing_key_id = key_id from install-info; the restored server has the same key and plugin", async () => {
  const info = await api(srv.base, "GET", "/api/v1/install-info");
  const keyId = info.data.signing.key_id;
  const restored = mkdtempSync(join(tmpdir(), "skillforge-backup-key-restore-"));
  cleanup.push(restored);
  extract(backup, restored);
  const manifest = JSON.parse(readFileSync(join(restored, "manifest.json"), "utf8"));
  assert.equal(manifest.format, 1);
  assert.equal(manifest.signing_key_id, keyId, "manifest.signing_key_id");
  assert.ok(existsSync(join(restored, "signing", "ed25519.pem")), "key not restored");
  assert.equal(sha(join(restored, "signing", "ed25519.pem")), sha(join(srv.dataDir, "signing", "ed25519.pem")), "backup has a different key");

  const second = await startServer({ SKILLFORGE_DATA_DIR: restored }, { prefix: "skillforge-backup-key-srv-" });
  assert.ok(second.up, `restored server did not start: ${second.stderr}`);
  try {
    const again = await api(second.base, "GET", "/api/v1/install-info");
    assert.equal(again.data.signing.key_id, keyId, "signing key changed after restore");
    const health = await api(second.base, "GET", "/api/v1/health");
    assert.ok(health.data.plugins.loaded >= 1, `plugin from backup not loaded: ${JSON.stringify(health.data.plugins)}`);
  } finally {
    await second.stop();
  }
});
