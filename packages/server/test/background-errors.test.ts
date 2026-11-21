// fix-background-errors-silent: a background task that fails writes `background_task_failed` to the server log
// instead of swallowing the error; the same error in a row is written once. The routines tick and the eval batch pump
// run every 500 ms with a database that lost their table; a healthy database writes nothing. Every periodic timer of
// the server goes through lib/background.ts, so a new timer cannot bring back a silent catch.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate, openDatabase, type Database } from "../src/db.ts";
import type { AppConfig } from "../src/config.ts";
import { startRoutinesScheduler, stopRoutinesScheduler } from "../src/routines/runner.ts";
import { startBatchPump, stopBatchPump } from "../src/evals/batch.ts";
import { makeConfig } from "./helpers.ts";

type Line = { msg: string } & Record<string, unknown>;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Body = (db: Database, config: AppConfig, lines: Line[]) => Promise<void>;

function withDb(drop: string | null, fn: Body) {
  return async () => {
    const { config, dataDir, cleanup } = makeConfig();
    const db = openDatabase(dataDir);
    migrate(db);
    if (drop) db.exec(`DROP TABLE ${drop}`);
    const lines: Line[] = [];
    try {
      await fn(db, config, lines);
    } finally {
      db.close();
      cleanup();
    }
  };
}

const log = (lines: Line[]) => (msg: string, fields: Record<string, unknown>) =>
  lines.push({ msg, ...fields });

test(
  "a failing routines tick is logged once, not swallowed",
  withDb("routines", async (db, config, lines) => {
    startRoutinesScheduler(db, config.dataDir, {
      routinesDisabled: false,
      log: log(lines),
    } as never);
    try {
      await wait(1800); // three ticks or more
    } finally {
      stopRoutinesScheduler();
    }
    assert.equal(lines.length, 1, JSON.stringify(lines));
    assert.equal(lines[0]!.msg, "background_task_failed");
    assert.equal(lines[0]!.task, "routines");
    assert.match(String(lines[0]!.error), /no such table/);
  }),
);

test(
  "a failing eval batch pump is logged once, not swallowed",
  withDb("eval_batches", async (db, config, lines) => {
    startBatchPump(db, config, { log: log(lines) } as never);
    try {
      await wait(1800);
    } finally {
      stopBatchPump();
    }
    assert.equal(lines.length, 1, JSON.stringify(lines));
    assert.equal(lines[0]!.msg, "background_task_failed");
    assert.equal(lines[0]!.task, "eval_batches");
    assert.match(String(lines[0]!.error), /no such table/);
  }),
);

test(
  "negative: a healthy database writes nothing",
  withDb(null, async (db, config, lines) => {
    startRoutinesScheduler(db, config.dataDir, {
      routinesDisabled: false,
      log: log(lines),
    } as never);
    startBatchPump(db, config, { log: log(lines) } as never);
    try {
      await wait(1200);
    } finally {
      stopRoutinesScheduler();
      stopBatchPump();
    }
    assert.deepEqual(lines, []);
  }),
);

test("every periodic timer of the server goes through lib/background.ts", () => {
  const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
  // news/delivery.ts logs its own failures as news_tick_failed.
  const allowed = new Set(["lib/background.ts", "news/delivery.ts"]);
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts") && fs.readFileSync(p, "utf8").includes("setInterval(")) {
        found.push(path.relative(src, p).split(path.sep).join("/"));
      }
    }
  };
  walk(src);
  assert.deepEqual(
    found.filter((f) => !allowed.has(f)),
    [],
    "use startBackgroundTask from lib/background.ts: its errors reach the server log",
  );
  assert.ok(found.includes("lib/background.ts"), "lib/background.ts owns the interval timer");
});
