import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, migrate } from "../src/db.ts";
import { preparePublish, publishArtifact } from "../src/publish.ts";
import { getArtifactByTypeName, listVersions, rowToSummary } from "../src/repo.ts";

function b64(s: string) {
  return Buffer.from(s, "utf8").toString("base64");
}

const skillMd =
  "---\nname: demo-skill\ndescription: A demo skill for tests.\n---\n\n# Demo\n\nDo things.\n";

function withCtx(fn: (ctx: { db: ReturnType<typeof openDatabase>; dataDir: string }) => void) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-pub-"));
  const db = openDatabase(dataDir);
  try {
    migrate(db);
    fn({ db, dataDir });
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

function countBlobs(dataDir: string): number {
  const blobs = path.join(dataDir, "blobs");
  if (!fs.existsSync(blobs)) return 0;
  let n = 0;
  const walk = (d: string) => {
    for (const name of fs.readdirSync(d)) {
      const pth = path.join(d, name);
      if (fs.statSync(pth).isDirectory()) walk(pth);
      else n++;
    }
  };
  walk(blobs);
  return n;
}

test("publish: first 0.1.0, patch auto, digest_exists, version_exists, validation_failed", () => {
  withCtx((ctx) => {
    const files = [{ path: "SKILL.md", content_base64: b64(skillMd) }];
    const first = publishArtifact({ ...ctx, actor: "alice" }, { type: "skill", files });
    assert.equal(first.kind, "created");
    if (first.kind !== "created") return;
    assert.equal(first.version.version, "0.1.0");
    assert.equal(first.artifact.status, "candidate");
    assert.equal(first.version.published_by, "alice");

    const same = publishArtifact({ ...ctx, actor: "alice" }, { type: "skill", files });
    assert.equal(same.kind, "digest_exists");

    const v2body =
      "---\nname: demo-skill\ndescription: A demo skill for tests.\n---\n\n# Demo\n\nDo things.\n\nExtra.\n";
    const patch = publishArtifact(
      { ...ctx, actor: "alice" },
      { type: "skill", files: [{ path: "SKILL.md", content_base64: b64(v2body) }] },
    );
    assert.equal(patch.kind, "created");
    if (patch.kind !== "created") return;
    assert.equal(patch.version.version, "0.1.1");

    const v3body =
      "---\nname: demo-skill\ndescription: A demo skill for tests.\n---\n\n# Demo\n\nDo things.\n\nExtra.\nMore.\n";
    const exists = publishArtifact(
      { ...ctx, actor: "alice" },
      {
        type: "skill",
        version: "0.1.1",
        files: [{ path: "SKILL.md", content_base64: b64(v3body) }],
      },
    );
    assert.equal(exists.kind, "version_exists");

    const bad = publishArtifact(
      { ...ctx, actor: "alice" },
      {
        type: "skill",
        files: [
          {
            path: "SKILL.md",
            content_base64: b64("---\nname: Bad_Name\ndescription: X.\n---\n\nBody.\n"),
          },
        ],
      },
    );
    assert.equal(bad.kind, "validation_failed");
    if (bad.kind !== "validation_failed") return;
    assert.ok(bad.errors.some((e) => e.code === "E_NAME_INVALID"));

    const row = getArtifactByTypeName(ctx.db, "skill", "demo-skill")!;
    assert.equal(rowToSummary(ctx.db, row).versions_count, 2);
    assert.equal(listVersions(ctx.db, row.id).length, 2);

    const noFiles = publishArtifact({ ...ctx, actor: "alice" }, { type: "skill" });
    assert.equal(noFiles.kind, "bad_request");

    const badVer = publishArtifact(
      { ...ctx, actor: "alice" },
      { type: "skill", version: "v1.0", files },
    );
    assert.equal(badVer.kind, "version_invalid");

    const badProv = publishArtifact(
      { ...ctx, actor: "alice" },
      {
        type: "command",
        description: "x",
        provenance: { source: "vibes", ref: null },
        files: [{ path: "x.md", content_base64: b64("Do x.\n") }],
      },
    );
    assert.equal(badProv.kind, "provenance_invalid");
  });
});

test("preparePublish: does not write blobs or rows", () => {
  withCtx((ctx) => {
    const files = [{ path: "SKILL.md", content_base64: b64(skillMd) }];
    const beforeBlobs = countBlobs(ctx.dataDir);
    const prepared = preparePublish(ctx.db, { type: "skill", files });
    assert.equal(prepared.kind, "prepared");
    if (prepared.kind !== "prepared") return;
    assert.equal(prepared.ok, true);
    assert.equal(prepared.artifact?.name, "demo-skill");
    assert.equal(prepared.next_version, "0.1.0");
    assert.deepEqual(prepared.conflicts, []);
    assert.equal(countBlobs(ctx.dataDir), beforeBlobs);
    assert.equal(getArtifactByTypeName(ctx.db, "skill", "demo-skill"), undefined);
  });
});
