import { test } from "node:test";
import assert from "node:assert/strict";

import { canView } from "../src/visibility/index.ts";

// The real `Database` from db.ts is a better-sqlite3 instance; importing it would
// require a live DB file. For the pure visibility rule we drive it through a
// minimal stand-in exposing the same `.prepare().get()` contract the module uses.
type StubDb = { prepare: (sql: string) => { get: (...args: unknown[]) => unknown } };

function noMemberDb(): StubDb {
  return { prepare: () => ({ get: () => undefined }) };
}

function teamDb(username: string): StubDb {
  return {
    prepare: (sql: string) => ({
      get: (...args: unknown[]) =>
        sql.includes("team_members") && args[0] === username && args[1] === "my-team"
          ? { n: 1 }
          : undefined,
    }),
  };
}

const org = { id: "a1", visibility: "org" as const, owner_team: null, owner: "bob" };
const team = { id: "a2", visibility: "team" as const, owner_team: "my-team", owner: "bob" };

test("org artifact is visible to everyone, even anonymous", () => {
  assert.equal(canView(noMemberDb(), null, org), true);
  assert.equal(canView(noMemberDb(), { username: "x", role: "viewer" }, org), true);
});

test("team artifact is never visible to anonymous", () => {
  assert.equal(canView(noMemberDb(), null, team), false);
});

test("team artifact is visible to admin and reviewer+", () => {
  assert.equal(canView(noMemberDb(), { username: "x", role: "admin" }, team), true);
  assert.equal(canView(noMemberDb(), { username: "x", role: "reviewer" }, team), true);
});

test("team artifact is visible to its owner", () => {
  assert.equal(canView(noMemberDb(), { username: "bob", role: "viewer" }, team), true);
});

test("team artifact is visible to a member of owner_team", () => {
  assert.equal(canView(teamDb("alice"), { username: "alice", role: "viewer" }, team), true);
});

test("team artifact is hidden from a non-member viewer", () => {
  assert.equal(canView(noMemberDb(), { username: "carol", role: "viewer" }, team), false);
});
