// The data directory path in /health is visible only to admin.
// Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { startServer, api, login, createUser, ADMIN_PASSWORD } from "./lib/client.mjs";

let srv;
let base;
let admin;

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-health-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  await createUser(base, admin.cookie, { username: "vic", password: "vic-pw-123", role: "viewer" });
});

after(async () => {
  if (srv?.up) await srv.stop();
});

function assertCommon(body) {
  assert.equal(body.status, "ok");
  assert.equal(body.db, "ok");
  assert.equal(typeof body.uptime_s, "number");
  assert.ok(typeof body.version === "string" && body.version.length > 0);
}

test("anonymous and viewer: health without data_dir, the other fields in place", async () => {
  const anon = await api(base, "GET", "/api/v1/health");
  assert.equal(anon.status, 200);
  assertCommon(anon.data);
  assert.equal("data_dir" in anon.data, false, "an anonymous user sees the path");

  const viewer = await login(base, "vic", "vic-pw-123");
  const v = await api(base, "GET", "/api/v1/health", undefined, { cookie: viewer.cookie });
  assertCommon(v.data);
  assert.equal("data_dir" in v.data, false, "viewer sees the path");
});

test("admin: by session and by token — the data directory path", async () => {
  const s = await api(base, "GET", "/api/v1/health", undefined, { cookie: admin.cookie });
  assertCommon(s.data);
  assert.equal(resolve(s.data.data_dir), resolve(srv.dataDir));
  const tok = await api(base, "POST", "/api/v1/me/tokens", { name: "ops" }, { cookie: admin.cookie });
  const t = await api(base, "GET", "/api/v1/health", undefined, { token: tok.data.token });
  assert.equal(resolve(t.data.data_dir), resolve(srv.dataDir));
});
