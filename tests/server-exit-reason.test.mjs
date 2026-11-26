// fix-server-exit-reason (#214): the server's own log says why the process stopped - a signal, a crash or a failed
// start - so an administrator does not have to guess. A real server process; the crash comes from a module the test
// loads with `node --import`, so the product has no test-only code.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SERVER, ROOT, ADMIN_PASSWORD, freePort } from "./lib/client.mjs";

const SECRET = "Bearer crash-secret-1234567890";
const scratch = mkdtempSync(join(tmpdir(), "skillforge-exit-reason-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

/** A module that waits until the server answers on its port and then fails the way `kind` says. */
function crashModule(kind) {
  const file = join(scratch, `crash-${kind}.mjs`);
  const fail =
    kind === "uncaught_exception"
      ? `setTimeout(() => { throw new Error("boom ${SECRET}"); }, 0);`
      : `Promise.reject(new Error("boom ${SECRET}"));`;
  writeFileSync(
    file,
    `const url = "http://127.0.0.1:" + process.env.SKILLFORGE_PORT + "/api/v1/health";
const tick = async () => {
  try { if ((await fetch(url)).status === 200) { ${fail} return; } } catch {}
  setTimeout(tick, 100);
};
setTimeout(tick, 100);
`,
  );
  return pathToFileURL(file).href;
}

/** Starts the built server; resolves `{ exit, logs }` helpers. Every wait has a kill-timeout. */
async function start({ importUrl, port } = {}) {
  const dataDir = mkdtempSync(join(scratch, "data-"));
  const p = port ?? (await freePort());
  const args = importUrl ? ["--import", importUrl, SERVER] : [SERVER];
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, SKILLFORGE_PORT: String(p), SKILLFORGE_HOST: "127.0.0.1", SKILLFORGE_DATA_DIR: dataDir, SKILLFORGE_ADMIN_PASSWORD: ADMIN_PASSWORD },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  const killer = setTimeout(() => child.kill("SIGKILL"), 45_000);
  const exited = new Promise((r) => child.on("exit", (code) => { clearTimeout(killer); r(code); }));
  const logs = () => {
    const file = join(dataDir, "logs", "skillforge.log");
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  };
  const listening = async () => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && child.exitCode === null) {
      if (stdout.includes("SkillForge listening on")) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  };
  return { child, exited, logs, listening, out: () => stdout + stderr };
}

const byMsg = (records, msg) => records.filter((r) => r.msg === msg);

test("SIGTERM: server_stopping with the signal, then server_exit with code 0", { skip: process.platform === "win32" && "Node cannot deliver SIGTERM to a process on Windows; checked by hand there (task 5.2)" }, async () => {
  const s = await start();
  assert.ok(await s.listening(), s.out());
  s.child.kill("SIGTERM");
  assert.equal(await s.exited, 0, s.out());
  const logs = s.logs();
  assert.equal(byMsg(logs, "server_stopping")[0]?.signal, "SIGTERM", JSON.stringify(logs));
  assert.equal(byMsg(logs, "server_exit")[0]?.code, 0, JSON.stringify(logs));
  assert.equal(byMsg(logs, "server_crashed").length, 0, "a requested stop is not a crash");
});

for (const kind of ["uncaught_exception", "unhandled_rejection"]) {
  test(`${kind} after the start: exit 1, server_crashed with the stack and a masked secret, then server_exit 1`, async () => {
    const s = await start({ importUrl: crashModule(kind) });
    assert.equal(await s.exited, 1, s.out());
    const logs = s.logs();
    const crash = byMsg(logs, "server_crashed");
    assert.equal(crash.length, 1, `exactly one crash record: ${JSON.stringify(logs)}`);
    assert.equal(crash[0].kind, kind);
    assert.match(crash[0].error, /boom/);
    assert.match(String(crash[0].stack), /crash-/, "the stack names where it failed");
    const text = JSON.stringify(crash[0]);
    assert.ok(!text.includes("crash-secret-1234567890"), `the secret is masked: ${text}`);
    assert.equal(byMsg(logs, "server_exit")[0]?.code, 1, JSON.stringify(logs));
  });
}

test("a failed start (the port is taken): server_crashed start_failed, exit 1", async () => {
  const port = await freePort();
  const blocker = createServer().listen(port, "127.0.0.1");
  await new Promise((r) => blocker.once("listening", r));
  try {
    const s = await start({ port });
    assert.equal(await s.exited, 1, s.out());
    const crash = byMsg(s.logs(), "server_crashed");
    assert.equal(crash[0]?.kind, "start_failed", JSON.stringify(s.logs()));
    assert.match(crash[0].error, /EADDRINUSE/);
  } finally {
    blocker.close();
  }
});

test("negative case: a server that just runs writes no stop, crash or exit record", async () => {
  const s = await start();
  assert.ok(await s.listening(), s.out());
  await new Promise((r) => setTimeout(r, 500));
  const logs = s.logs();
  for (const msg of ["server_stopping", "server_crashed", "server_exit"]) assert.equal(byMsg(logs, msg).length, 0, `${msg}: ${JSON.stringify(logs)}`);
  s.child.kill("SIGKILL");
  await s.exited;
});
