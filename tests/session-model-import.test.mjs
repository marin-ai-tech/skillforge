// session-fact-model: `sessions import` sends the model that called the skill — Claude Code `message.model` of the
// line with the Skill call (never `<synthetic>`), OpenCode `info.modelID` of the message with the skill part — and
// nothing else about the model: no provider, no tokens, no text. `--no-model` sends no model at all.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api as rawApi, login, createUser, loadDir, toB64, FIXTURES, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const SECRET = "SECRET-MODEL-do-not-upload";
let srv;
let base;
let work;
let token;

function cli(args) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: work,
      env: { ...process.env, SKILLFORGE_CONFIG: join(work, "config.json"), NO_COLOR: "1", SKILLFORGE_URL: base, SKILLFORGE_TOKEN: token, SKILLFORGE_SESSIONS_ROOT: undefined },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), 90000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      res({ code, stdout, stderr });
    });
  });
}

// Claude Code: one JSONL line per record; the Skill call sits in an assistant message that names its model.
const line = (o) => JSON.stringify(o) + "\n";
const skillCall = (sid, t, model) =>
  line({ type: "assistant", timestamp: t, sessionId: sid, message: { role: "assistant", model, usage: { input_tokens: 1234, output_tokens: 56 }, content: [{ type: "tool_use", id: `tu-${sid}-${t}`, name: "Skill", input: { skill: "pdf-tools", args: SECRET } }] } });

function claudeRoot() {
  const root = join(work, "claude");
  mkdirSync(join(root, "-proj"), { recursive: true });
  writeFileSync(join(root, "-proj", "s-opus.jsonl"), skillCall("sess-opus-0001", "2026-11-14T10:00:00.000Z", "claude-opus-5-5"));
  writeFileSync(join(root, "-proj", "s-synth.jsonl"), skillCall("sess-synt-0002", "2026-11-14T10:05:00.000Z", "<synthetic>"));
  return root;
}

// OpenCode: `opencode export` JSON; the assistant message info carries providerID and modelID.
const T0 = Date.parse("2026-11-14T11:00:00.000Z");
function opencodeRoot() {
  const root = join(work, "opencode");
  mkdirSync(root, { recursive: true });
  const sid = "ses_model0001";
  const exp = {
    info: { id: sid, title: SECRET, version: "1.18.34", time: { created: T0 } },
    messages: [
      { info: { id: "msg_u", sessionID: sid, role: "user", time: { created: T0 }, model: { providerID: "opencode", modelID: "deepseek-v4.1-flash-free" } }, parts: [{ type: "text", text: SECRET }] },
      {
        info: { id: "msg_a", sessionID: sid, role: "assistant", providerID: "opencode", modelID: "deepseek-v4.1-flash-free", cost: 0.01, tokens: { input: 999, output: 9 }, time: { created: T0 + 1000 } },
        parts: [{ type: "tool", tool: "skill", callID: "c1", state: { status: "completed", input: { name: "pdf-tools" }, output: SECRET, time: { start: T0 + 2000, end: T0 + 2500 } } }],
      },
    ],
  };
  writeFileSync(join(root, `${sid}.json`), JSON.stringify(exp));
  return root;
}

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-model-import-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  const admin = await login(base, "admin", ADMIN_PASSWORD);
  await createUser(base, admin.cookie, { username: "alice", password: "alice-pw-123", role: "contributor" });
  const alice = await login(base, "alice", "alice-pw-123");
  token = (await rawApi(base, "POST", "/api/v1/me/tokens", { name: "cli" }, { cookie: alice.cookie })).data.token;
  const r = await rawApi(base, "POST", "/api/v1/artifacts", { type: "skill", files: toB64(loadDir(join(FIXTURES, "skill-standard"))) }, { cookie: alice.cookie });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  work = mkdtempSync(join(tmpdir(), "skillforge-model-import-work-"));
});

after(async () => {
  await srv?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

const dry = async (...args) => {
  const r = await cli(["sessions", "import", ...args, "--dry-run", "--json"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  return { out: r.stdout, facts: JSON.parse(r.stdout).facts };
};

test("Claude Code: the model of the line with the Skill call; <synthetic> sends no model; no tokens or text", async () => {
  const { out, facts } = await dry("--root", claudeRoot());
  assert.equal(facts.length, 2, out);
  const byTime = Object.fromEntries(facts.map((f) => [f.used_at, f]));
  assert.equal(byTime["2026-11-14T10:00:00.000Z"].model, "claude-opus-5-5");
  assert.ok(!("model" in byTime["2026-11-14T10:05:00.000Z"]), "a <synthetic> line is not a model");
  for (const word of ["synthetic", "input_tokens", "usage", SECRET]) assert.ok(!out.includes(word), `${word} left the machine`);
});

test("OpenCode: info.modelID of the message with the skill part; no provider, tokens or cost", async () => {
  const { out, facts } = await dry("--harness", "opencode", "--root", opencodeRoot());
  assert.equal(facts.length, 1, out);
  assert.equal(facts[0].model, "deepseek-v4.1-flash-free");
  for (const word of ["providerID", "tokens", "cost", SECRET]) assert.ok(!out.includes(word), `${word} left the machine`);
});

test("--no-model sends no model for either agent", async () => {
  for (const args of [["--root", claudeRoot()], ["--harness", "opencode", "--root", opencodeRoot()]]) {
    const { out, facts } = await dry(...args, "--no-model");
    assert.ok(facts.length > 0, out);
    assert.ok(facts.every((f) => !("model" in f)), out);
    assert.ok(!out.includes("claude-opus") && !out.includes("deepseek"), out);
  }
});
