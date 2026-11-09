import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STATUSES,
  TRANSITIONS,
  canTransition,
  allowedTransitions,
} from "../src/lifecycle/machine.ts";

test("STATUSES and TRANSITIONS match the lifecycle contract", () => {
  assert.deepEqual([...STATUSES], ["candidate", "active", "aging", "zombie", "retired"]);
  assert.deepEqual([...TRANSITIONS.candidate], ["active", "retired"]);
  assert.deepEqual([...TRANSITIONS.active], ["aging", "zombie", "retired"]);
  assert.deepEqual([...TRANSITIONS.aging], ["active", "zombie", "retired"]);
  assert.deepEqual([...TRANSITIONS.zombie], ["active", "retired"]);
  assert.deepEqual([...TRANSITIONS.retired], ["candidate"]);
});

test("canTransition allows only listed edges", () => {
  assert.equal(canTransition("candidate", "active"), true);
  assert.equal(canTransition("candidate", "aging"), false);
  assert.equal(canTransition("active", "active"), false);
  assert.equal(canTransition("retired", "candidate"), true);
  assert.equal(canTransition("active", "archived"), false);
  assert.equal(canTransition("nope", "active"), false);
});

test("allowedTransitions empty for non-reviewer roles", () => {
  assert.deepEqual(allowedTransitions("candidate", null), []);
  assert.deepEqual(allowedTransitions("candidate", "viewer"), []);
  assert.deepEqual(allowedTransitions("candidate", "contributor"), []);
  assert.deepEqual(allowedTransitions("candidate", "reviewer").sort(), ["active", "retired"]);
  assert.deepEqual(allowedTransitions("active", "admin").sort(), ["aging", "retired", "zombie"]);
});
