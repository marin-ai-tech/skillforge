// Acceptance tests for agent-folder snapshots of Codex, Cursor, OpenCode and Qwen Code: recognition of client directories,
// reverse translation of native formats (Codex TOML agent, TOML command, agent without name, Qwen Code command with {{args}}),
// checking a translated install against the lock (the "install --runtime -> agent scan -> in_sync" round trip), negative cases
// (modified install, forged lock, broken TOML, unknown label). Native-format fixtures are in tests/fixtures/agent-clients (explicit list).
// Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { startServer, api, login, createUser, loadDir, toB64, FIXTURES, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const NATIVE = join(ROOT, "tests", "fixtures", "agent-clients");
const native = (rel) => readFileSync(join(NATIVE, ...rel.split("/")));
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

let srv;
let base;
let work;
const U = {};
const call = (who, method, path, body) => api(base, method, path, body, { cookie: U[who].cookie });

function sf(args, cwd) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: { ...process.env, SKILLFORGE_CONFIG: join(work, "config.json"), SKILLFORGE_URL: undefined, SKILLFORGE_TOKEN: undefined, HOME: join(work, "home"), USERPROFILE: join(work, "home"), NO_COLOR: "1" },
    encoding: "utf8",
    timeout: 60_000,
  });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function project(name) {
  const d = join(work, name);
  mkdirSync(d, { recursive: true });
  return d;
}

const byKey = (data, key) => data.items.find((i) => i.key === key);

function splitMd(text) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"));
  assert.ok(m, `no frontmatter: ${text}`);
  return { fm: parseYaml(m[1]), body: m[2] };
}

/** Publishes an item from alice's snapshot and returns the canonical file text from the registry. */
async function publishedText(agent, type, name) {
  const p = await call("alice", "POST", `/api/v1/me/agents/${agent}/items/${type}/${name}/publish`, {});
  assert.equal(p.status, 201, JSON.stringify(p.data));
  const file = type === "agent" ? `agents/${name}.md` : `commands/${name}.md`;
  const r = await fetch(`${base}/api/v1/artifacts/${type}/${name}/versions/latest/files/${file}`);
  assert.equal(r.status, 200, `${type}/${name}: file ${file}`);
  return r.text();
}

async function publishActive(body, type, name) {
  const p = await call("admin", "POST", "/api/v1/artifacts", body);
  assert.equal(p.status, 201, JSON.stringify(p.data));
  const t = await call("admin", "POST", `/api/v1/artifacts/${type}/${name}/transitions`, { to: "active", reason: "import test" });
  assert.equal(t.status, 200);
}

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-agent-clients-import-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  work = mkdtempSync(join(tmpdir(), "skillforge-agent-clients-import-"));
  mkdirSync(join(work, "home"), { recursive: true });
  U.admin = await login(base, "admin", ADMIN_PASSWORD);
  for (const u of ["alice", "bob", "lena"]) {
    await createUser(base, U.admin.cookie, { username: u, password: `${u}-pw-123`, role: "contributor" });
    U[u] = await login(base, u, `${u}-pw-123`);
  }
  const tok = await call("alice", "POST", "/api/v1/me/tokens", { name: "cli" });
  assert.equal(tok.status, 201);
  writeFileSync(join(work, "config.json"), JSON.stringify({ registries: { local: { url: base, token: tok.data.token } }, default: "local" }));

  await publishActive({ type: "skill", files: toB64(loadDir(join(FIXTURES, "skill-standard"))) }, "skill", "pdf-tools");
  const cmd = `---\ndescription: Summarizes the given file for a changelog entry.\nargument-hint: <file>\n---\n\nSummarize $ARGUMENTS in one line for the changelog.\n`;
  await publishActive({ type: "command", files: [{ path: "summarize.md", content_base64: Buffer.from(cmd).toString("base64") }] }, "command", "summarize");
  const quirky = "---\nname: quirky-agent\ndescription: Probe agent with Claude-only keys.\ntools: Read, Grep, Bash\nmodel: sonnet\ncolor: blue\n---\nYou are a probe. Keep ''' and \"\"\" and \\ intact.\n";
  await publishActive({ type: "agent", files: [{ path: "quirky-agent.md", content_base64: Buffer.from(quirky).toString("base64") }] }, "agent", "quirky-agent");

  assert.equal((await call("admin", "POST", "/api/v1/teams", { name: "imp-team", lead: "lena" })).status, 201);
  const team = await call("lena", "POST", "/api/v1/artifacts", {
    type: "skill", version: "0.1.0", visibility: "team", owner_team: "imp-team",
    files: toB64([{ path: "team-secret/SKILL.md", content: "---\nname: team-secret\ndescription: Team only.\n---\nSecret.\n" }]),
  });
  assert.equal(team.status, 201, JSON.stringify(team.data));
  U.teamDigest = team.data.digest ?? (await call("lena", "GET", "/api/v1/artifacts/skill/team-secret")).data.latest.digest;
  assert.ok(U.teamDigest, "digest of the team artifact");
});

