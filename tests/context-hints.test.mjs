// `skillforge suggest` suggests internal skills based on project signals: dependencies, file extensions, settings files. The signals
// are collected and compared with the tags of active artifacts locally — only an ordinary catalog request goes to the server;
// without consent the command reads and requests nothing.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, toB64, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
let srv;
let proxy;
let proxyUrl;
const seen = [];
const auth = {};
let work;
let project;
let env;
const call = (method, path, body, who = auth.admin) => api(srv.base, method, path, body, who ? { cookie: who.cookie } : {});

/** CLI with a kill-timeout: a hanging command is a test defect, not a pass. */
function cli(...args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env, cwd: project });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

async function skill(name, tags, activate = true) {
  const md = `---\nname: ${name}\ndescription: Hint probe ${name}. Use when testing hints.\ntags: [${tags.join(", ")}]\n---\n\n# ${name}\n\nSteps.\n`;
  assert.equal((await call("POST", "/api/v1/artifacts", { type: "skill", files: toB64([{ path: `${name}/SKILL.md`, content: md }]) }, auth.lena)).status, 201);
  if (activate) assert.equal((await call("POST", `/api/v1/artifacts/skill/${name}/transitions`, { to: "active", reason: "hints test" }, auth.rita)).status, 200);
}

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-hints-" });
  assert.ok(srv.up, srv.stderr);
  auth.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [["rita", "reviewer"], ["lena", "contributor"]]) {
    await createUser(srv.base, auth.admin.cookie, { username: u, password: `${u}-pw-123456`, role });
    auth[u] = await login(srv.base, u, `${u}-pw-123456`);
  }
  await skill("react-patterns", ["react", "frontend"]);
  await skill("terraform-guard", ["terraform"]);
  await skill("py-testing", ["python", "pytest"]);
  await skill("cobol-helper", ["cobol"]);
  await skill("react-draft", ["react"], false);
  // A recording proxy in front of the registry: what the CLI sends is checked here.
  const target = new URL(srv.base);
  proxy = createServer((req, res) => {
    seen.push({ method: req.method, url: req.url });
    const up = httpRequest({ host: target.hostname, port: target.port, path: req.url, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    req.pipe(up);
  });
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
  work = mkdtempSync(join(tmpdir(), "skillforge-hints-work-"));
  project = join(work, "project");
  mkdirSync(join(project, "infra"), { recursive: true });
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "app", dependencies: { react: "^18.0.0" } }));
  writeFileSync(join(project, "infra", "main.tf"), 'resource "null_resource" "x" {}\n');
  writeFileSync(join(project, "pyproject.toml"), '[project]\nname = "svc"\ndependencies = ["pytest>=8"]\n');
  const tok = (await call("POST", "/api/v1/me/tokens", { name: "hints" }, auth.lena)).data.token;
  env = { ...process.env, SKILLFORGE_URL: proxyUrl, SKILLFORGE_TOKEN: tok, SKILLFORGE_CONFIG: join(work, "cli.json"), NO_COLOR: "1" };
});

after(async () => {
  await new Promise((r) => proxy?.close(r));
  await srv?.stop();
});

test("without consent: explains, reads and requests nothing, exit code 2", async () => {
  const r = await cli("suggest", "--json");
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /--accept/);
  assert.equal(seen.length, 0, "without consent there are no registry requests");
});

test("with consent: skills by project signals, only active ones, with a reason and an install command", async () => {
  const r = await cli("suggest", "--accept", "--json");
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  const names = out.suggestions.map((s) => s.name).sort();
  assert.deepEqual(names, ["py-testing", "react-patterns", "terraform-guard"]);
  const react = out.suggestions.find((s) => s.name === "react-patterns");
  assert.ok(react.matched.includes("react"), JSON.stringify(react));
  assert.match(react.install, /skillforge install skill\/react-patterns/);
  assert.ok(out.signals.includes("terraform") && out.signals.includes("pytest"), JSON.stringify(out.signals));
});

test("project signals are not sent to the server: catalog read only", () => {
  assert.ok(seen.length > 0);
  for (const r of seen) {
    assert.equal(r.method, "GET", JSON.stringify(r));
    assert.ok(!/react|terraform|pytest|python/.test(r.url), `signal in the request: ${r.url}`);
  }
});

test("consent is remembered and can be revoked", async () => {
  const cfg = JSON.parse(readFileSync(join(work, "cli.json"), "utf8"));
  assert.ok(cfg.hints_consent?.accepted_at, JSON.stringify(cfg));
  const again = await cli("suggest", "--json");
  assert.equal(again.status, 0, "consent already given");
  const revoked = await cli("suggest", "--revoke");
  assert.equal(revoked.status, 0, revoked.stderr);
  const before = seen.length;
  assert.equal((await cli("suggest", "--json")).status, 2, "after revoking, consent is needed again");
  assert.equal(seen.length, before);
});
