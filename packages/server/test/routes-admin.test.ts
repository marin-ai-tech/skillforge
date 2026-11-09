import { test } from "node:test";
import assert from "node:assert/strict";
import { withApp, loginCookie } from "./helpers.ts";

test("routes-admin: create list patch last_admin", async () => {
  await withApp(async (app) => {
    const admin = await loginCookie(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      headers: { cookie: admin },
      payload: { username: "alice", password: "alice-pw-1", role: "contributor" },
    });
    assert.equal(created.statusCode, 201);
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/admin/users",
      headers: { cookie: admin },
    });
    assert.equal(list.statusCode, 200);
    assert.ok(list.json().items.some((u: { username: string }) => u.username === "alice"));

    const alice = await loginCookie(app, "alice", "alice-pw-1");
    const forbidden = await app.inject({
      method: "GET",
      url: "/api/v1/admin/users",
      headers: { cookie: alice },
    });
    assert.equal(forbidden.statusCode, 403);

    const adminId = list.json().items.find((u: { username: string }) => u.username === "admin").id;
    const last = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/users/${adminId}`,
      headers: { cookie: admin },
      payload: { role: "viewer" },
    });
    assert.equal(last.statusCode, 409);
    assert.equal(last.json().error, "last_admin");
  });
});
