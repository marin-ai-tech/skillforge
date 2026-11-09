import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { ManifestError, parseManifest, resolveMainPath } from "../src/plugins/manifest.ts";
import { applyDefaults, validateConfig } from "../src/plugins/config-schema.ts";

test("parseManifest: accepts hello-shaped manifest", () => {
  const m = parseManifest(
    {
      name: "hello",
      version: "1.0.0",
      api: 1,
      description: "x",
      capabilities: ["routes"],
      config_schema: {
        type: "object",
        properties: { greeting: { type: "string", default: "Hi" } },
        required: [],
      },
    },
    "hello",
  );
  assert.equal(m.main, "index.js");
  assert.equal(m.name, "hello");
});

test("parseManifest: rejects api mismatch and name mismatch", () => {
  assert.throws(
    () => parseManifest({ name: "x", version: "1", api: 2 }, "x"),
    (e: unknown) => e instanceof ManifestError && /api/i.test((e as Error).message),
  );
  assert.throws(
    () => parseManifest({ name: "other", version: "1", api: 1 }, "name-mismatch"),
    (e: unknown) => e instanceof ManifestError && /name/i.test((e as Error).message),
  );
});

test("resolveMainPath: rejects absolute and ..", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-plug-"));
  try {
    assert.throws(() => resolveMainPath(dir, path.resolve(dir, "x.js")), ManifestError);
    assert.throws(() => resolveMainPath(dir, "../x.js"), ManifestError);
    const ok = resolveMainPath(dir, "index.js");
    assert.equal(ok, path.resolve(dir, "index.js"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("validateConfig + applyDefaults", () => {
  const schema = {
    type: "object" as const,
    properties: {
      greeting: { type: "string" as const, default: "Hello" },
      shout: { type: "boolean" as const, default: false },
    },
    required: [] as string[],
  };
  const bad = validateConfig(schema, { greeting: 5 });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.ok(bad.issues.some((i) => i.path === "greeting"));
  const unknown = validateConfig(schema, { greeting: "x", extra: 1 });
  assert.equal(unknown.ok, false);
  const notObj = validateConfig(schema, "nope");
  assert.equal(notObj.ok, false);
  const ok = validateConfig(schema, { greeting: "Hi" });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.deepEqual(applyDefaults(schema, ok.value), { greeting: "Hi", shout: false });
  }
});
