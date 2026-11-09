import { test } from "node:test";
import assert from "node:assert/strict";
import { withApp, loginCookie, TEST_ADMIN_PASSWORD } from "./helpers.ts";
import { transitionArtifact, validateVersion } from "../src/lifecycle/transitions.ts";
import { runAgingSweep } from "../src/lifecycle/sweep.ts";
import { getLifecycleBoard } from "../src/lifecycle/board.ts";
import { openDatabase, migrate } from "../src/db.ts";
import { createArtifact, insertVersion, getArtifactByTypeName } from "../src/repo.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function seedArtifact(db: ReturnType<typeof openDatabase>, name = "demo") {
  const now = new Date().toISOString();
  const art = createArtifact(db, {
    id: "a1",
    type: "skill",
    name,
    description: "d",
    display_name: null,
    tags: [],
    created_by: "admin",
    latest_version: "0.1.0",
    now,
  });
  insertVersion(db, {
    id: "v1",
    artifact_id: art.id,
    version: "0.1.0",
    digest: "d" + name,
    description: "d",
    display_name: null,
    tags: [],
    frontmatter: null,
    files: [],
    warnings: [],
    changelog: null,
    model_compat: [],
    provenance: { source: "human", ref: null },
    evidence: [],
    published_by: "admin",
    published_at: now,
  });
  return art;
}

test("transition: happy path, race 409, reason_required, revalidate", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-lc-"));
  const db = openDatabase(dataDir);
  migrate(db);
  try {
    seedArtifact(db);
    const ok = transitionArtifact(db, {
      type: "skill",
      name: "demo",
      to: "active",
      reason: "ok",
      actor: "rita",
      actorRole: "reviewer",
    });
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    assert.equal(ok.artifact.status, "active");
    assert.equal(ok.event.action, "transition");
    assert.equal(ok.event.from_status, "candidate");
    assert.equal(ok.event.actor, "rita");

    const bad = transitionArtifact(db, {
      type: "skill",
      name: "demo",
      to: "active",
      actor: "rita",
      actorRole: "reviewer",
    });
    assert.equal(bad.ok, false);
    if (bad.ok) return;
    assert.equal(bad.status, 409);
    assert.equal(bad.body.error, "invalid_transition");

    const noReason = transitionArtifact(db, {
      type: "skill",
      name: "demo",
      to: "retired",
      actor: "rita",
      actorRole: "reviewer",
    });
    assert.equal(noReason.ok, false);
    if (noReason.ok) return;
    assert.equal(noReason.body.error, "reason_required");

    transitionArtifact(db, {
      type: "skill",
      name: "demo",
      to: "aging",
      actor: "rita",
      actorRole: "reviewer",
    });
    const re = transitionArtifact(db, {
      type: "skill",
      name: "demo",
      to: "active",
      actor: "rita",
      actorRole: "reviewer",
    });
    assert.equal(re.ok, true);
    const row = getArtifactByTypeName(db, "skill", "demo")!;
    const ver = db
      .prepare("SELECT validated_at FROM artifact_versions WHERE artifact_id = ?")
      .get(row.id) as { validated_at: string | null };
    assert.ok(ver.validated_at);
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("sweep ages active when days=0; board counts", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-sw-"));
  const db = openDatabase(dataDir);
  migrate(db);
  try {
    seedArtifact(db, "alpha");
    transitionArtifact(db, {
      type: "skill",
      name: "alpha",
      to: "active",
      actor: "rita",
      actorRole: "reviewer",
    });
    const first = runAgingSweep(db, 0);
    assert.equal(first.aged, 1);
    assert.equal(getArtifactByTypeName(db, "skill", "alpha")!.status, "aging");
    const second = runAgingSweep(db, 0);
    assert.equal(second.aged, 0);

    const board = getLifecycleBoard(db, 30);
    assert.equal(board.aging.length, 1);
    assert.equal(board.counts.aging, 1);
    assert.equal(board.counts.candidate, 0);
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("validateVersion merges model_compat without duplicates", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-val-"));
  const db = openDatabase(dataDir);
  migrate(db);
  try {
    seedArtifact(db, "beta");
    const v = validateVersion(db, {
      type: "skill",
      name: "beta",
      version: "latest",
      model_compat: ["opus-5", "opus-5"],
      note: "n",
      actor: "rita",
    });
    assert.equal(v.ok, true);
    if (!v.ok) return;
    assert.deepEqual(v.detail.model_compat, ["opus-5"]);
    assert.ok(v.detail.validated_at);
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("routes lifecycle: transition and board via inject", async () => {
  await withApp(async (app) => {
    const cookie = await loginCookie(app);
    const pub = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        type: "skill",
        files: [
          {
            path: "SKILL.md",
            content_base64: Buffer.from(
              "---\nname: route-demo\ndescription: Route demo skill for lifecycle unit tests.\ntags: [t]\n---\n\n# Route demo\n",
            ).toString("base64"),
          },
        ],
      },
    });
    assert.equal(pub.statusCode, 201, pub.body);

    const forbidden = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts/skill/route-demo/transitions",
      payload: { to: "active" },
    });
    assert.equal(forbidden.statusCode, 401);

    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts/skill/route-demo/transitions",
      headers: { cookie, "content-type": "application/json" },
      payload: { to: "active", reason: "unit" },
    });
    assert.equal(ok.statusCode, 200, ok.body);
    const body = ok.json() as { artifact: { status: string }; event: { action: string } };
    assert.equal(body.artifact.status, "active");
    assert.equal(body.event.action, "transition");

    const board = await app.inject({ method: "GET", url: "/api/v1/lifecycle/board" });
    assert.equal(board.statusCode, 200);
    assert.ok("counts" in board.json());

    const card = await app.inject({
      method: "GET",
      url: "/api/v1/artifacts/skill/route-demo",
      headers: { cookie },
    });
    const cardBody = card.json() as { allowed_transitions: string[] };
    assert.ok(Array.isArray(cardBody.allowed_transitions));
    assert.ok(cardBody.allowed_transitions.includes("aging"));
  });
});

void TEST_ADMIN_PASSWORD;
