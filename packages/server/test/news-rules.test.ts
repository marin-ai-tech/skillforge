// news/rules.ts: the decisions of the spec, each positive case next to its negative one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isNewsKind, transitionNewsKind, versionNewsKind } from "../src/news/rules.ts";

test("first time active is a new artifact; back to active is a status change", () => {
  assert.equal(
    transitionNewsKind({ from: "candidate", to: "active", wasActiveBefore: false }),
    "new_artifact",
  );
  assert.equal(
    transitionNewsKind({ from: "aging", to: "active", wasActiveBefore: false }),
    "status_change",
  );
  assert.equal(
    transitionNewsKind({ from: "zombie", to: "active", wasActiveBefore: false }),
    "status_change",
  );
  // re-activation through candidate after retired
  assert.equal(
    transitionNewsKind({ from: "candidate", to: "active", wasActiveBefore: true }),
    "status_change",
  );
});

test("zombie and retired are news; aging and events of a candidate are not", () => {
  assert.equal(
    transitionNewsKind({ from: "active", to: "zombie", wasActiveBefore: true }),
    "status_change",
  );
  assert.equal(
    transitionNewsKind({ from: "aging", to: "retired", wasActiveBefore: true }),
    "status_change",
  );
  assert.equal(transitionNewsKind({ from: "active", to: "aging", wasActiveBefore: true }), null);
  assert.equal(
    transitionNewsKind({ from: "candidate", to: "retired", wasActiveBefore: false }),
    null,
  );
  assert.equal(
    transitionNewsKind({ from: "retired", to: "candidate", wasActiveBefore: true }),
    null,
  );
});

test("a stable version is news unless it is the first stable one, beta, or of a candidate or retired artifact", () => {
  assert.equal(
    versionNewsKind({ channel: "stable", status: "active", hadStableBefore: true }),
    "new_version",
  );
  assert.equal(
    versionNewsKind({ channel: "stable", status: "zombie", hadStableBefore: true }),
    "new_version",
  );
  assert.equal(
    versionNewsKind({ channel: "stable", status: "active", hadStableBefore: false }),
    null,
  );
  assert.equal(versionNewsKind({ channel: "beta", status: "active", hadStableBefore: true }), null);
  assert.equal(
    versionNewsKind({ channel: "stable", status: "candidate", hadStableBefore: true }),
    null,
  );
  assert.equal(
    versionNewsKind({ channel: "stable", status: "retired", hadStableBefore: true }),
    null,
  );
});

test("the kind list is checked in code", () => {
  for (const k of ["new_artifact", "new_version", "status_change", "post"])
    assert.ok(isNewsKind(k), k);
  for (const k of ["announcement", "", null, 1]) assert.equal(isNewsKind(k), false);
});
