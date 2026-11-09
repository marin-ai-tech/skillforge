import { test } from "node:test";
import assert from "node:assert/strict";

import { isTeamName, isTeamRole } from "../src/teams.ts";

test("isTeamName accepts kebab-case names up to 40 chars", () => {
  assert.equal(isTeamName("alpha"), true);
  assert.equal(isTeamName("alpha-2-beta"), true);
  assert.equal(isTeamName("a".repeat(40)), true);
});

test("isTeamName rejects non-kebab names", () => {
  assert.equal(isTeamName(""), false);
  assert.equal(isTeamName("Alpha"), false);
  assert.equal(isTeamName("alpha_2"), false);
  assert.equal(isTeamName("alpha--beta"), false);
  assert.equal(isTeamName("-alpha"), false);
  assert.equal(isTeamName("alpha-"), false);
  assert.equal(isTeamName("a".repeat(41)), false);
});

test("isTeamRole accepts only member and lead", () => {
  assert.equal(isTeamRole("member"), true);
  assert.equal(isTeamRole("lead"), true);
  assert.equal(isTeamRole("admin"), false);
  assert.equal(isTeamRole(""), false);
});
