// The Source panel's note names the channel a version is in now, not the one it was published to by the check.
import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceVersionChannel } from "../src/lib/source-channel.ts";

const versions = [
  { version: "2.2.0", channel: "beta" as const, purged: false },
  { version: "2.1.0", channel: "stable" as const, purged: false },
  { version: "2.0.0", channel: "stable" as const, purged: true },
  { version: "1.9.0", channel: "beta" as const, purged: true },
  { version: "1.8.0", channel: "beta" as const },
];

test("a version still in beta is beta", () => {
  assert.equal(sourceVersionChannel("2.2.0", versions), "beta");
  assert.equal(sourceVersionChannel("1.8.0", versions), "beta");
});

test("a version moved to stable is stable", () => {
  assert.equal(sourceVersionChannel("2.1.0", versions), "stable");
});

test("a purged version is deleted, whatever its channel was", () => {
  assert.equal(sourceVersionChannel("2.0.0", versions), "deleted");
  assert.equal(sourceVersionChannel("1.9.0", versions), "deleted");
});

test("a version the list does not have is null", () => {
  assert.equal(sourceVersionChannel("9.9.9", versions), null);
  assert.equal(sourceVersionChannel("2.1.0", []), null);
});
