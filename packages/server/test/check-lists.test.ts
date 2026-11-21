// chore-check-lists: a `CHECK (<column> IN (…))` that repeats a list of the code drifts silently — a new value passes
// the boundary and fails on insert (fix-notification-prefs-source). Every such list in the schema after all
// migrations is either an extensible list compared here with the code list by name, or a closed one listed with its
// reason. A list in neither group fails: put it in one of them (or drop the CHECK, as 0055 did).
import { test } from "node:test";
import assert from "node:assert/strict";
import { migrate, openDatabase } from "../src/db.ts";
import { MCP_SCOPES, MCP_TRANSPORTS } from "../src/agents/mcp-body.ts";
import { BADGE_TONES } from "../src/plugins/badges.ts";
import { USAGE_BASES } from "../src/evidence/usage.ts";
import { FACT_BASES, VERIFICATIONS } from "../src/sessions/facts.ts";
import { STATES } from "../src/availability.ts";
import { makeConfig } from "./helpers.ts";

/** Extensible lists: the table must allow exactly what the code accepts. */
const EXTENSIBLE: Record<string, readonly string[]> = {
  "agent_mcp_servers.transport": MCP_TRANSPORTS,
  "agent_mcp_servers.scope": MCP_SCOPES,
  "artifact_usage_reports.basis": USAGE_BASES,
  "session_facts.verification": [...VERIFICATIONS],
  "session_facts.basis": [...FACT_BASES],
  "artifact_badges.tone": BADGE_TONES,
  // `available` is stored as no row.
  "artifact_availability.state": STATES.filter((s) => s !== "available"),
};

/** Closed by meaning: a new value would be a new model, not a new item of a list. */
const CLOSED: Record<string, string> = {
  "team_members.role": "member or lead",
  "artifact_versions.channel": "stable or beta",
  "artifact_watchers.source": "auto or manual watching",
};
const isFlag = (values: string[]) =>
  values.length === 2 && values.includes("0") && values.includes("1");

function checkLists(): Map<string, string[]> {
  const { dataDir, cleanup } = makeConfig();
  const db = openDatabase(dataDir);
  migrate(db);
  try {
    const rows = db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL")
      .all() as Array<{ name: string; sql: string }>;
    const out = new Map<string, string[]>();
    for (const { name, sql } of rows) {
      for (const m of sql.matchAll(/CHECK\s*\(\s*(\w+)\s+IN\s*\(([^)]*)\)\s*\)/gi)) {
        const values = m[2]!.split(",").map((v) => v.trim().replace(/^'(.*)'$/, "$1"));
        out.set(`${name}.${m[1]}`, values);
      }
    }
    return out;
  } finally {
    db.close();
    cleanup();
  }
}

test("every CHECK list in the schema is an extensible list equal to the code, or a closed one", () => {
  const lists = checkLists();
  assert.ok(lists.size > 0, "no CHECK lists found: the parser is broken");
  const unknown: string[] = [];
  for (const [key, values] of lists) {
    if (isFlag(values) || key in CLOSED) continue;
    const code = EXTENSIBLE[key];
    if (!code) {
      unknown.push(`${key}: ${values.join(", ")}`);
      continue;
    }
    assert.deepEqual([...values].sort(), [...code].sort(), `${key}: the table and the code differ`);
  }
  assert.deepEqual(
    unknown,
    [],
    "new CHECK list: add it to EXTENSIBLE (with the code list) or CLOSED (with a reason)",
  );
  // Every listed column still has its CHECK: a rebuilt table without it must leave this test too.
  for (const key of [...Object.keys(EXTENSIBLE), ...Object.keys(CLOSED)]) {
    assert.ok(lists.has(key), `${key}: no CHECK list any more — remove it from this test`);
  }
});

test("negative: `available` is not stored, and the closed lists are not the extensible ones", () => {
  const lists = checkLists();
  assert.ok(!lists.get("artifact_availability.state")?.includes("available"));
  for (const key of Object.keys(CLOSED)) assert.ok(!(key in EXTENSIBLE), key);
});
