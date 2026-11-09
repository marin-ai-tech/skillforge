import { test } from "node:test";
import assert from "node:assert/strict";
import { withApp, loginCookie } from "./helpers.ts";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SKILL_MD = `---
name: dist-skill
description: Distribution test skill for marketplace packaging.
---

# Dist skill
`;

test("routes-distribution: marketplace active-only, 304, tar, zip, counter, 404", async () => {
  await withApp(async (app) => {
    const cookie = await loginCookie(app);
    const pub = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: { cookie },
      payload: {
        type: "skill",
        name: "dist-skill",
        files: [
          {
            path: "SKILL.md",
            content_base64: Buffer.from(SKILL_MD).toString("base64"),
          },
        ],
      },
    });
    assert.equal(pub.statusCode, 201, pub.body);

    const empty = await app.inject({ method: "GET", url: "/marketplace.json" });
    assert.equal(empty.statusCode, 200);
    assert.deepEqual(JSON.parse(empty.body).plugins, []);

    // promote via reviewer: create reviewer and transition
    const adminCookie = cookie;
    const createR = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      headers: { cookie: adminCookie },
      payload: { username: "rev1", password: "rev-pw-1234", role: "reviewer" },
    });
    assert.equal(createR.statusCode, 201, createR.body);
    const revCookie = await loginCookie(app, "rev1", "rev-pw-1234");
    const tr = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts/skill/dist-skill/transitions",
      headers: { cookie: revCookie },
      payload: { to: "active" },
    });
    assert.equal(tr.statusCode, 200, tr.body);

    const m = await app.inject({ method: "GET", url: "/marketplace.json" });
    assert.equal(m.statusCode, 200);
    const body = JSON.parse(m.body);
    assert.equal(body.plugins.length, 1);
    assert.equal(body.plugins[0].name, "dist-skill");
    const etag = m.headers.etag;
    assert.ok(etag);
    const cached = await app.inject({
      method: "GET",
      url: "/marketplace.json",
      headers: { "if-none-match": String(etag) },
    });
    assert.equal(cached.statusCode, 304);

    const tgz = await app.inject({
      method: "GET",
      url: "/api/v1/plugins/skill/dist-skill/latest.tar.gz",
    });
    assert.equal(tgz.statusCode, 200);
    assert.match(String(tgz.headers["content-type"]), /gzip/);
    const dir = mkdtempSync(join(tmpdir(), "sf-rd-"));
    try {
      mkdirSync(join(dir, "out"));
      writeFileSync(join(dir, "p.tar.gz"), tgz.rawPayload);
      execFileSync("tar", ["-xzf", "p.tar.gz", "-C", "out"], { cwd: dir, stdio: "pipe" });
      assert.ok(existsSync(join(dir, "out", ".claude-plugin", "plugin.json")));
      const pj = JSON.parse(
        readFileSync(join(dir, "out", ".claude-plugin", "plugin.json"), "utf8"),
      );
      assert.equal(pj.name, "dist-skill");
      assert.equal(pj.metadata.skillforge_type, "skill");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    const zip = await app.inject({
      method: "GET",
      url: "/api/v1/artifacts/skill/dist-skill/versions/latest/bundle.zip",
    });
    assert.equal(zip.statusCode, 200);
    assert.match(String(zip.headers["content-disposition"]), /dist-skill-.*\.zip/);

    const card = await app.inject({ method: "GET", url: "/api/v1/artifacts/skill/dist-skill" });
    assert.equal(card.statusCode, 200);
    assert.ok(card.json().install);
    assert.equal(card.json().artifact.download_count, 2);

    const miss = await app.inject({
      method: "GET",
      url: "/api/v1/plugins/skill/nope/latest.tar.gz",
    });
    assert.equal(miss.statusCode, 404);

    const info = await app.inject({ method: "GET", url: "/api/v1/install-info" });
    assert.equal(info.statusCode, 200);
    assert.equal(info.json().marketplace_name, "skillforge");
  });
});
