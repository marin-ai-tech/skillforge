import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeCappedTransfer,
  isStaleCandidate,
  daysToMs,
  isoFromMs,
} from "../src/lifecycle/policy.ts";
import { parseConfig, ConfigError } from "../src/config.ts";

test("low_transfer: single-author poisoning does not apply (need min reporters)", () => {
  const t = computeCappedTransfer([{ reporter: "bob", uses: 100000, helped: 0 }], 20, 3);
  assert.equal(t.reporters, 1);
  assert.equal(t.applies, false);
  assert.equal(t.uses, 20);
  assert.equal(t.rate, 0);
});

test("low_transfer: two authors still below reporter threshold", () => {
  const t = computeCappedTransfer(
    [
      { reporter: "bob", uses: 100000, helped: 0 },
      { reporter: "r1", uses: 100000, helped: 0 },
    ],
    20,
    3,
  );
  assert.equal(t.reporters, 2);
  assert.equal(t.applies, false);
});

test("low_transfer: author cap protects mixed good reports", () => {
  const t = computeCappedTransfer(
    [
      { reporter: "bob", uses: 100000, helped: 0 },
      { reporter: "r2", uses: 20, helped: 20 },
      { reporter: "r3", uses: 20, helped: 20 },
    ],
    20,
    3,
  );
  assert.equal(t.applies, true);
  assert.equal(t.reporters, 3);
  assert.equal(t.uses, 60);
  assert.ok(t.rate !== null && t.rate > 0.5, `rate=${t.rate}`);
});

test("low_transfer: three low authors fire below threshold", () => {
  const t = computeCappedTransfer(
    [
      { reporter: "r1", uses: 20, helped: 0 },
      { reporter: "r2", uses: 20, helped: 1 },
      { reporter: "r3", uses: 20, helped: 0 },
    ],
    20,
    3,
  );
  assert.equal(t.applies, true);
  assert.ok(t.rate !== null && t.rate < 0.2, `rate=${t.rate}`);
});

test("low_transfer: below MIN_USES after cap does not apply", () => {
  const t = computeCappedTransfer(
    [
      { reporter: "r1", uses: 5, helped: 0 },
      { reporter: "r2", uses: 5, helped: 0 },
      { reporter: "r3", uses: 5, helped: 0 },
    ],
    20,
    3,
  );
  assert.equal(t.uses, 15);
  assert.equal(t.applies, false);
});

test("config: lifecycle policy defaults and bad transfer rate names variable", () => {
  const cfg = parseConfig({});
  assert.equal(cfg.dataLifecycleEnabled, true);
  assert.equal(cfg.zombieIdleDays, 180);
  assert.equal(cfg.zombieMinUses, 20);
  assert.equal(cfg.zombieMinReporters, 3);
  assert.equal(cfg.zombieTransferRate, 0.2);
  assert.equal(cfg.ablationMinTasks, 10);
  assert.equal(cfg.reviveMinEvents, 3);
  assert.equal(cfg.lifecycleMaxPerSweep, 20);
  assert.equal(parseConfig({ SKILLFORGE_DATA_LIFECYCLE: "off" }).dataLifecycleEnabled, false);
  assert.throws(
    () => parseConfig({ SKILLFORGE_ZOMBIE_TRANSFER_RATE: "2" }),
    (err: unknown) =>
      err instanceof ConfigError && err.variable === "SKILLFORGE_ZOMBIE_TRANSFER_RATE",
  );
  assert.throws(
    () => parseConfig({ SKILLFORGE_DATA_LIFECYCLE: "maybe" }),
    (err: unknown) => err instanceof ConfigError && err.variable === "SKILLFORGE_DATA_LIFECYCLE",
  );
});

test("stale_candidate TTL: younger than candidateTtlDays is not stale", () => {
  const nowMs = Date.parse("2026-09-29T12:00:00.000Z");
  const ttlDays = 30;
  const createdAt = isoFromMs(nowMs - daysToMs(29));
  assert.equal(isStaleCandidate(createdAt, ttlDays, nowMs), false);
  // exactly at boundary (created_at === threshold) is NOT older
  const atBoundary = isoFromMs(nowMs - daysToMs(ttlDays));
  assert.equal(isStaleCandidate(atBoundary, ttlDays, nowMs), false);
});

test("stale_candidate TTL: older than candidateTtlDays is stale", () => {
  const nowMs = Date.parse("2026-09-29T12:00:00.000Z");
  const ttlDays = 30;
  const createdAt = isoFromMs(nowMs - daysToMs(31));
  assert.equal(isStaleCandidate(createdAt, ttlDays, nowMs), true);
  // one ms older than threshold
  const justOlder = isoFromMs(nowMs - daysToMs(ttlDays) - 1);
  assert.equal(isStaleCandidate(justOlder, ttlDays, nowMs), true);
});
