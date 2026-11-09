import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMarketplace,
  bumpMarketplaceVersion,
  getMarketplaceVersion,
} from "../src/distribution/marketplace.ts";
import { openDatabase, migrate } from "../src/db.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../src/config.ts";

function cfg(dataDir: string): AppConfig {
  return {
    port: 0,
    host: "127.0.0.1",
    dataDir,
    baseUrl: "http://example.test",
    webDir: dataDir,
    adminPassword: null,
    publicRead: true,
    sessionTtlDays: 30,
    agingDays: 90,
    candidateTtlDays: 30,
    importGit: true,
    importAllowFileUrls: false,
    importTtlMinutes: 15,
    marketplaceName: "skillforge",
    marketplaceOwner: "SkillForge",
  };
}

test("buildMarketplace: ETag changes after bump", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-mkt-"));
  const db = openDatabase(dataDir);
  try {
    migrate(db);
    const before = getMarketplaceVersion();
    const a = buildMarketplace(db, cfg(dataDir), { statuses: ["active"] });
    const b = buildMarketplace(db, cfg(dataDir), { statuses: ["active"] });
    assert.equal(a.etag, b.etag);
    bumpMarketplaceVersion();
    const c = buildMarketplace(db, cfg(dataDir), { statuses: ["active"] });
    assert.notEqual(c.etag, a.etag);
    assert.ok(getMarketplaceVersion() > before);
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
