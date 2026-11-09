import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withApp, loginCookie } from "./helpers.ts";

function b64(s: string) {
  return Buffer.from(s, "utf8").toString("base64");
}

const skillMd =
  "---\nname: route-skill\ndescription: Route test skill for publish.\n---\n\n# Route\n\nBody.\n";

test("routes: publish, list, get, versions, file, audit, 404", async () => {
  await withApp(async (app, dataDir) => {
    const cookie = await loginCookie(app);
    const pub = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: { "content-type": "application/json", cookie, "x-skillforge-actor": "carol" },
      payload: {
        type: "skill",
        files: [{ path: "SKILL.md", content_base64: b64(skillMd) }],
      },
    });
    assert.equal(pub.statusCode, 201, pub.body);
    const created = pub.json();
    assert.equal(created.artifact.name, "route-skill");
    assert.equal(created.version.published_by, "admin");
    assert.equal(created.artifact.latest_version, "0.1.0");

    const list = await app.inject({ method: "GET", url: "/api/v1/artifacts?type=skill" });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().total, 1);

    const badLimit = await app.inject({ method: "GET", url: "/api/v1/artifacts?limit=0" });
    assert.equal(badLimit.statusCode, 400);
    assert.equal(badLimit.json().error, "bad_request");

    const card = await app.inject({
      method: "GET",
      url: "/api/v1/artifacts/skill/route-skill",
    });
    assert.equal(card.statusCode, 200);
    assert.equal(card.json().latest.version, "0.1.0");

    const versions = await app.inject({
      method: "GET",
      url: "/api/v1/artifacts/skill/route-skill/versions",
    });
    assert.equal(versions.statusCode, 200);
    assert.equal(versions.json().items[0].version, "0.1.0");

    const latest = await app.inject({
      method: "GET",
      url: "/api/v1/artifacts/skill/route-skill/versions/latest",
    });
    assert.equal(latest.statusCode, 200);
    assert.equal(latest.json().version, "0.1.0");

    const filePath = created.version.files[0].path;
    const file = await app.inject({
      method: "GET",
      url: `/api/v1/artifacts/skill/route-skill/versions/0.1.0/files/${filePath}`,
    });
    assert.equal(file.statusCode, 200);
    assert.match(file.headers["content-type"] ?? "", /text\/markdown/);
    assert.equal(file.headers["etag"]?.replace(/"/g, ""), created.version.files[0].sha256);
    assert.match(file.headers["cache-control"] ?? "", /immutable/);
    assert.ok(
      fs.existsSync(
        path.join(
          dataDir,
          "blobs",
          created.version.files[0].sha256.slice(0, 2),
          created.version.files[0].sha256,
        ),
      ),
    );

    const audit = await app.inject({
      method: "GET",
      url: "/api/v1/artifacts/skill/route-skill/audit",
    });
    assert.equal(audit.statusCode, 200);
    assert.equal(audit.json().items[0].action, "publish");
    assert.equal(audit.json().items[0].actor, "admin");

    const nf = await app.inject({ method: "GET", url: "/api/v1/artifacts/skill/nope" });
    assert.equal(nf.statusCode, 404);
    assert.deepEqual(nf.json(), { error: "not_found" });

    const badType = await app.inject({ method: "GET", url: "/api/v1/artifacts/widget/x" });
    assert.equal(badType.statusCode, 404);

    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: { cookie },
      payload: {
        type: "skill",
        files: [
          {
            path: "SKILL.md",
            content_base64: b64("---\nname: Bad_Name\ndescription: X.\n---\n\nBody.\n"),
          },
        ],
      },
    });
    assert.equal(invalid.statusCode, 422);
    assert.equal(invalid.json().error, "validation_failed");
  });
});

test("routes: validate dry-run five scenarios and no writes", async () => {
  await withApp(async (app) => {
    const cookie = await loginCookie(app);
    const skillMdOk =
      "---\nname: validate-skill\ndescription: Validate route skill for dry-run.\n---\n\n# Body\n\nText.\n";
    const filesOk = [{ path: "SKILL.md", content_base64: b64(skillMdOk) }];

    const neu = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts/validate",
      headers: { cookie },
      payload: { files: filesOk },
    });
    assert.equal(neu.statusCode, 200, neu.body);
    const neuBody = neu.json();
    assert.equal(neuBody.ok, true);
    assert.equal(neuBody.detected_type, "skill");
    assert.equal(neuBody.type, "skill");
    assert.equal(neuBody.artifact.name, "validate-skill");
    assert.equal(neuBody.existing, null);
    assert.equal(neuBody.next_version, "0.1.0");
    assert.deepEqual(neuBody.conflicts, []);

    const badName = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts/validate",
      headers: { cookie },
      payload: {
        type: "skill",
        files: [
          {
            path: "SKILL.md",
            content_base64: b64("---\nname: PDF-Tools\ndescription: Handles PDFs.\n---\n\nBody.\n"),
          },
        ],
      },
    });
    assert.equal(badName.statusCode, 200);
    assert.equal(badName.json().ok, false);
    assert.equal(badName.json().artifact, null);
    assert.ok(badName.json().errors.some((e: { code: string }) => e.code === "E_NAME_INVALID"));
    assert.equal(badName.json().next_version, null);

    const pub = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: { cookie },
      payload: { type: "skill", files: filesOk },
    });
    assert.equal(pub.statusCode, 201, pub.body);

    const again = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts/validate",
      headers: { cookie },
      payload: { type: "skill", files: filesOk },
    });
    assert.equal(again.statusCode, 200);
    assert.equal(again.json().ok, true);
    assert.equal(again.json().existing.latest_version, "0.1.0");
    assert.ok(again.json().conflicts.includes("digest_exists"));
    assert.equal(again.json().next_version, "0.1.1");

    const unknown = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts/validate",
      headers: { cookie },
      payload: {
        files: [
          { path: "a.txt", content_base64: b64("a") },
          { path: "b.txt", content_base64: b64("b") },
        ],
      },
    });
    assert.equal(unknown.statusCode, 200);
    assert.equal(unknown.json().ok, false);
    assert.equal(unknown.json().type, null);
    assert.ok(unknown.json().errors.some((e: { code: string }) => e.code === "E_TYPE_UNKNOWN"));

    const health = await app.inject({ method: "GET", url: "/api/v1/health" });
    assert.equal(health.json().artifacts, 1);

    const missing = await app.inject({
      method: "GET",
      url: "/api/v1/artifacts/skill/never-validated",
    });
    assert.equal(missing.statusCode, 404);

    const noFiles = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts/validate",
      headers: { cookie },
      payload: { type: "skill" },
    });
    assert.equal(noFiles.statusCode, 400);
    assert.equal(noFiles.json().error, "bad_request");
  });
});
