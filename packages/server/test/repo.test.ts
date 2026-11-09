import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, migrate } from "../src/db.ts";
import {
  appendAudit,
  createArtifact,
  getArtifactByTypeName,
  getVersion,
  hasDigest,
  hasVersion,
  insertVersion,
  listArtifacts,
  listAudit,
  listVersions,
  maxSemver,
  rowToSummary,
  updateArtifactOnPublish,
} from "../src/repo.ts";

function withDb(fn: (db: ReturnType<typeof openDatabase>, dataDir: string) => void) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-repo-"));
  const db = openDatabase(dataDir);
  try {
    migrate(db);
    fn(db, dataDir);
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

test("repo: create artifact, two versions, latest by semver, list filters, audit", () => {
  withDb((db) => {
    const now = new Date().toISOString();
    const a = createArtifact(db, {
      id: "art-1",
      type: "skill",
      name: "pdf-tools",
      description: "PDF tools",
      display_name: null,
      tags: ["pdf", "docs"],
      created_by: "alice",
      latest_version: "0.1.0",
      now,
    });
    assert.equal(a.name, "pdf-tools");

    insertVersion(db, {
      id: "ver-1",
      artifact_id: "art-1",
      version: "0.1.0",
      digest: "a".repeat(64),
      description: "PDF tools",
      display_name: null,
      tags: ["pdf", "docs"],
      frontmatter: { name: "pdf-tools" },
      files: [{ path: "skills/pdf-tools/SKILL.md", sha256: "b".repeat(64), size: 10 }],
      warnings: [],
      changelog: null,
      model_compat: [],
      provenance: { source: "human", ref: null },
      evidence: [],
      published_by: "alice",
      published_at: now,
    });

    insertVersion(db, {
      id: "ver-2",
      artifact_id: "art-1",
      version: "0.2.0",
      digest: "c".repeat(64),
      description: "PDF tools v2",
      display_name: null,
      tags: ["pdf"],
      frontmatter: { name: "pdf-tools" },
      files: [{ path: "skills/pdf-tools/SKILL.md", sha256: "d".repeat(64), size: 12 }],
      warnings: [],
      changelog: "bump",
      model_compat: ["opus"],
      provenance: { source: "reckon", ref: "run-1" },
      evidence: [],
      published_by: "alice",
      published_at: now,
    });

    updateArtifactOnPublish(db, "art-1", {
      description: "PDF tools v2",
      display_name: null,
      tags: ["pdf"],
      latest_version: maxSemver(["0.1.0", "0.2.0"])!,
      now,
    });

    const row = getArtifactByTypeName(db, "skill", "pdf-tools")!;
    const summary = rowToSummary(db, row);
    assert.equal(summary.latest_version, "0.2.0");
    assert.equal(summary.versions_count, 2);

    assert.ok(hasVersion(db, "art-1", "0.1.0"));
    assert.ok(hasDigest(db, "art-1", "a".repeat(64)));
    assert.throws(() => {
      insertVersion(db, {
        id: "ver-dup",
        artifact_id: "art-1",
        version: "0.1.0",
        digest: "e".repeat(64),
        description: "x",
        display_name: null,
        tags: [],
        frontmatter: null,
        files: [],
        warnings: [],
        changelog: null,
        model_compat: [],
        provenance: { source: "human", ref: null },
        evidence: [],
        published_by: "alice",
        published_at: now,
      });
    });

    const versions = listVersions(db, "art-1");
    assert.deepEqual(
      versions.map((v) => v.version),
      ["0.2.0", "0.1.0"],
    );
    assert.equal(getVersion(db, "art-1", "0.2.0")?.changelog, "bump");

    createArtifact(db, {
      id: "art-2",
      type: "hook",
      name: "guard",
      description: "Asks for confirmation before destructive tools",
      display_name: null,
      tags: ["safety"],
      created_by: "bob",
      latest_version: "0.1.0",
      now,
    });

    const byType = listArtifacts(db, { type: "hook", limit: 50, offset: 0 });
    assert.equal(byType.total, 1);
    assert.equal(byType.items[0]!.name, "guard");

    const byTag = listArtifacts(db, { tag: "pdf", limit: 50, offset: 0 });
    assert.ok(byTag.items.some((i) => i.name === "pdf-tools"));

    const byQ = listArtifacts(db, { q: "PDF", limit: 50, offset: 0 });
    assert.ok(byQ.items.some((i) => i.name === "pdf-tools"));

    const page = listArtifacts(db, { limit: 1, offset: 0 });
    assert.equal(page.items.length, 1);
    assert.equal(page.total, 2);

    appendAudit(db, {
      ts: now,
      actor: "alice",
      artifact_id: "art-1",
      version: "0.2.0",
      action: "publish",
      meta: { digest: "c".repeat(64) },
    });
    appendAudit(db, {
      ts: new Date(Date.now() - 1000).toISOString(),
      actor: "alice",
      artifact_id: "art-1",
      version: "0.1.0",
      action: "publish",
      meta: { digest: "a".repeat(64) },
    });
    const audit = listAudit(db, "art-1");
    assert.equal(audit.length, 2);
    assert.equal(audit[0]!.version, "0.2.0");
    assert.equal(audit[1]!.version, "0.1.0");
  });
});

test("repo: LIKE metacharacters in q are literal; versions_count from list", () => {
  withDb((db) => {
    const now = new Date().toISOString();
    createArtifact(db, {
      id: "art-1",
      type: "skill",
      name: "pdf-tools",
      description: "PDF tools",
      display_name: null,
      tags: ["pdf"],
      created_by: "alice",
      latest_version: "0.1.0",
      now,
    });
    insertVersion(db, {
      id: "ver-1",
      artifact_id: "art-1",
      version: "0.1.0",
      digest: "a".repeat(64),
      description: "PDF tools",
      display_name: null,
      tags: ["pdf"],
      frontmatter: null,
      files: [],
      warnings: [],
      changelog: null,
      model_compat: [],
      provenance: { source: "human", ref: null },
      evidence: [],
      published_by: "alice",
      published_at: now,
    });
    insertVersion(db, {
      id: "ver-2",
      artifact_id: "art-1",
      version: "0.2.0",
      digest: "c".repeat(64),
      description: "PDF tools v2",
      display_name: null,
      tags: ["pdf"],
      frontmatter: null,
      files: [],
      warnings: [],
      changelog: null,
      model_compat: [],
      provenance: { source: "human", ref: null },
      evidence: [],
      published_by: "alice",
      published_at: now,
    });

    const byPercent = listArtifacts(db, { q: "%", limit: 50, offset: 0 });
    assert.equal(byPercent.total, 0);

    const byUnderscoreName = listArtifacts(db, { q: "pdf_tools", limit: 50, offset: 0 });
    assert.equal(byUnderscoreName.total, 0);

    const listed = listArtifacts(db, { q: "pdf-tools", limit: 50, offset: 0 });
    assert.equal(listed.total, 1);
    assert.equal(listed.items[0]!.versions_count, 2);
  });
});
