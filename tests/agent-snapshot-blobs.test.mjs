// An agent snapshot writes content to the blob store only
// for roles that can publish from the inventory (contributor+). A viewer snapshot computes hashes and compares them with the registry,
// but does not grow the store. Control: a contributor snapshot with the same content does add blobs.
// Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { startServer, api, login, createUser, toB64, ADMIN_PASSWORD } from "./lib/client.mjs";

let srv;
const U = {};

function countBlobs(dir) {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    n += statSync(p).isDirectory() ? countBlobs(p) : 1;
  }
  return n;
}

const files = (tag) =>
  toB64([
    { path: `skills/snap-${tag}/SKILL.md`, content: `---\nname: snap-${tag}\ndescription: Snapshot blob probe ${tag}\n---\n\n# snap ${tag}\n${"x".repeat(2048)}\n` },
    { path: `skills/snap-${tag}/notes.md`, content: `notes ${tag}\n` },
  ]);

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-agent-blobs-" });
  assert.ok(srv.up, srv.stderr);
  U.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [["vera", "viewer"], ["alice", "contributor"]]) {
    await createUser(srv.base, U.admin.cookie, { username: u, password: `${u}-pw-123`, role });
    U[u] = await login(srv.base, u, `${u}-pw-123`);
  }
});

after(async () => {
  try {
    await srv?.stop?.();
  } catch {
    try {
      rmSync(srv.dataDir, { recursive: true, force: true });
    } catch {
      /* Windows EPERM */
    }
  }
});

test("viewer snapshot writes no blobs but comparison works; contributor snapshot writes them", { timeout: 60_000 }, async () => {
  const blobs = join(srv.dataDir, "blobs");
  const before0 = countBlobs(blobs);

  const v = await api(srv.base, "PUT", "/api/v1/me/agents/vera-laptop", { runtime: "claude-code", files: files("v") }, { cookie: U.vera.cookie });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  assert.equal(countBlobs(blobs), before0, "viewer snapshot added files to the blob store");
  const got = await api(srv.base, "GET", "/api/v1/me/agents/vera-laptop?registry_status=all", undefined, { cookie: U.vera.cookie });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.ok(JSON.stringify(got.data).includes("snap-v"), "viewer snapshot must contain the item for comparison");

  const a = await api(srv.base, "PUT", "/api/v1/me/agents/alice-laptop", { runtime: "claude-code", files: files("a") }, { cookie: U.alice.cookie });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.ok(countBlobs(blobs) > before0, "control: contributor snapshot must write blobs (publishing from the inventory)");
});
