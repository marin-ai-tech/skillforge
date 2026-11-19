// news-delivery: `skillforge news` reads the registry news with a personal token (`GET /api/v1/news`): a table of date,
// kind, text and link, or the API answer with --json; --unread is what is newer than the reader's mark, --since and
// --kind narrow it; `skillforge news seen` moves the mark. An MCP token gets a message that a personal token is needed
// and exit code 4 (unauthorized). Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
let srv;
let work;
let admin;
let alice;
let aliceToken;
const b64 = (s) => Buffer.from(s).toString("base64");
const skill = (name) => `---\nname: ${name}\ndescription: Does ${name} things. Use when ${name} is needed.\n---\n\n# ${name}\n\nBody.\n`;

function cli(args, token = aliceToken) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: work,
      env: { ...process.env, SKILLFORGE_URL: srv.base, SKILLFORGE_TOKEN: token, SKILLFORGE_CONFIG: join(work, "cli.json"), NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), 20000);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr: code === null ? `${stderr}\n(killed after 20 s)` : stderr });
    });
  });
}
async function activeSkill(name) {
  const r = await api(srv.base, "POST", "/api/v1/artifacts", { type: "skill", files: [{ path: `${name}/SKILL.md`, content_base64: b64(skill(name)) }] }, { cookie: admin.cookie });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const t = await api(srv.base, "POST", `/api/v1/artifacts/skill/${name}/transitions`, { to: "active", reason: "cli news test" }, { cookie: admin.cookie });
  assert.equal(t.status, 200, JSON.stringify(t.data));
}
const json = (r) => {
  assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
  return JSON.parse(r.stdout);
};

before(async () => {
  work = mkdtempSync(join(tmpdir(), "skillforge-cli-news-"));
  srv = await startServer({}, { prefix: "skillforge-cli-news-" });
  assert.ok(srv.up, srv.stderr);
  admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  await createUser(srv.base, admin.cookie, { username: "alice", password: "alice-pw-123456", role: "contributor" });
  alice = await login(srv.base, "alice", "alice-pw-123456");
  aliceToken = (await api(srv.base, "POST", "/api/v1/me/tokens", { name: "cli" }, { cookie: alice.cookie })).data.token;
  await activeSkill("pdf");
  assert.equal((await api(srv.base, "POST", "/api/v1/news/posts", { title: "Registry upgrade", body: "Friday." }, { cookie: admin.cookie })).status, 201);
});

after(async () => {
  if (srv?.up) await srv.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("a table by default: date, kind, text and link of each item", async () => {
  const r = await cli(["news"]);
  assert.equal(r.code, 0, r.stderr);
  const line = r.stdout.split("\n").find((l) => l.includes("pdf"));
  assert.ok(line, r.stdout);
  assert.match(line, /\d{4}-\d{2}-\d{2}/, "no date");
  assert.match(line, /new_artifact/);
  assert.match(line, /\/artifacts\/skill\/pdf/, "no link");
  assert.ok(r.stdout.includes("Registry upgrade"));
});

test("--json is the API answer; --kind and --limit narrow it", async () => {
  const all = json(await cli(["news", "--json"]));
  assert.ok(Array.isArray(all.items) && "unread_count" in all && "next_cursor" in all, JSON.stringify(all).slice(0, 200));
  const posts = json(await cli(["news", "--kind", "post", "--json"]));
  assert.ok(posts.items.length > 0 && posts.items.every((i) => i.kind === "post"));
  assert.equal(json(await cli(["news", "--limit", "1", "--json"])).items.length, 1);
  assert.deepEqual(json(await cli(["news", "--since", new Date(Date.now() + 60_000).toISOString(), "--json"])).items, []);
});

test("unread from the terminal: two new items, then seen, then nothing; exit code 0", async () => {
  assert.equal((await cli(["news", "seen"])).code, 0);
  await activeSkill("grep");
  await activeSkill("csv");
  const before = json(await cli(["news", "--unread", "--json"]));
  assert.deepEqual(before.items.map((i) => i.artifact?.name).sort(), ["csv", "grep"]);
  const seen = await cli(["news", "seen"]);
  assert.equal(seen.code, 0, seen.stderr);
  assert.deepEqual(json(await cli(["news", "--unread", "--json"])).items, []);
});

test("an MCP token: a message that a personal token is needed, exit code 4", async () => {
  const mcp = (await api(srv.base, "POST", "/api/v1/me/tokens", { name: "agent", mcp: true }, { cookie: alice.cookie })).data.token;
  const r = await cli(["news"], mcp);
  assert.equal(r.code, 4, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /personal (API )?token/i);
});
