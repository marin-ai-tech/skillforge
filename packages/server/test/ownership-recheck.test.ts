// #46 (change fix-second-process-consistency): owner/maintainer management re-checks rights
// against the artifact row re-read inside BEGIN IMMEDIATE. A second process is simulated by
// committing an owner change through a separate SQLite connection right before the route's
// BEGIN IMMEDIATE acquires the write lock (the window a second server process could hit).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { withApp, loginCookie } from "./helpers.ts";
import { openDatabase, migrate } from "../src/db.ts";
import { createArtifact } from "../src/repo.ts";
import { recheckManageRight } from "../src/ownership.ts";

type App = Parameters<Parameters<typeof withApp>[0]>[0];

const skillMd =
  "---\nname: race-skill\ndescription: Ownership race probe skill.\n---\n\n# Race\n\nBody.\n";

async function addUser(app: App, adminCookie: string, username: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/admin/users",
    headers: { cookie: adminCookie },
    payload: { username, password: `${username}-pw-1234`, role: "contributor" },
  });
  assert.equal(res.statusCode, 201, res.body);
  return loginCookie(app, username, `${username}-pw-1234`);
}

/** Arms a one-shot "second process" write that commits just before the next BEGIN IMMEDIATE. */
function armSecondProcess(dataDir: string, sql: string, ...args: string[]): () => void {
  const original = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function (this: DatabaseSync, query: string) {
    if (query === "BEGIN IMMEDIATE") {
      DatabaseSync.prototype.exec = original;
      const other = new DatabaseSync(path.join(dataDir, "skillforge.db"));
      try {
        other.prepare(sql).run(...args);
      } finally {
        other.close();
      }
    }
    return original.call(this, query);
  };
  return () => {
    DatabaseSync.prototype.exec = original;
  };
}

function ownerOf(dataDir: string): string {
  const db = new DatabaseSync(path.join(dataDir, "skillforge.db"), { readOnly: true });
  try {
    return (
      db.prepare("SELECT owner FROM artifacts WHERE name = 'race-skill'").get() as {
        owner: string;
      }
    ).owner;
  } finally {
    db.close();
  }
}

function count(dataDir: string, sql: string): number {
  const db = new DatabaseSync(path.join(dataDir, "skillforge.db"), { readOnly: true });
  try {
    return Number((db.prepare(sql).get() as { n: number | bigint }).n);
  } finally {
    db.close();
  }
}

const STEAL = "UPDATE artifacts SET owner = ? WHERE name = 'race-skill'";

test("ownership: owner change committed before BEGIN IMMEDIATE -> 409 owner_changed, nothing written", async () => {
  await withApp(async (app, dataDir) => {
    const admin = await loginCookie(app);
    const alice = await addUser(app, admin, "alice");
    await addUser(app, admin, "bob");
    const carol = await addUser(app, admin, "carol");
    const pub = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: { "content-type": "application/json", cookie: alice },
      payload: {
        type: "skill",
        files: [{ path: "SKILL.md", content_base64: Buffer.from(skillMd).toString("base64") }],
      },
    });
    assert.equal(pub.statusCode, 201, pub.body);
    assert.equal(ownerOf(dataDir), "alice");

    // POST /owner: alice passes the pre-transaction check, carol becomes owner in between.
    let disarm = armSecondProcess(dataDir, STEAL, "carol");
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/artifacts/skill/race-skill/owner",
        headers: { cookie: alice },
        payload: { owner: "bob", reason: "handover" },
      });
      assert.equal(r.statusCode, 409, r.body);
      assert.equal(r.json().error, "owner_changed");
    } finally {
      disarm();
    }
    assert.equal(ownerOf(dataDir), "carol", "stale transfer must not overwrite the new owner");
    assert.equal(
      count(dataDir, "SELECT COUNT(*) AS n FROM audit_events WHERE action = 'owner_transfer'"),
      0,
    );

    // POST /maintainers: carol (owner now) is pre-checked, then ownership moves back to alice.
    disarm = armSecondProcess(dataDir, STEAL, "alice");
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/artifacts/skill/race-skill/maintainers",
        headers: { cookie: carol },
        payload: { username: "bob" },
      });
      assert.equal(r.statusCode, 409, r.body);
      assert.equal(r.json().error, "owner_changed");
    } finally {
      disarm();
    }
    assert.equal(count(dataDir, "SELECT COUNT(*) AS n FROM artifact_maintainers"), 0);
    assert.equal(
      count(dataDir, "SELECT COUNT(*) AS n FROM audit_events WHERE action = 'maintainer_add'"),
      0,
    );

    // Without a race the owner works as before.
    const add = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts/skill/race-skill/maintainers",
      headers: { cookie: alice },
      payload: { username: "bob" },
    });
    assert.equal(add.statusCode, 200, add.body);

    // DELETE /maintainers/:username: alice pre-checked, carol becomes owner in between.
    disarm = armSecondProcess(dataDir, STEAL, "carol");
    try {
      const r = await app.inject({
        method: "DELETE",
        url: "/api/v1/artifacts/skill/race-skill/maintainers/bob",
        headers: { cookie: alice },
      });
      assert.equal(r.statusCode, 409, r.body);
      assert.equal(r.json().error, "owner_changed");
    } finally {
      disarm();
    }
    assert.equal(count(dataDir, "SELECT COUNT(*) AS n FROM artifact_maintainers"), 1);

    // A non-owner is still rejected with the usual 403.
    const denied = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts/skill/race-skill/maintainers",
      headers: { cookie: alice },
      payload: { username: "bob" },
    });
    assert.equal(denied.statusCode, 403, denied.body);
  });
});

test("recheckManageRight: decides by the row read now, not by the caller's earlier read", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-recheck-"));
  const db = openDatabase(dataDir);
  try {
    migrate(db);
    createArtifact(db, {
      id: "art-r",
      type: "skill",
      name: "recheck",
      description: "d",
      display_name: null,
      tags: [],
      created_by: "alice",
      latest_version: "0.1.0",
      now: new Date().toISOString(),
    });
    const owner = (
      db.prepare("SELECT owner FROM artifacts WHERE id = 'art-r'").get() as {
        owner: string;
      }
    ).owner;
    const alice = { username: owner, role: "contributor" as const };
    const admin = { username: "root", role: "admin" as const };
    const mallory = { username: "mallory", role: "contributor" as const };
    assert.deepEqual(recheckManageRight(db, "art-r", owner, alice), { ok: true, owner });
    assert.deepEqual(recheckManageRight(db, "art-r", owner, admin), { ok: true, owner });
    assert.equal(recheckManageRight(db, "art-r", owner, mallory).ok, false);
    assert.deepEqual(recheckManageRight(db, "art-r", owner, mallory), {
      ok: false,
      status: 403,
      error: "forbidden",
    });
    db.prepare("UPDATE artifacts SET owner = 'zed' WHERE id = 'art-r'").run();
    for (const user of [alice, admin]) {
      assert.deepEqual(recheckManageRight(db, "art-r", owner, user), {
        ok: false,
        status: 409,
        error: "owner_changed",
      });
    }
    assert.deepEqual(recheckManageRight(db, "missing", owner, admin), {
      ok: false,
      status: 404,
      error: "not_found",
    });
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
