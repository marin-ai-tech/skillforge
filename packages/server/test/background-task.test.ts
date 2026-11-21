// fix-background-errors-silent: the contract of the background task helper (lib/background.ts). A failing pass is
// written to the log as `background_task_failed` with the task and the error; the same error in a row is written once,
// until a pass succeeds or the error changes; a rejected promise counts as a failure; async passes never overlap;
// stop() ends the runs; the helper itself never throws.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { backgroundErrorReporter, startBackgroundTask } from "../src/lib/background.ts";

type Line = { msg: string } & Record<string, unknown>;
const settle = () => new Promise((r) => setImmediate(r));

function collect(): { lines: Line[]; log: (msg: string, fields: Record<string, unknown>) => void } {
  const lines: Line[] = [];
  return { lines, log: (msg, fields) => lines.push({ msg, ...fields }) };
}

test("reporter: one line per run of the same error, again after a success or another error", () => {
  const { lines, log } = collect();
  const r = backgroundErrorReporter("demo", log);
  r.failed(new Error("disk full"));
  r.failed(new Error("disk full"));
  assert.deepEqual(lines, [{ msg: "background_task_failed", task: "demo", error: "disk full" }]);
  r.failed(new Error("locked"));
  assert.equal(lines.length, 2, "another error is written");
  r.ok();
  r.failed(new Error("locked"));
  assert.equal(lines.length, 3, "the same error after a success is written again");
  r.failed("plain string");
  assert.equal(lines[3]!.error, "plain string");
  // negative: without a log nothing throws
  backgroundErrorReporter("quiet").failed(new Error("x"));
});

test("task: a throwing pass is logged once and the timer keeps running", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  try {
    const { lines, log } = collect();
    let runs = 0;
    const t = startBackgroundTask({
      task: "sync",
      everyMs: 100,
      run: () => {
        runs++;
        throw new Error("boom");
      },
      log,
    });
    for (let i = 0; i < 3; i++) {
      mock.timers.tick(100);
      await settle();
    }
    assert.equal(runs, 3);
    assert.equal(lines.length, 1, JSON.stringify(lines));
    assert.deepEqual(lines[0], { msg: "background_task_failed", task: "sync", error: "boom" });
    t.stop();
    mock.timers.tick(500);
    await settle();
    assert.equal(runs, 3, "nothing after stop");
  } finally {
    mock.timers.reset();
  }
});

test("task: a rejected promise is a failure; a success resets the memory", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  try {
    const { lines, log } = collect();
    const outcomes = ["fail", "ok", "fail"];
    let i = 0;
    const t = startBackgroundTask({
      task: "async",
      everyMs: 100,
      run: async () => {
        if (outcomes[i++] === "fail") throw new Error("offline");
      },
      log,
    });
    for (let k = 0; k < 3; k++) {
      mock.timers.tick(100);
      await settle();
      await settle();
    }
    t.stop();
    assert.equal(lines.length, 2, JSON.stringify(lines));
    assert.equal(lines[1]!.error, "offline");
  } finally {
    mock.timers.reset();
  }
});

test("task: an async pass does not start while the previous one runs", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  try {
    let started = 0;
    let finish: () => void = () => {};
    const t = startBackgroundTask({
      task: "slow",
      everyMs: 100,
      run: () => {
        started++;
        return new Promise<void>((r) => (finish = r));
      },
    });
    mock.timers.tick(100);
    mock.timers.tick(100);
    mock.timers.tick(100);
    assert.equal(started, 1, "no overlap");
    finish();
    await settle();
    await settle();
    mock.timers.tick(100);
    assert.equal(started, 2);
    t.stop();
  } finally {
    mock.timers.reset();
  }
});

test("task: firstDelayMs runs the first pass after the delay, then every everyMs", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  try {
    let runs = 0;
    const t = startBackgroundTask({
      task: "late",
      everyMs: 1000,
      firstDelayMs: 300,
      run: () => void runs++,
    });
    mock.timers.tick(299);
    assert.equal(runs, 0);
    mock.timers.tick(1);
    assert.equal(runs, 1);
    await settle();
    mock.timers.tick(1000);
    assert.equal(runs, 2);
    t.stop();
    await settle();
    mock.timers.tick(5000);
    assert.equal(runs, 2);
  } finally {
    mock.timers.reset();
  }
});