after(async () => {
  if (srv?.up) await srv.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("runtime label: any runtime from the table and generic are accepted, an unknown one gives 400", async () => {
  for (const runtime of ["opencode", "codex", "cursor", "qwen", "gemini", "generic"]) {
    const r = await call("alice", "PUT", `/api/v1/me/agents/rt-${runtime}`, { runtime, files: toB64([{ path: "README.md", content: "x" }]) });
    assert.equal(r.status, 200, `${runtime}: ${JSON.stringify(r.data)}`);
  }
  const bad = await call("alice", "PUT", "/api/v1/me/agents/rt-vim", { runtime: "vim", files: [] });
  assert.equal(bad.status, 400);
});

test("project with four clients' directories: directories recognized, a stray agents/ goes to skipped", async () => {
  const files = [
    { path: ".codex/agents/reviewer.toml", content: native("codex/agents/reviewer.toml") },
    { path: ".opencode/agent/planner.md", content: native("opencode/agent/planner.md") },
    { path: ".qwen/commands/summarize.toml", content: native("qwen/commands/summarize.toml") },
    { path: ".cursor/agents/helper.md", content: native("cursor/agents/helper.md") },
    ...loadDir(join(FIXTURES, "skill-standard")).map((f) => ({ path: `.qwen/skills/${f.path}`, content: f.content })),
    { path: "notes/agents/draft.md", content: "---\nname: draft\ndescription: Not an agent dir.\n---\nDraft.\n" },
  ];
  const r = await call("alice", "PUT", "/api/v1/me/agents/proj", { runtime: "generic", files: toB64(files) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  for (const key of ["agent/reviewer", "agent/planner", "command/summarize", "agent/helper", "skill/pdf-tools"]) {
    assert.ok(byKey(r.data, key), `missing ${key}: ${JSON.stringify(r.data.items.map((i) => i.key))} invalid=${JSON.stringify(r.data.invalid)}`);
  }
  assert.ok(!byKey(r.data, "agent/draft"), "notes/agents/ is not an agent directory");
  assert.ok(r.data.skipped.some((s) => s.path === "notes/agents/draft.md"), JSON.stringify(r.data.skipped));
  assert.deepEqual(r.data.invalid, []);
});

test("reverse translation: Codex TOML agent, TOML command, OpenCode agent without name become the canonical format", async () => {
  const files = [
    { path: "agents/reviewer.toml", content: native("codex/agents/reviewer.toml") },
    { path: "agent/planner.md", content: native("opencode/agent/planner.md") },
    { path: "commands/summarize-q.toml", content: native("qwen/commands/summarize.toml") },
  ];
  const r = await call("alice", "PUT", "/api/v1/me/agents/native", { runtime: "generic", files: toB64(files) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.invalid, []);

  const reviewer = splitMd(await publishedText("native", "agent", "reviewer"));
  assert.deepEqual({ name: reviewer.fm.name, description: reviewer.fm.description }, { name: "reviewer", description: "Reviews diffs." });
  assert.equal(reviewer.body.replace(/^\n/, ""), 'Review the diff.\nQuote "exactly" and keep \\ backslashes.\n');

  const planner = splitMd(await publishedText("native", "agent", "planner"));
  assert.equal(planner.fm.name, "planner", "name taken from the file name");
  assert.equal(planner.fm.description, "Plans work before coding.");
  assert.ok(planner.body.includes("Plan the work step by step."));

  const cmd = splitMd(await publishedText("native", "command", "summarize-q"));
  assert.equal(cmd.fm.description, "Summarizes the given file for a changelog entry.");
  assert.ok(cmd.body.includes("Summarize $ARGUMENTS in one line"), cmd.body);
  assert.ok(!cmd.body.includes("{{args}}"));
});

test("Qwen Code command with {{args}}: translated only with the qwen label", async () => {
  const text = "---\ndescription: Explains the given topic.\n---\nExplain {{args}} briefly.\n";
  const q = await call("alice", "PUT", "/api/v1/me/agents/qw", { runtime: "qwen", files: toB64([{ path: "commands/explain-q.md", content: text }]) });
  assert.equal(q.status, 200, JSON.stringify(q.data));
  const qBody = splitMd(await publishedText("qw", "command", "explain-q")).body;
  assert.ok(qBody.includes("Explain $ARGUMENTS briefly."), qBody);

  const c = await call("alice", "PUT", "/api/v1/me/agents/cc", { runtime: "claude-code", files: toB64([{ path: "commands/explain-c.md", content: text }]) });
  assert.equal(c.status, 200);
  const cBody = splitMd(await publishedText("cc", "command", "explain-c")).body;
  assert.ok(cBody.includes("Explain {{args}} briefly."), "without the qwen label the text is unchanged");
});

test("broken TOML: 200, candidate goes to invalid, the rest is kept", async () => {
  const files = [
    { path: "agents/broken.toml", content: native("broken/agents/broken.toml") },
    { path: "agents/helper.md", content: native("cursor/agents/helper.md") },
  ];
  const r = await call("alice", "PUT", "/api/v1/me/agents/broken", { runtime: "codex", files: toB64(files) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(byKey(r.data, "agent/helper"), "neighboring agent is kept");
  const bad = r.data.invalid.find((i) => JSON.stringify(i).includes("broken"));
  assert.ok(bad, JSON.stringify(r.data.invalid));
  assert.ok(bad.errors.length > 0);
});

const CIRCLE = {
  codex: { dir: ".codex", keys: ["skill/pdf-tools", "agent/quirky-agent"], translated: ["agent/quirky-agent"] },
  cursor: { dir: ".cursor", keys: ["skill/pdf-tools", "agent/quirky-agent", "command/summarize"], translated: ["agent/quirky-agent", "command/summarize"] },
  opencode: { dir: ".opencode", keys: ["skill/pdf-tools", "agent/quirky-agent", "command/summarize"], translated: ["agent/quirky-agent", "command/summarize"] },
  qwen: { dir: ".qwen", keys: ["skill/pdf-tools", "agent/quirky-agent", "command/summarize"], translated: ["command/summarize"] },
};

for (const [runtime, spec] of Object.entries(CIRCLE)) {
  test(`${runtime} round trip: install -> agent scan -> in_sync, translated items are marked translated`, () => {
    const proj = project(`circle-${runtime}`);
    for (const key of spec.keys) {
      const i = sf(["install", key, "--runtime", runtime], proj);
      assert.equal(i.code, 0, `${key}: ${i.out}\n${i.err}`);
    }
    const s = sf(["agent", "scan", "--runtime", runtime, "--name", `circle-${runtime}`, "--json"], proj);
    assert.equal(s.code, 0, `${s.out}\n${s.err}`);
    const data = JSON.parse(s.out);
    for (const key of spec.keys) {
      const item = byKey(data, key);
      assert.ok(item, `${runtime}: missing ${key}: ${JSON.stringify(data.items?.map((x) => x.key))} invalid=${JSON.stringify(data.invalid)}`);
      assert.equal(item.status, "in_sync", `${runtime} ${key}: ${JSON.stringify(item)}`);
      assert.equal(item.translated === true, spec.translated.includes(key), `${runtime} ${key}: translated=${item.translated}`);
    }
    assert.equal(data.summary.modified, 0, JSON.stringify(data.summary));
    assert.deepEqual(data.invalid ?? [], []);
  });
}

test("modified translated install is modified without translated", () => {
  const proj = project("circle-opencode-edit");
  assert.equal(sf(["install", "agent/quirky-agent", "--runtime", "opencode"], proj).code, 0);
  const file = join(proj, ".opencode", "agents", "quirky-agent.md");
  writeFileSync(file, readFileSync(file, "utf8").replace("You are a probe.", "You are an edited probe."));
  const s = sf(["agent", "scan", "--runtime", "opencode", "--name", "edited", "--json"], proj);
  assert.equal(s.code, 0, s.err);
  const item = byKey(JSON.parse(s.out), "agent/quirky-agent");
  assert.equal(item.status, "modified", JSON.stringify(item));
  assert.ok(!item.translated, "translated is not set when it does not match the lock");
});

test("empty files entry in the lock is not a match (digest is not substituted)", async () => {
  const lock = { registry: base, artifacts: { "skill/pdf-tools": { version: "0.1.0", digest: "", files: {}, installed_at: "2026-10-15T00:00:00.000Z" } } };
  const files = loadDir(join(FIXTURES, "skill-standard")).map((f) => ({ path: `skills/${f.path}`, content: f.content }));
  const r = await call("alice", "PUT", "/api/v1/me/agents/empty-lock", { runtime: "claude-code", files: toB64(files), lock });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const item = byKey(r.data, "skill/pdf-tools");
  assert.equal(item.status, "in_sync", "plain comparison by content digest");
  assert.ok(!item.translated);
});

test("a forged lock does not reveal an invisible team artifact", async () => {
  const content = Buffer.from("---\nname: team-secret\ndescription: Bob's guess.\n---\nGuess.\n");
  const lock = {
    registry: base,
    artifacts: { "skill/team-secret": { version: "0.1.0", digest: U.teamDigest, files: { "skills/team-secret/SKILL.md": sha(content) }, installed_at: "2026-10-15T00:00:00.000Z" } },
  };
  const r = await call("bob", "PUT", "/api/v1/me/agents/forged", { runtime: "codex", files: toB64([{ path: "skills/team-secret/SKILL.md", content }]), lock });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const item = byKey(r.data, "skill/team-secret");
  assert.equal(item.status, "local_only", JSON.stringify(item));
  assert.equal(item.registry, null);
  const g = await call("bob", "GET", "/api/v1/me/agents/forged");
  assert.ok(!JSON.stringify(g.data).includes("imp-team"), "team artifact details are not disclosed");
});

// Attack case: a candidate matching the lock bypasses the parser, and the Codex agent name is taken from the TOML;
// an invalid name must not reach the snapshot by bypassing the name check.
test("the lock does not let an invalid TOML name into the snapshot", async () => {
  const toml = 'name = "../../Evil Name"\ndescription = "x"\ndeveloper_instructions = "y"\n';
  const lock = {
    registry: base,
    artifacts: { "agent/../../Evil Name": { version: "9.9.9", digest: "deadbeef", files: { "agents/evil.toml": sha(Buffer.from(toml)) }, runtime: "codex" } },
  };
  const r = await call("alice", "PUT", "/api/v1/me/agents/evil-name", { runtime: "codex", files: toB64([{ path: "agents/evil.toml", content: toml }]), lock });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.items.map((i) => i.key), [], JSON.stringify(r.data.items));
  assert.ok(r.data.invalid.some((i) => JSON.stringify(i).includes("evil")), JSON.stringify(r.data.invalid));
});

test("agent scan --runtime qwen without dir picks .qwen, not .claude", () => {
  const proj = project("default-dir");
  cpSync(join(FIXTURES, "skill-standard", "pdf-tools"), join(proj, ".qwen", "skills", "pdf-tools"), { recursive: true });
  mkdirSync(join(proj, ".claude", "skills", "local-notes"), { recursive: true });
  writeFileSync(join(proj, ".claude", "skills", "local-notes", "SKILL.md"), "---\nname: local-notes\ndescription: Claude only.\n---\nNotes.\n");
  const s = sf(["agent", "scan", "--runtime", "qwen", "--name", "q-default", "--json"], proj);
  assert.equal(s.code, 0, `${s.out}\n${s.err}`);
  const data = JSON.parse(s.out);
  assert.ok(byKey(data, "skill/pdf-tools"), JSON.stringify(data.items.map((i) => i.key)));
  assert.ok(!byKey(data, "skill/local-notes"), ".claude was picked instead of .qwen");
});
