import { test } from "node:test";
import assert from "node:assert/strict";
import { assertMigrationNames, PluginError } from "../src/plugins/context.ts";

test("assertMigrationNames: UNIQUE INDEX without prefix errors", () => {
  assert.throws(
    () =>
      assertMigrationNames(
        "bad-index",
        "CREATE TABLE IF NOT EXISTS ext_bad_index_t (id INTEGER PRIMARY KEY, k TEXT); CREATE UNIQUE INDEX IF NOT EXISTS foo_unique ON ext_bad_index_t (k);",
      ),
    (e: unknown) =>
      e instanceof PluginError &&
      e.message.includes("foo_unique") &&
      e.message.includes("object must be prefixed with ext_bad-index_"),
  );
});

test("assertMigrationNames: underscored table name for hyphenated plugin is ok", () => {
  assert.doesNotThrow(() =>
    assertMigrationNames(
      "bad-index",
      "CREATE TABLE IF NOT EXISTS ext_bad_index_t (id INTEGER PRIMARY KEY);",
    ),
  );
  assert.doesNotThrow(() =>
    assertMigrationNames(
      "bad-index",
      'CREATE TABLE IF NOT EXISTS "ext_bad-index_t" (id INTEGER PRIMARY KEY);',
    ),
  );
});

test("assertMigrationNames: VIEW and TRIGGER require prefix", () => {
  assert.throws(
    () => assertMigrationNames("hello", "CREATE VIEW plain_view AS SELECT 1;"),
    (e: unknown) =>
      e instanceof PluginError &&
      /object must be prefixed with ext_hello_ \(got plain_view\)/.test((e as Error).message),
  );
  assert.doesNotThrow(() =>
    assertMigrationNames("hello", "CREATE VIEW IF NOT EXISTS ext_hello_v AS SELECT 1;"),
  );
  assert.throws(
    () =>
      assertMigrationNames(
        "hello",
        "CREATE TRIGGER plain_trg AFTER INSERT ON ext_hello_t BEGIN SELECT 1; END;",
      ),
    (e: unknown) =>
      e instanceof PluginError &&
      (e as Error).message.includes("plain_trg") &&
      (e as Error).message.includes("object must be prefixed with ext_hello_"),
  );
  assert.doesNotThrow(() =>
    assertMigrationNames(
      "hello",
      "CREATE TRIGGER IF NOT EXISTS ext_hello_trg AFTER INSERT ON ext_hello_t BEGIN SELECT 1; END;",
    ),
  );
});

test("assertMigrationNames: VIRTUAL TABLE and TEMP covered", () => {
  assert.doesNotThrow(() =>
    assertMigrationNames("hello", "CREATE VIRTUAL TABLE ext_hello_fts USING fts5(content);"),
  );
  assert.throws(
    () => assertMigrationNames("hello", "CREATE VIRTUAL TABLE plain_fts USING fts5(content);"),
    PluginError,
  );
  assert.doesNotThrow(() =>
    assertMigrationNames("hello", "CREATE TEMP TABLE ext_hello_tmp (id INTEGER);"),
  );
});
