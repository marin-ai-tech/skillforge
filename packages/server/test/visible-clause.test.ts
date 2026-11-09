import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, migrate } from "../src/db.ts";
import { canView, type Viewer } from "../src/visibility/index.ts";
import { visibleClause } from "../src/visibility/sql.ts";
import { createUser } from "../src/auth/users.ts";

function tmpDb() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-vis-"));
  const db = openDatabase(dataDir);
  migrate(db);
  return { db, dataDir };
}

function sqlVisible(
  db: ReturnType<typeof openDatabase>,
  viewer: Viewer,
  artifactId: string,
): boolean {
  const vis = visibleClause(viewer, "artifacts");
  const row = db
    .prepare(`SELECT 1 AS n FROM artifacts WHERE id = ? AND ${vis.sql}`)
    .get(artifactId, ...vis.params);
  return row !== undefined;
}

test("visibleClause equivalent to canView across roles and membership", () => {
  const { db, dataDir } = tmpDb();
  try {
    const now = new Date().toISOString();
    createUser(db, { username: "bob", password: "pw-bob-123", role: "contributor" });
    createUser(db, { username: "alice", password: "pw-alice-12", role: "viewer" });
    createUser(db, { username: "carol", password: "pw-carol-12", role: "viewer" });
    createUser(db, { username: "rita", password: "pw-rita-123", role: "reviewer" });
    createUser(db, { username: "ada", password: "pw-ada-1234", role: "admin" });
    createUser(db, { username: "moe", password: "pw-moe-1234", role: "contributor" });

    db.prepare(
      `INSERT INTO teams (id, name, display_name, description, created_by, created_at)` +
        ` VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("t1", "my-team", "My Team", null, "bob", now);
    db.prepare(
      `INSERT INTO team_members (team_id, username, role, added_by, added_at) VALUES (?, ?, ?, ?, ?)`,
    ).run("t1", "alice", "member", "bob", now);

    db.prepare(
      `INSERT INTO artifacts (id, type, name, description, display_name, tags, labels, status,` +
        ` visibility, owner_team, owner, latest_version, download_count, created_by, created_at, updated_at)` +
        ` VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "org1",
      "skill",
      "org-skill",
      "d",
      null,
      "[]",
      "[]",
      "active",
      "org",
      null,
      "bob",
      "0.1.0",
      0,
      "bob",
      now,
      now,
    );
    db.prepare(
      `INSERT INTO artifacts (id, type, name, description, display_name, tags, labels, status,` +
        ` visibility, owner_team, owner, latest_version, download_count, created_by, created_at, updated_at)` +
        ` VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "team1",
      "skill",
      "team-skill",
      "d",
      null,
      "[]",
      "[]",
      "active",
      "team",
      "my-team",
      "bob",
      "0.1.0",
      0,
      "bob",
      now,
      now,
    );
    db.prepare(
      `INSERT INTO artifact_maintainers (artifact_id, username, added_by, added_at) VALUES (?, ?, ?, ?)`,
    ).run("team1", "moe", "bob", now);

    db.prepare(
      `INSERT INTO artifacts (id, type, name, description, display_name, tags, labels, status,` +
        ` visibility, owner_team, owner, latest_version, download_count, created_by, created_at, updated_at)` +
        ` VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "team2",
      "skill",
      "team-sib",
      "d",
      null,
      "[]",
      "[]",
      "active",
      "team",
      "my-team",
      "bob",
      "0.1.0",
      0,
      "bob",
      now,
      now,
    );

    const org = db.prepare("SELECT * FROM artifacts WHERE id = ?").get("org1") as Parameters<
      typeof canView
    >[2];
    const team = db.prepare("SELECT * FROM artifacts WHERE id = ?").get("team1") as Parameters<
      typeof canView
    >[2];
    const teamSib = db.prepare("SELECT * FROM artifacts WHERE id = ?").get("team2") as Parameters<
      typeof canView
    >[2];

    const viewers: Viewer[] = [
      null,
      { username: "carol", role: "viewer" },
      { username: "alice", role: "viewer" },
      { username: "bob", role: "contributor" },
      { username: "moe", role: "contributor" },
      { username: "rita", role: "reviewer" },
      { username: "ada", role: "admin" },
    ];

    for (const artifact of [org, team, teamSib]) {
      for (const viewer of viewers) {
        const expected = canView(db, viewer, artifact);
        const got = sqlVisible(db, viewer, artifact.id);
        assert.equal(
          got,
          expected,
          `mismatch viewer=${viewer ? viewer.username + "/" + viewer.role : "anon"} art=${artifact.name} canView=${expected} sql=${got}`,
        );
      }
    }

    // Co-author of artifact X must NOT see sibling team artifact Y of the same team.
    const moe: Viewer = { username: "moe", role: "contributor" };
    assert.equal(canView(db, moe, team), true, "moe maintains team1");
    assert.equal(sqlVisible(db, moe, "team1"), true, "sql: moe sees team1");
    assert.equal(canView(db, moe, teamSib), false, "moe must not see sibling team2");
    assert.equal(sqlVisible(db, moe, "team2"), false, "sql: moe must not see team2");
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
