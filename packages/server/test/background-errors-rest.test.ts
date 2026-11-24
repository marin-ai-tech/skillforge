// fix-background-errors-rest: handlers the server calls on an event — not on a timer — write their failures to the
// server log as `background_task_failed`, like the periodic tasks: the eval run-finished hooks (one of them writes the
// provenance record of the run) and the plugin event handlers (sync throw and rejected promise). A failing handler
// stops neither the queue nor the other handlers, and nothing goes only to console.error.
import { test } from "node:test";
import assert from "node:assert/strict";
import { notifyRunFinished, onRunFinished, setEvalRunLog } from "../src/evals/runs.ts";
import {
  emitPluginEvent,
  resetPluginEventHandlers,
  setPluginEventLog,
  subscribePluginEvent,
} from "../src/plugins/events.ts";

type Line = { msg: string } & Record<string, unknown>;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("a failing run-finished hook is logged and the next hook still runs; a healthy one logs nothing", () => {
  const lines: Line[] = [];
  setEvalRunLog((msg, fields) => lines.push({ msg, ...fields }));
  const seen: number[] = [];
  onRunFinished(() => {
    throw new Error("provenance table is gone");
  });
  onRunFinished((runId) => seen.push(runId));
  try {
    notifyRunFinished(41);
  } finally {
    setEvalRunLog(undefined);
  }
  assert.deepEqual(seen, [41], "the second hook was not called");
  assert.equal(lines.length, 1, JSON.stringify(lines));
  assert.equal(lines[0]!.msg, "background_task_failed");
  assert.equal(lines[0]!.task, "eval-run-finished");
  assert.equal(lines[0]!.run_id, 41);
  assert.match(String(lines[0]!.error), /provenance table is gone/);
});

test("plugin event handlers: a throw and a rejection are logged with the plugin and the event; others still get it", async () => {
  resetPluginEventHandlers();
  const lines: Line[] = [];
  setPluginEventLog((msg, fields) => lines.push({ msg, ...fields }));
  const consoleCalls: unknown[][] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => {
    consoleCalls.push(args);
  };
  const got: string[] = [];
  try {
    subscribePluginEvent("p1", "artifact.published", () => {
      throw new Error("p1 broke");
    });
    subscribePluginEvent("p2", "artifact.published", async () => {
      throw new Error("p2 rejected");
    });
    subscribePluginEvent("p3", "artifact.published", (e) => {
      got.push(e.type);
    });
    emitPluginEvent({ type: "artifact.published", at: new Date().toISOString() } as never);
    await wait(50);
  } finally {
    console.error = realError;
    setPluginEventLog(undefined);
    resetPluginEventHandlers();
  }
  assert.deepEqual(got, ["artifact.published"], "a healthy handler did not get the event");
  const byPlugin = Object.fromEntries(lines.map((l) => [String(l.plugin), l]));
  assert.equal(lines.length, 2, JSON.stringify(lines));
  for (const [plugin, text] of [
    ["p1", /p1 broke/],
    ["p2", /p2 rejected/],
  ] as const) {
    const l = byPlugin[plugin];
    assert.ok(l, `no log line for ${plugin}: ${JSON.stringify(lines)}`);
    assert.equal(l.msg, "background_task_failed");
    assert.equal(l.task, "plugin-event");
    assert.equal(l.event, "artifact.published");
    assert.match(String(l.error), text);
  }
  assert.deepEqual(consoleCalls, [], "an error went to console.error");
});
