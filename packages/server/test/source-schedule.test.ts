// fix-tracked-source-archive: background checks of mirrors and tracked sources go by due date, not by a timer from
// server start — a source is due when its last check is older than the interval or it was never checked; the first
// pass runs 5 minutes after start, then every hour; passes never overlap; interval 0 turns them off.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { isDue, startSourceSchedule } from "../src/tracked/schedule.ts";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-11-18T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

test("due: never checked, or checked longer ago than the interval", () => {
  assert.equal(isDue(null, 24, NOW), true);
  assert.equal(isDue(ago(25 * HOUR), 24, NOW), true);
  assert.equal(isDue(ago(24 * HOUR), 24, NOW), true, "exactly on the interval is due");
  // negative cases: checked an hour ago, or just under the interval
  assert.equal(isDue(ago(HOUR), 24, NOW), false);
  assert.equal(isDue(ago(24 * HOUR - 1000), 24, NOW), false);
});

// a finished pass releases the schedule in a microtask: let it settle between ticks
const settle = () => new Promise((r) => setImmediate(r));

test("the first pass runs 5 minutes after start, then every hour; restarts are covered by due dates", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  try {
    let passes = 0;
    const schedule = startSourceSchedule(async () => void passes++, { intervalHours: 24 });
    mock.timers.tick(5 * 60_000 - 1);
    assert.equal(passes, 0, "no pass before 5 minutes");
    mock.timers.tick(1);
    assert.equal(passes, 1, "the first pass at 5 minutes");
    await settle();
    mock.timers.tick(HOUR);
    assert.equal(passes, 2, "then every hour");
    await settle();
    mock.timers.tick(HOUR);
    assert.equal(passes, 3);
    schedule.stop();
    await settle();
    mock.timers.tick(5 * HOUR);
    assert.equal(passes, 3, "nothing after stop");
  } finally {
    mock.timers.reset();
  }
});

test("a pass does not start while the previous one runs", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  try {
    let started = 0;
    let finish: () => void = () => {};
    const schedule = startSourceSchedule(
      () => {
        started++;
        return new Promise<void>((r) => (finish = r));
      },
      { intervalHours: 24 },
    );
    mock.timers.tick(5 * 60_000);
    mock.timers.tick(3 * HOUR);
    assert.equal(started, 1, "the hourly ticks skipped while the first pass ran");
    finish();
    await new Promise((r) => setImmediate(r));
    mock.timers.tick(HOUR);
    assert.equal(started, 2, "the next tick after it finished starts a pass");
    schedule.stop();
  } finally {
    mock.timers.reset();
  }
});

test("interval 0: no passes at all", () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  try {
    let passes = 0;
    const schedule = startSourceSchedule(async () => void passes++, { intervalHours: 0 });
    mock.timers.tick(48 * HOUR);
    assert.equal(passes, 0);
    schedule.stop();
  } finally {
    mock.timers.reset();
  }
});
