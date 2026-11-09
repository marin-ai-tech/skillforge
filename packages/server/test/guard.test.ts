import { test } from "node:test";
import assert from "node:assert/strict";
import { withApp, loginCookie, TEST_ADMIN_PASSWORD } from "./helpers.ts";

test("guard: publicRead true/false, POST without auth, viewer 403, Bearer ok", async () => {
  await withApp(async (app) => {
    const anonGet = await app.inject({ method: "GET", url: "/api/v1/artifacts" });
    assert.equal(anonGet.statusCode, 200);
    const anonPost = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      payload: { type: "skill", files: [] },
    });
    assert.equal(anonPost.statusCode, 401);

    const adminCookie = await loginCookie(app);
    const createViewer = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      headers: { cookie: adminCookie },
      payload: { username: "view1", password: "view-pw-12", role: "viewer" },
    });
    assert.equal(createViewer.statusCode, 201);
    const viewerCookie = await loginCookie(app, "view1", "view-pw-12");
    const forbidden = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts/validate",
      headers: { cookie: viewerCookie },
      payload: {
        files: [{ path: "SKILL.md", content_base64: Buffer.from("x").toString("base64") }],
      },
    });
    assert.equal(forbidden.statusCode, 403);

    const tok = await app.inject({
      method: "POST",
      url: "/api/v1/me/tokens",
      headers: { cookie: adminCookie },
      payload: { name: "t" },
    });
    assert.equal(tok.statusCode, 201);
    const me = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: `Bearer ${tok.json().token}` },
    });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().user.username, "admin");
    void TEST_ADMIN_PASSWORD;
  });

  await withApp(
    async (app) => {
      const anon = await app.inject({ method: "GET", url: "/api/v1/artifacts" });
      assert.equal(anon.statusCode, 401);
      const health = await app.inject({ method: "GET", url: "/api/v1/health" });
      assert.equal(health.statusCode, 200);
    },
    { publicRead: false },
  );
});
