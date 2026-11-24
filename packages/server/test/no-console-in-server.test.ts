// fix-background-errors-rest, audit 8b: a server failure goes to the server log (logging.ts), where an operator looks,
// not to the process console. The places that still print are listed here with their count (a ratchet): a new
// console call in packages/server/src fails this test; moving one of these to the log lowers its number.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Allowed today: start-up before the log exists, the log itself, and the plugin and starter-pack paths of backlog item 203. */
const ALLOWED: Record<string, number> = {
  "auth/seed.ts": 1,
  "config.ts": 1,
  "index.ts": 2,
  "logging.ts": 2,
  "plugins/context.ts": 3,
  "plugins/loader.ts": 1,
  "plugins/mcp-tools.ts": 1,
  "routes/plugins.ts": 2,
  "starter-packs/load.ts": 10,
};

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.ts$/.test(e.name) ? [p] : [];
  });
}

test("no new console output in the server: failures go to the server log", () => {
  const found: Record<string, number> = {};
  for (const file of files(SRC)) {
    const rel = path.relative(SRC, file).replaceAll("\\", "/");
    const n = (
      fs.readFileSync(file, "utf8").match(/\bconsole\.(log|warn|error|info|debug)\s*\(/g) ?? []
    ).length;
    if (n > 0) found[rel] = n;
  }
  const over = Object.entries(found)
    .filter(([f, n]) => n > (ALLOWED[f] ?? 0))
    .map(([f, n]) => `${f}: ${n} console call(s), allowed ${ALLOWED[f] ?? 0}`);
  assert.deepEqual(over, [], "write to the server log instead (logger.error / a log callback)");
  const stale = Object.entries(ALLOWED)
    .filter(([f, n]) => (found[f] ?? 0) < n)
    .map(([f, n]) => `${f}: allowed ${n}, found ${found[f] ?? 0} — lower the number in ALLOWED`);
  assert.deepEqual(stale, [], "the ratchet only goes down");
});
