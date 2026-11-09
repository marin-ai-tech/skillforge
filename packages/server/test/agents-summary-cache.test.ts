import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, migrate } from "../src/db.ts";
import { publishArtifact } from "../src/publish.ts";
import { buildSnapshot } from "../src/agents/scan.ts";
import { upsertAgent, replaceItems } from "../src/agents/store.ts";
import {
  AGENT_SUMMARY_CACHE_MAX_ENTRIES,
  agentSummaryCacheSize,
  cachedAgentSummary,
} from "../src/agents/summary-cache.ts";
import { compareAgent } from "../src/agents/compare.ts";
import { addMaintainer, removeMaintainer } from "../src/ownership.ts";
import { bumpRegistryEpoch, getRegistryEpoch } from "../src/registry-epoch.ts";

const md = (name: string, rev = "") =>
  `---\nname: ${name}\ndescription: Summary cache probe ${name} for agents list tests.\n---\n\n# ${name}\n${rev}\n`;

let dataDir: string;
let db: ReturnType<typeof openDatabase>;

before(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-summary-cache-"));
  db = openDatabase(dataDir);
  migrate(db);
});

after(() => {
  try {
    db.close();
  } catch {
    /* ignore */
  }
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function publish(name: string, version: string, rev = "") {
  const r = publishArtifact(
    { db, dataDir, actor: "admin" },
    {
      type: "skill",
      version,
      files: [{ path: "SKILL.md", content_base64: Buffer.from(md(name, rev)).toString("base64") }],
    },
  );
  assert.ok(r.kind === "created" || r.kind === "version_added", JSON.stringify(r));
}

function agentWith(ownerId: string, name: string, skills: Array<[string, string]>) {
  const scannedAt = new Date().toISOString();
  const snap = buildSnapshot(
    skills.map(([n, rev]) => ({
      path: `skills/${n}/SKILL.md`,
      content: new Uint8Array(Buffer.from(md(n, rev))),
    })),
    null,
  );
  const agent = upsertAgent(db, { ownerId, name, kind: "upload", scannedAt });
  replaceItems(db, agent.id, snap.items, scannedAt);
  return agent;
}

const alice = { username: "alice", role: "contributor" as const };
const bob = { username: "bob", role: "contributor" as const };

test("summary cache: hit matches uncached compare, returns copies, drops on epoch bump", () => {
  publish("sc-one", "0.1.0");
  const agent = agentWith("u-alice", "a1", [["sc-one", ""]]);
  const first = cachedAgentSummary(db, agent, alice);
  assert.deepEqual(first, compareAgent(db, agent, { viewer: alice }).summary);
  assert.equal(first.in_sync, 1);
  assert.equal(agentSummaryCacheSize(db), 1);

  first.in_sync = 99; // caller mutation must not leak into the cache
  const second = cachedAgentSummary(db, agent, alice);
  assert.equal(second.in_sync, 1);
  assert.notEqual(second, first);

  const epoch = getRegistryEpoch();
  publish("sc-one", "0.2.0", "v2");
  assert.ok(getRegistryEpoch() > epoch, "publication bumps the registry epoch");
  assert.equal(agentSummaryCacheSize(db), 0);
  const afterPub = cachedAgentSummary(db, agent, alice);
  assert.equal(afterPub.outdated, 1);
  assert.equal(afterPub.in_sync, 0);
});

test("summary cache: per-viewer entries; maintainer change invalidates", () => {
  publish("sc-team", "0.1.0");
  db.prepare(
    "UPDATE artifacts SET visibility = 'team', owner = 'admin' WHERE name = 'sc-team'",
  ).run();
  bumpRegistryEpoch(); // direct SQL in the fixture; product paths bump on their own
  const agent = agentWith("u-shared", "shared", [["sc-team", ""]]);
  assert.equal(cachedAgentSummary(db, agent, alice).local_only, 1);
  assert.equal(cachedAgentSummary(db, agent, bob).local_only, 1);

  const art = db.prepare("SELECT id FROM artifacts WHERE name = 'sc-team'").get() as { id: string };
  addMaintainer(db, art.id, "bob", "admin", new Date().toISOString());
  assert.equal(cachedAgentSummary(db, agent, bob).in_sync, 1, "maintainer sees the team skill");
  assert.equal(cachedAgentSummary(db, agent, alice).local_only, 1, "alice keeps her own result");

  removeMaintainer(db, art.id, "bob");
  assert.equal(cachedAgentSummary(db, agent, bob).local_only, 1, "removal invalidates bob's entry");
  assert.equal(cachedAgentSummary(db, agent, null).local_only, 1, "anonymous viewer");
});

test("summary cache: new snapshot of the agent is never served from the old entry", () => {
  publish("sc-snap", "0.1.0");
  const a = agentWith("u-alice", "snap", [["sc-snap", ""]]);
  assert.equal(cachedAgentSummary(db, a, alice).in_sync, 1);
  const b = agentWith("u-alice", "snap", [["sc-snap", "local edit"]]);
  assert.equal(b.id, a.id);
  assert.equal(cachedAgentSummary(db, b, alice).modified, 1);
});

test("summary cache: size is bounded (LRU)", () => {
  bumpRegistryEpoch();
  const agent = agentWith("u-lru", "lru", [["sc-one", ""]]);
  const total = AGENT_SUMMARY_CACHE_MAX_ENTRIES + 25;
  for (let i = 0; i < total; i++) {
    cachedAgentSummary(db, agent, { username: `viewer-${i}`, role: "contributor" });
  }
  assert.equal(agentSummaryCacheSize(db), AGENT_SUMMARY_CACHE_MAX_ENTRIES);
});
