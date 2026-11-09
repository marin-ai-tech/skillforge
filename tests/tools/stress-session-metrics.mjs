// Stress oracle: runs
// tests/session-metrics.test.mjs RUNS times, PARALLEL at a time (load like the full root run
// with parallel executors), and counts failures. Exit code 0 — all runs green, 1 — there were failures.
// Not covered by the tests/*.test.mjs glob. Requires `npm run build`.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { ROOT } from "../lib/client.mjs";

const RUNS = Number(process.env.STRESS_RUNS ?? 12);
const PARALLEL = Number(process.env.STRESS_PARALLEL ?? 6);
const FILE = join(ROOT, "tests", "session-metrics.test.mjs");

function once(i) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--test", FILE], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill(), 300_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      const reasons = [...out.matchAll(/(ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|fetch failed)/g)].map((m) => m[1]);
      resolve({ i, code, reasons: [...new Set(reasons)] });
    });
  });
}

const results = [];
let next = 0;
async function worker() {
  while (next < RUNS) results.push(await once(next++));
}
await Promise.all(Array.from({ length: PARALLEL }, worker));
const failed = results.filter((r) => r.code !== 0);
console.log(`stress session-metrics: ${RUNS - failed.length}/${RUNS} green (parallel ${PARALLEL})`);
for (const f of failed) console.log(`  run ${f.i}: exit ${f.code} ${f.reasons.join(",") || "(no network error text)"}`);
process.exit(failed.length ? 1 : 0);
