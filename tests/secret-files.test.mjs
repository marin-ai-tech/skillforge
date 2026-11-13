// publish-secret-files: a secret file (by name) never becomes part of a version. The server refuses it on every path
// (publish, import); the CLI refuses before sending anything — checked against a fake registry that counts requests.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startServer, api, login, toB64, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const md = (name) => `---\nname: ${name}\ndescription: Counts pages of PDF files. Use when a PDF is too long to read.\n---\n\n# ${name}\n\nRun the script.\n`;
let srv;
let admin;

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-secret-files-" });
  assert.ok(srv.up, srv.stderr);
  admin = await login(srv.base, "admin", ADMIN_PASSWORD);
});
after(async () => {
  await srv?.stop();
});

const errorsOf = (data) => [...(data?.errors ?? []), ...(data?.dry_run?.errors ?? [])];

test("publish: a .env in the skill folder is refused with E_SECRET_FILE and its path; no artifact", async () => {
  const r = await api(srv.base, "POST", "/api/v1/artifacts", { type: "skill", files: toB64([{ path: "pdf-env/SKILL.md", content: md("pdf-env") }, { path: "pdf-env/.env", content: "OPENAI_API_KEY=x\n" }]) }, { cookie: admin.cookie });
  assert.ok(r.status >= 400 && r.status < 500, `${r.status} ${JSON.stringify(r.data)}`);
  const err = errorsOf(r.data).find((e) => e.code === "E_SECRET_FILE");
  assert.ok(err, JSON.stringify(r.data));
  assert.equal(err.path, "pdf-env/.env");
  assert.equal((await api(srv.base, "GET", "/api/v1/artifacts/skill/pdf-env", undefined, { cookie: admin.cookie })).status, 404);
});

test("publish: a .env.example template passes (negative case)", async () => {
  const r = await api(srv.base, "POST", "/api/v1/artifacts", { type: "skill", files: toB64([{ path: "pdf-tpl/SKILL.md", content: md("pdf-tpl") }, { path: "pdf-tpl/.env.example", content: "OPENAI_API_KEY=\n" }]) }, { cookie: admin.cookie });
  assert.equal(r.status, 201, JSON.stringify(r.data));
});

test("import: a candidate with a private key fails its dry run with E_SECRET_FILE", async () => {
  const r = await api(srv.base, "POST", "/api/v1/imports/preview", { source: { kind: "files", files: toB64([{ path: "pdf-key/SKILL.md", content: md("pdf-key") }, { path: "pdf-key/certs/server.pem", content: "-----BEGIN PRIVATE KEY-----\n" }]) } }, { cookie: admin.cookie });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const c = r.data.candidates.find((x) => x.id === "skill/pdf-key");
  assert.ok(c, JSON.stringify(r.data.candidates));
  assert.equal(c.dry_run.ok, false);
  assert.ok(c.dry_run.errors.some((e) => e.code === "E_SECRET_FILE"), JSON.stringify(c.dry_run.errors));
});

test("CLI publish and validate: a folder with id_rsa stops before any request, naming the file", async () => {
  let requests = 0;
  const fake = createServer((req, res) => {
    requests++;
    res.writeHead(500).end();
  });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${fake.address().port}`;
  const work = mkdtempSync(join(tmpdir(), "skillforge-secret-cli-"));
  try {
    const dir = join(work, "pdf-ssh");
    mkdirSync(dir);
    writeFileSync(join(dir, "SKILL.md"), md("pdf-ssh"));
    writeFileSync(join(dir, "id_rsa"), "-----BEGIN OPENSSH PRIVATE KEY-----\n");
    const env = { ...process.env, SKILLFORGE_URL: url, SKILLFORGE_TOKEN: "sf_test0000_00000000000000000000000000000000", SKILLFORGE_CONFIG: join(work, "cli.json"), NO_COLOR: "1" };
    for (const cmd of ["publish", "validate"]) {
      const r = spawnSync(process.execPath, [CLI, cmd, dir, "--type", "skill"], { env, encoding: "utf8", timeout: 30_000 });
      assert.equal(r.status, 1, `${cmd}: exit ${r.status}\n${r.stdout}\n${r.stderr}`);
      assert.match(r.stdout + r.stderr, /E_SECRET_FILE/, cmd);
      assert.match(r.stdout + r.stderr, /id_rsa/, cmd);
    }
    assert.equal(requests, 0, "the CLI sent the folder to the registry");
  } finally {
    fake.close();
    rmSync(work, { recursive: true, force: true });
  }
});

test("the browser copy of the rule gives the same answers as core", async () => {
  const core = await import(pathToFileURL(join(ROOT, "packages", "core", "dist", "index.js")).href);
  const web = await import(pathToFileURL(join(ROOT, "packages", "web", "src", "lib", "secret-files.ts")).href);
  const names = [".env", ".env.local", ".env.example", ".env.dist", "a/server.pem", "x.KEY", "store.p12", "id_rsa", "id_rsa.pub", "id_ed25519", "credentials.json", "gcp-credentials.json", "credentials.md", "auth.json", "settings.local.json", "settings.json", ".netrc", ".npmrc", ".git-credentials", "SKILL.md", "env.ts", "keys.md"];
  for (const n of names) assert.equal(web.secretFileReason(n), core.secretFileReason(n), n);
});
