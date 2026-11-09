// `npm run simulate:mvp` without an
// external server starts the built server on a temporary directory itself, goes through the P0 steps via API and CLI,
// shuts the server down and exits with 0. The independent oracle is a "lying" server (tests/fixtures/simulate/stub-server.mjs):
// against it the simulation must fail, i.e. no step counts 200/404 as success blindly.
// Requires `npm run build`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { ROOT } from "./lib/client.mjs";

const SCRIPT = join(ROOT, "scripts", "simulate-mvp.mjs");
const STUB = join(ROOT, "tests", "fixtures", "simulate", "stub-server.mjs");

/** Runs the simulation without external stand variables; a kill timeout is mandatory. */
function runSimulate(extraEnv = {}, killAfterMs = 240_000) {
  const env = { ...process.env };
  for (const k of ["E2E_PORT", "SIMULATE_BASE_URL", "SIMULATE_ADMIN_PASSWORD", "SEED_DEMO_PASSWORD", "SKILLFORGE_DATA_DIR", "SKILLFORGE_PORT"]) {
    delete env[k];
  }
  Object.assign(env, extraEnv);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill(), killAfterMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, out: code === null ? `${out}\n(the simulation did not finish within ${killAfterMs} ms — killed)` : out });
    });
  });
}

const baseOf = (out) => /simulate-mvp against (http:\/\/127\.0\.0\.1:\d+)/.exec(out)?.[1];

async function serverGone(base) {
  try {
    await fetch(`${base}/api/v1/health`, { signal: AbortSignal.timeout(2000) });
    return false;
  } catch {
    return true;
  }
}

test("without an external stand: its own server, P0 steps via API and CLI, exit code 0, server shut down", { timeout: 300_000 }, async () => {
  const r = await runSimulate();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /summary: (\d+)\/\1 passed/, r.out);
  assert.match(r.out, /\bCLI\b/, "the report has no step via CLI");
  const base = baseOf(r.out);
  assert.ok(base, `the output has no line "simulate-mvp against http://127.0.0.1:<port>": ${r.out}`);
  assert.ok(await serverGone(base), `after the simulation finished the server at ${base} still responds`);
});

test("a lying server answering 200 to everything: the simulation fails", { timeout: 300_000 }, async () => {
  const r = await runSimulate({ SIMULATE_SERVER_ENTRY: STUB, STUB_STATUS: "200" });
  assert.notEqual(r.code, 0, `the simulation passed against the stub server:\n${r.out}`);
  assert.notEqual(r.code, null, r.out);
});

test("a lying server answering 404 to everything: the simulation fails", { timeout: 300_000 }, async () => {
  const r = await runSimulate({ SIMULATE_SERVER_ENTRY: STUB, STUB_STATUS: "404" });
  assert.notEqual(r.code, 0, `the simulation passed against the stub server (404 counted as success?):\n${r.out}`);
  assert.notEqual(r.code, null, r.out);
});
