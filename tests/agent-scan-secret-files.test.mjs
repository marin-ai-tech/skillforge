// `skillforge agent scan` must send only artifact files to the server, never other files from the agent directory
// (settings.local.json, .credentials.json, auth.json, config.toml, .env).
// The server here is a stub that only records request bodies: the test checks what goes over the network,
// not what the server later stored. Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const FIXTURE = join(ROOT, "tests", "fixtures", "agents", "with-secrets");
const EXPECTED = JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "agents", "with-secrets.expected.json"), "utf8"));
const KILL_MS = 30_000;

let stub;
let base;
let work;
const requests = [];

const COMPARE = {
  agent: { id: "a1", name: "laptop", kind: "upload", runtime: null, server_path: null, scanned_at: "2026-11-09T00:00:00.000Z" },
  summary: { local_only: 0, in_sync: 0, outdated: 0, modified: 0, registry_only: 0 },
  items: [],
  registry_only: [],
  duplicates: [],
  skipped: [],
  invalid: [],
};

function cli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: work,
      env: {
        ...process.env,
        SKILLFORGE_CONFIG: join(work, "config.json"),
        SKILLFORGE_URL: base,
        SKILLFORGE_TOKEN: "sf_test_token",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), KILL_MS);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

before(async () => {
  stub = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, body });
      if (req.method === "PUT" && req.url.startsWith("/api/v1/me/agents/")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(COMPARE));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
    });
  });
  await new Promise((r) => stub.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${stub.address().port}`;
  work = mkdtempSync(join(tmpdir(), "skillforge-scan-secrets-"));
});

after(async () => {
  await new Promise((r) => stub.close(r));
  if (work) rmSync(work, { recursive: true, force: true });
});

const puts = () => requests.filter((r) => r.method === "PUT");

test("agent scan sends only artifact files; secrets and other files stay on the machine", async () => {
  requests.length = 0;
  const r = await cli(["agent", "scan", FIXTURE, "--name", "laptop"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(puts().length, 1, JSON.stringify(requests.map((q) => `${q.method} ${q.url}`)));
  const raw = puts()[0].body;
  const sent = JSON.parse(raw).files.map((f) => f.path).sort();
  assert.deepEqual(sent, [...EXPECTED.upload].sort());
  assert.ok(!raw.includes("FAKE-SECRET-"), "request body contains content of a file outside the artifacts");
  // base64 of the content must not appear either: check the encoded form of each secret file too.
  for (const p of EXPECTED.not_sent) {
    const b64 = readFileSync(join(FIXTURE, p)).toString("base64");
    assert.ok(!raw.includes(b64), `content of ${p} went out as base64`);
    assert.ok(!raw.includes(`"${p}"`), `path ${p} went to the server`);
  }
  assert.match(r.stdout, /not sent: 7 file\(s\) outside artifacts/);
});

test("agent scan --json: the list of unsent paths stays local, in the CLI output", async () => {
  requests.length = 0;
  const r = await cli(["agent", "scan", FIXTURE, "--name", "laptop", "--json"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual([...out.not_sent].sort(), [...EXPECTED.not_sent].sort());
  assert.ok(!puts()[0].body.includes("not_sent"));
});

test("directory without artifacts: exit code 1, no server contact", async () => {
  requests.length = 0;
  const dir = join(work, "only-secrets");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "settings.local.json"), '{ "env": { "API_TOKEN": "FAKE-SECRET-only-0008" } }\n');
  writeFileSync(join(dir, ".env"), "TOKEN=FAKE-SECRET-only-0009\n");
  const r = await cli(["agent", "scan", dir, "--name", "empty"]);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.equal(puts().length, 0);
  assert.ok(!(r.stdout + r.stderr).includes("FAKE-SECRET-"));
});
