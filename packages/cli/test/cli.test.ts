import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI_SRC = path.join(PKG_ROOT, "src", "index.ts");
const CLI_DIST = path.join(PKG_ROOT, "dist", "index.js");
const CLI = fs.existsSync(CLI_DIST) ? CLI_DIST : CLI_SRC;

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.on("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      if (!addr || typeof addr === "string") {
        s.close();
        rej(new Error("no port"));
        return;
      }
      const { port } = addr;
      s.close(() => res(port));
    });
  });
}

function run(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: PKG_ROOT,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

test("--version prints semver", async () => {
  const { code, stdout } = await run(["--version"]);
  assert.equal(code, 0);
  assert.match(stdout.trim(), /^\d+\.\d+\.\d+/);
});

test("health against closed port exits 1 with URL in stderr", async () => {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const { code, stderr } = await run(["health", "--url", url]);
  assert.equal(code, 1);
  assert.ok(stderr.includes(url), `stderr missing ${url}: ${stderr}`);
});

test("health against buildApp listen port 0 exits 0 with JSON", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-cli-"));
  const webDir = path.join(dataDir, "web");
  fs.mkdirSync(webDir, { recursive: true });
  fs.writeFileSync(
    path.join(webDir, "index.html"),
    "<!doctype html><title>SkillForge</title>SkillForge",
    "utf8",
  );

  const serverMod = await import(
    pathToFileURL(path.resolve(PKG_ROOT, "../server/src/app.ts")).href
  );
  const app = await serverMod.buildApp({
    port: 0,
    host: "127.0.0.1",
    dataDir,
    baseUrl: "http://127.0.0.1:0",
    webDir,
  });

  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address();
  assert.ok(addr && typeof addr !== "string");
  const url = `http://127.0.0.1:${addr.port}`;

  try {
    const { code, stdout } = await run(["health", "--url", url]);
    assert.equal(code, 0, `stdout=${stdout}`);
    const body = JSON.parse(stdout);
    assert.equal(body.status, "ok");
  } finally {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
