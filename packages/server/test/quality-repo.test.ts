import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, migrate } from "../src/db.ts";
import {
  createArtifact,
  getVersion,
  insertVersion,
  listArtifacts,
  rowToSummary,
  getArtifactByTypeName,
} from "../src/repo.ts";

test("repo: insertVersion without quality stores NULL and reads back quality null", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-quality-repo-"));
  const db = openDatabase(dataDir);
  try {
    migrate(db);
    const now = new Date().toISOString();
    createArtifact(db, {
      id: "art-q",
      type: "skill",
      name: "no-quality",
      description: "Legacy caller without quality",
      display_name: null,
      tags: [],
      created_by: "alice",
      latest_version: "1.0.0",
      now,
    });
    const detail = insertVersion(db, {
      id: "ver-q",
      artifact_id: "art-q",
      version: "1.0.0",
      digest: "a".repeat(64),
      description: "Legacy caller without quality",
      display_name: null,
      tags: [],
      frontmatter: null,
      files: [{ path: "skills/no-quality/SKILL.md", sha256: "b".repeat(64), size: 10 }],
      warnings: [],
      changelog: null,
      model_compat: [],
      provenance: { source: "human", ref: null },
      evidence: [],
      published_by: "alice",
      published_at: now,
    });
    assert.equal(detail.quality, null);
    assert.equal(getVersion(db, "art-q", "1.0.0")?.quality, null);

    const row = getArtifactByTypeName(db, "skill", "no-quality");
    assert.ok(row);
    assert.equal(rowToSummary(db, row).quality, null);
    const listed = listArtifacts(db, { type: "skill", limit: 10, offset: 0 });
    assert.equal(listed.items[0]?.quality, null);
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
