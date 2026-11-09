import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildApp } from "../src/app.ts";
import type { AppConfig } from "../src/config.ts";
import { makeConfig, loginCookie } from "./helpers.ts";

test("health returns ok JSON", async () => {
  const { config, cleanup } = makeConfig();
  const app = await buildApp(config);
  try {
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers["content-type"] ?? "", /application\/json/);
    const body = res.json();
    assert.equal(body.status, "ok");
    assert.equal(body.db, "ok");
    assert.equal(typeof body.uptime_s, "number");
    assert.ok(typeof body.version === "string" && body.version.length > 0);
    // Anonymous health carries no data path.
    assert.equal("data_dir" in body, false);
    assert.equal(body.artifacts, 0);
  } finally {
    await app.close();
    cleanup();
  }
});

test("health artifacts count increases after publish via inject", async () => {
  const { config, cleanup } = makeConfig();
  const app = await buildApp(config);
  try {
    const cookie = await loginCookie(app);
    for (let i = 0; i < 3; i++) {
      const name = `health-skill-${i}`;
      const body = `---\nname: ${name}\ndescription: Health count skill.\n---\n\nBody ${i}.\n`;
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/artifacts",
        headers: { cookie },
        payload: {
          type: "skill",
          files: [{ path: "SKILL.md", content_base64: Buffer.from(body).toString("base64") }],
        },
      });
      assert.equal(res.statusCode, 201, res.body);
    }
    const health = await app.inject({ method: "GET", url: "/api/v1/health" });
    assert.equal(health.json().artifacts, 3);
  } finally {
    await app.close();
    cleanup();
  }
});

test("unknown /api/ path returns JSON not_found", async () => {
  const { config, cleanup } = makeConfig();
  const app = await buildApp(config);
  try {
    const cookie = await loginCookie(app);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/does-not-exist",
      headers: { cookie },
    });
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.json(), { error: "not_found" });
  } finally {
    await app.close();
    cleanup();
  }
});

test("SPA fallback serves index.html from temp webDir", async () => {
  const { config, dataDir, cleanup } = makeConfig();
  const webDir = path.join(dataDir, "web");
  fs.mkdirSync(webDir, { recursive: true });
  const html =
    "<!doctype html><html><head><title>SkillForge</title></head><body>SkillForge</body></html>";
  fs.writeFileSync(path.join(webDir, "index.html"), html, "utf8");
  const cfg: AppConfig = { ...config, webDir };
  const app = await buildApp(cfg);
  try {
    const rootRes = await app.inject({ method: "GET", url: "/" });
    assert.equal(rootRes.statusCode, 200);
    assert.match(rootRes.headers["content-type"] ?? "", /text\/html/);
    assert.ok(rootRes.body.includes("SkillForge"));

    const deep = await app.inject({ method: "GET", url: "/artifacts/skills/some-name" });
    assert.equal(deep.statusCode, 200);
    assert.equal(deep.body, rootRes.body);
  } finally {
    await app.close();
    cleanup();
  }
});

test("missing web bundle returns 503", async () => {
  const { config, cleanup } = makeConfig();
  const app = await buildApp(config);
  try {
    const res = await app.inject({ method: "GET", url: "/" });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body, "web bundle not built");
  } finally {
    await app.close();
    cleanup();
  }
});
