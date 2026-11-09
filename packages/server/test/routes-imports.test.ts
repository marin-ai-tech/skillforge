import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withApp, loginCookie } from "./helpers.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const ZIP = join(ROOT, "tests", "fixtures", "imports", "plugin-sample.zip");

test("routes imports: auth and zip preview/run", async () => {
  await withApp(async (app) => {
    const anon = await app.inject({
      method: "POST",
      url: "/api/v1/imports/preview",
      payload: { source: { kind: "zip", content_base64: "YWJj" } },
    });
    assert.equal(anon.statusCode, 401);

    const cookie = await loginCookie(app);
    const zip = readFileSync(ZIP).toString("base64");
    const preview = await app.inject({
      method: "POST",
      url: "/api/v1/imports/preview",
      headers: { cookie },
      payload: { source: { kind: "zip", content_base64: zip } },
    });
    assert.equal(preview.statusCode, 200, preview.body);
    const body = preview.json() as {
      import_id: string;
      candidates: Array<{ id: string; dry_run: { ok: boolean } }>;
    };
    assert.ok(body.import_id.length >= 16);
    assert.equal(body.candidates.length, 5);
    for (const c of body.candidates) assert.equal(c.dry_run.ok, true);

    const run = await app.inject({
      method: "POST",
      url: "/api/v1/imports/run",
      headers: { cookie },
      payload: { import_id: body.import_id, selected: "all" },
    });
    assert.equal(run.statusCode, 200, run.body);
    const results = (run.json() as { results: Array<{ status: string }> }).results;
    assert.equal(results.length, 5);
    assert.ok(results.every((r) => r.status === "created"));

    const again = await app.inject({
      method: "POST",
      url: "/api/v1/imports/run",
      headers: { cookie },
      payload: { import_id: body.import_id, selected: "all" },
    });
    assert.equal(again.statusCode, 410);
  });
});
