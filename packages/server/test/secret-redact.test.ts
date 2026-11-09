import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { redact, registerRedactSecrets } from "../src/logging.ts";
import { buildDiagnosticsBundle } from "../src/routes/diagnostics-bundle.ts";
import { openDatabase } from "../src/db.ts";
import { makeConfig } from "./helpers.ts";

const SECRET = "sf-s3cr3t-value-should-never-leak";

test("redact masks secrets inside string fields: url userinfo, bearer, k=v", () => {
  const out = redact({
    message: `connect https://user:${SECRET}@ldap.example/ failed`,
    stack: `Error: Authorization: Bearer ${SECRET}\n  at x`,
    meta: `token=${SECRET}&page=1`,
    plain: "nothing sensitive",
  }) as Record<string, string>;
  assert.equal(out.message.includes(SECRET), false, out.message);
  assert.equal(out.stack.includes(SECRET), false, out.stack);
  assert.equal(out.meta.includes(SECRET), false, out.meta);
  assert.equal(out.plain, "nothing sensitive");
});

test("redact masks registered config secrets even without pattern match", () => {
  registerRedactSecrets([SECRET]);
  const out = redact({ msg: `value ${SECRET} inside`, nested: { deep: SECRET } }) as {
    msg: string;
    nested: { deep: string };
  };
  assert.equal(out.msg.includes(SECRET), false);
  assert.equal(out.nested.deep.includes(SECRET), false);
});

test("diagnostics bundle packs newest logs: current + .1 + .2", () => {
  const { config, dataDir, cleanup } = makeConfig({
    authMode: "password",
    publicUrl: null,
    oidcProviders: [],
    ldapProviders: [],
  });
  const logsDir = path.join(dataDir, "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(path.join(logsDir, "skillforge.log"), '{"msg":"current"}\n');
  for (let i = 1; i <= 5; i++) {
    fs.writeFileSync(path.join(logsDir, `skillforge.log.${i}`), `{"msg":"rotated-${i}"}\n`);
  }
  try {
    const db = openDatabase(dataDir);
    const bundle = buildDiagnosticsBundle({
      db,
      config,
      serverVersion: "0.0.0-test",
      startedAt: Date.now(),
    });
    const tar = zlib.gunzipSync(Buffer.from(bundle));
    const names = tar.toString("latin1");
    assert.ok(names.includes("logs/skillforge.log"), "current log must be packed");
    assert.ok(names.includes("logs/skillforge.log.1"), "newest rotation packed");
    assert.equal(names.includes("logs/skillforge.log.5"), false, "oldest rotation skipped");
    db.close();
  } finally {
    try {
      cleanup();
    } catch {
      // Windows: the DB still holds the file; the OS sweeps the directory, as in the root tests
    }
  }
});
