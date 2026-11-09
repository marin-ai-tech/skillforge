import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, migrate } from "../src/db.ts";
import { publishArtifact } from "../src/publish.ts";
import { buildSnapshot } from "../src/agents/scan.ts";
import { compareAgent } from "../src/agents/compare.ts";
import { upsertAgent, replaceItems } from "../src/agents/store.ts";

const LOCAL_NOTES = `---
name: local-notes
description: Keeps short project notes and reminders. Use when the user asks to remember or recall a note.
---

# Local notes

Store notes in \`notes.md\`; recall them on request.
`;

let dataDir: string;
let db: ReturnType<typeof openDatabase>;

before(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-agents-unit-"));
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

function b(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s));
}

test("compare: local_only / in_sync / modified and registry_only filter", () => {
  const skillMd = `---
name: pdf-tools
description: Extract text and tables from PDF files for downstream analysis in Claude Code workflows.
---

# PDF tools

Body.
`;
  const pub = publishArtifact(
    { db, dataDir, actor: "alice" },
    {
      type: "skill",
      files: [
        { path: "SKILL.md", content_base64: Buffer.from(skillMd).toString("base64") },
        {
          path: "scripts/run.sh",
          content_base64: Buffer.from("#!/bin/sh\necho ok\n").toString("base64"),
        },
      ],
    },
  );
  assert.equal(pub.kind, "created");

  const propose = `---
name: propose
description: Propose a change with a short rationale for review before applying edits.
---

# Propose

Do the thing.
`;
  const pubCmd = publishArtifact(
    { db, dataDir, actor: "alice" },
    {
      type: "command",
      files: [{ path: "propose.md", content_base64: Buffer.from(propose).toString("base64") }],
    },
  );
  assert.equal(pubCmd.kind, "created");

  const snap = buildSnapshot(
    [
      { path: "skills/pdf-tools/SKILL.md", content: b(skillMd) },
      { path: "skills/pdf-tools/scripts/run.sh", content: b("#!/bin/sh\necho ok\n") },
      { path: "skills/local-notes/SKILL.md", content: b(LOCAL_NOTES) },
      { path: "commands/propose.md", content: b(propose + "\n\nLocal tweak.\n") },
      { path: "README.md", content: b("# x\n") },
    ],
    { artifacts: { "skill/pdf-tools": { version: "0.1.0" } } },
    dataDir,
  );
  assert.equal(snap.invalid.length, 0);
  assert.ok(snap.skipped.some((s) => s.path === "README.md"));

  const scannedAt = new Date().toISOString();
  const agent = upsertAgent(db, {
    ownerId: "u1",
    name: "laptop",
    kind: "upload",
    runtime: "claude-code",
    scannedAt,
  });
  replaceItems(db, agent.id, snap.items, scannedAt);

  const compared = compareAgent(db, agent);
  const byKey = Object.fromEntries(compared.items.map((i) => [i.key, i]));
  assert.equal(byKey["skill/pdf-tools"]?.status, "in_sync");
  assert.equal(byKey["skill/local-notes"]?.status, "local_only");
  assert.equal(byKey["command/propose"]?.status, "modified");
  assert.ok(
    byKey["command/propose"]?.changed_files?.includes("commands/propose.md") ||
      byKey["command/propose"]?.changed_files?.includes("propose.md"),
  );

  const all = compareAgent(db, agent, { registryStatus: "all" });
  assert.ok(all.summary.registry_only >= compared.summary.registry_only);
});
