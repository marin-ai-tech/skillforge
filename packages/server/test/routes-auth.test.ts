import { test } from "node:test";
import assert from "node:assert/strict";
import { withApp, loginCookie, TEST_ADMIN_PASSWORD } from "./helpers.ts";

test("routes-auth: login logout me password tokens", async () => {
  await withApp(async (app) => {
    const bad = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "admin", password: "wrong" },
    });
    assert.equal(bad.statusCode, 401);
    assert.equal(bad.json().error, "invalid_credentials");

    const cookie = await loginCookie(app);
    const me = await app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie } });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().user.username, "admin");

    const out = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie },
    });
    assert.equal(out.statusCode, 204);
    const after = await app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie } });
    assert.equal(after.statusCode, 401);

    const c2 = await loginCookie(app);
    const weak = await app.inject({
      method: "POST",
      url: "/api/v1/me/password",
      headers: { cookie: c2 },
      payload: { current: TEST_ADMIN_PASSWORD, next: "short" },
    });
    assert.equal(weak.statusCode, 400);

    const tok = await app.inject({
      method: "POST",
      url: "/api/v1/me/tokens",
      headers: { cookie: c2 },
      payload: { name: "ci" },
    });
    assert.equal(tok.statusCode, 201);
    assert.ok(tok.json().token);
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/me/tokens",
      headers: { cookie: c2 },
    });
    assert.equal(list.json().items.length, 1);
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/me/tokens/${tok.json().id}`,
      headers: { cookie: c2 },
    });
    assert.equal(del.statusCode, 204);
  });
});
