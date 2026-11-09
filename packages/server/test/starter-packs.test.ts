import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  findStarterPack,
  isSafePackId,
  loadStarterPacks,
  readSkillPublishFiles,
  validatePackPaths,
} from "../src/starter-packs/load.ts";
import { withApp, loginCookie } from "./helpers.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACK_DIR = path.resolve(HERE, "../starter-packs/codealive");

test("isSafePackId: kebab-case only", () => {
  assert.equal(isSafePackId("codealive"), true);
  assert.equal(isSafePackId("my-pack"), true);
  assert.equal(isSafePackId("Nope"), false);
  assert.equal(isSafePackId("../etc"), false);
  assert.equal(isSafePackId("a/b"), false);
  assert.equal(isSafePackId(""), false);
});

test("loadStarterPacks: missing dir is empty; valid codealive loads", () => {
  const missing = path.join(os.tmpdir(), "sf-packs-missing-" + Date.now());
  assert.deepEqual(loadStarterPacks(missing), []);
  const root = path.resolve(HERE, "../starter-packs");
  const packs = loadStarterPacks(root);
  const ca = packs.find((p) => p.id === "codealive");
  assert.ok(ca);
  assert.equal(ca!.artifacts.length, 9);
  assert.equal(ca!.license, "MIT");
});

test("validatePackPaths: rejects path escape", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-pack-esc-"));
  try {
    const bad = [
      {
        type: "skill",
        name: "evil",
        path: "../../outside",
        repo: "x/y",
        commit: "0".repeat(40),
        source_path: "x",
      },
    ];
    const r = validatePackPaths(dir, bad);
    assert.equal(r.ok, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadStarterPacks: broken json and escape pack skipped", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sf-packs-"));
  try {
    fs.mkdirSync(path.join(root, "broken"));
    fs.writeFileSync(path.join(root, "broken", "pack.json"), "{ not json");
    fs.mkdirSync(path.join(root, "evil"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "evil", "pack.json"),
      JSON.stringify({
        id: "evil",
        title: "Evil",
        description: "x",
        license: "MIT",
        source_repositories: [],
        artifacts: [
          {
            type: "skill",
            name: "evil-skill",
            path: "../../outside",
            repo: "x/y",
            commit: "0".repeat(40),
            source_path: "x",
          },
        ],
      }),
    );
    assert.deepEqual(
      loadStarterPacks(root).map((p) => p.id),
      [],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("readSkillPublishFiles: returns prefixed paths; missing dir null", () => {
  const pack = findStarterPack(path.resolve(HERE, "../starter-packs"), "codealive");
  assert.ok(pack);
  const art = pack!.artifacts.find((a) => a.name === "plan-mode");
  assert.ok(art);
  const files = readSkillPublishFiles(pack!.dir, art!);
  assert.ok(files && files.length > 0);
  assert.ok(files!.some((f) => f.path === "plan-mode/SKILL.md"));
  const missing = readSkillPublishFiles(pack!.dir, { ...art!, path: "skills/no-such-skill" });
  assert.equal(missing, null);
});

test("routes: list/install admin-only; install idempotent; unknown 404", async () => {
  const packsRoot = path.resolve(HERE, "../starter-packs");
  await withApp(
    async (app) => {
      const admin = await loginCookie(app);
      const list = await app.inject({
        method: "GET",
        url: "/api/v1/admin/starter-packs",
        headers: { cookie: admin },
      });
      assert.equal(list.statusCode, 200);
      const item = list.json().items.find((i: { id: string }) => i.id === "codealive");
      assert.ok(item);
      assert.equal(item.artifacts, 9);
      assert.equal(item.installed, 0);

      const anon = await app.inject({ method: "GET", url: "/api/v1/admin/starter-packs" });
      assert.equal(anon.statusCode, 401);

      const bad = await app.inject({
        method: "POST",
        url: "/api/v1/admin/starter-packs/nope/install",
        headers: { cookie: admin },
        payload: {},
      });
      assert.equal(bad.statusCode, 404);

      const first = await app.inject({
        method: "POST",
        url: "/api/v1/admin/starter-packs/codealive/install",
        headers: { cookie: admin },
        payload: {},
      });
      assert.equal(first.statusCode, 200, first.body);
      const results = first.json().results as Array<{ status: string; name: string }>;
      assert.equal(results.length, 9);
      assert.ok(
        results.every((r) => r.status === "created"),
        JSON.stringify(results),
      );

      const second = await app.inject({
        method: "POST",
        url: "/api/v1/admin/starter-packs/codealive/install",
        headers: { cookie: admin },
        payload: {},
      });
      assert.equal(second.statusCode, 200);
      assert.ok(second.json().results.every((r: { status: string }) => r.status === "exists"));

      const list2 = await app.inject({
        method: "GET",
        url: "/api/v1/admin/starter-packs",
        headers: { cookie: admin },
      });
      assert.equal(
        list2.json().items.find((i: { id: string }) => i.id === "codealive").installed,
        9,
      );
    },
    { starterPacksDir: packsRoot },
  );
});

test("pack.json exists on disk for codealive", () => {
  assert.ok(fs.existsSync(path.join(PACK_DIR, "pack.json")));
});
