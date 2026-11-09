import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  LockError,
  lockPathFor,
  readLock,
  safeLockPaths,
  sha256Hex,
  writeLock,
} from "../src/lock.ts";

test("lock atomic write and sha256", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-lock-"));
  const into = path.join(dir, ".claude");
  fs.mkdirSync(into, { recursive: true });
  writeLock(into, {
    registry: "http://127.0.0.1:8787",
    artifacts: {
      "skill/demo": {
        version: "1.0.0",
        digest: "a".repeat(64),
        files: { "skills/demo/SKILL.md": sha256Hex("hello") },
        installed_at: new Date().toISOString(),
      },
    },
  });
  assert.ok(fs.existsSync(lockPathFor(into)));
  const loaded = readLock(into);
  assert.equal(loaded.registry, "http://127.0.0.1:8787");
  assert.equal(loaded.artifacts["skill/demo"]?.version, "1.0.0");
  assert.equal(loaded.artifacts["skill/demo"]?.files["skills/demo/SKILL.md"], sha256Hex("hello"));
  // no temp leftovers
  const leftovers = fs.readdirSync(into).filter((n) => n.includes(".tmp."));
  assert.deepEqual(leftovers, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("safeLockPaths rejects traversal and absolute paths", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-lock-"));
  const into = path.join(dir, ".claude");
  fs.mkdirSync(into, { recursive: true });
  const base = {
    version: "1.0.0",
    digest: "0".repeat(64),
    installed_at: "2026-09-18T00:00:00.000Z",
  };

  const ok = safeLockPaths({ ...base, files: { "skills/demo/SKILL.md": "aa" } }, into);
  assert.equal(ok.length, 1);
  assert.ok(ok[0]!.startsWith(path.resolve(into)));

  for (const bad of ["../victim.txt", "C:/victim.txt", "/etc/passwd", "skills\\..\\victim.txt"]) {
    assert.throws(
      () => safeLockPaths({ ...base, files: { [bad]: "00" } }, into),
      (err: unknown) => {
        assert.ok(err instanceof LockError);
        assert.match(err.message, /corrupt lock file/);
        assert.match(err.message, /unsafe path/);
        assert.ok(err.message.includes(bad));
        return true;
      },
    );
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
