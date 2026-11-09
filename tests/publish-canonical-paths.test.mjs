// Acceptance tests for canonical paths: a skill is published under the same paths that MCP returns.
// Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, api, login, ADMIN_PASSWORD } from "./lib/client.mjs";

const SKILL = "---\nname: round-trip\ndescription: Skill for the canonical path round trip. Use when the user asks for round trips.\n---\n\n# round-trip\n\nSee references/notes.md.\n";
const NOTES = "# Notes\n\nBody.\n";
const b64 = (s) => Buffer.from(s).toString("base64");

let srv;
let base;
let admin;

const validate = (files, name) => api(base, "POST", "/api/v1/artifacts/validate", { type: "skill", files, ...(name ? { name } : {}) }, { cookie: admin.cookie });
const codes = (issues) => (issues ?? []).map((i) => i.code);

async function mcpCall(token, name, args) {
  const r = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  return (await r.json()).result.structuredContent;
}

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-canonpath-" });
  assert.ok(srv.up, srv.stderr);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
});

after(async () => {
  if (srv?.up) await srv.stop();
});

test("round trip: files from MCP pass validation without errors and give the same digest", async () => {
  const files = [
    { path: "round-trip/SKILL.md", content_base64: b64(SKILL) },
    { path: "round-trip/references/notes.md", content_base64: b64(NOTES) },
  ];
  const pub = await api(base, "POST", "/api/v1/artifacts", { type: "skill", files }, { cookie: admin.cookie });
  assert.equal(pub.status, 201, JSON.stringify(pub.data));
  const t = await api(base, "POST", "/api/v1/artifacts/skill/round-trip/transitions", { to: "active", reason: "fixture" }, { cookie: admin.cookie });
  assert.equal(t.status, 200, JSON.stringify(t.data));
  const tok = await api(base, "POST", "/api/v1/me/tokens", { name: "agent", mcp: true }, { cookie: admin.cookie });

  const got = await mcpCall(tok.data.token, "get_artifact", { type: "skill", name: "round-trip" });
  const fromMcp = [];
  for (const f of got.files) {
    assert.match(f.path, /^skills\/round-trip\//);
    const read = await mcpCall(tok.data.token, "read_artifact_file", { type: "skill", name: "round-trip", path: f.path });
    fromMcp.push({ path: f.path, content_base64: b64(read.text) });
  }

  const v = await validate(fromMcp);
  assert.equal(v.status, 200, JSON.stringify(v.data));
  assert.deepEqual(codes(v.data.errors), []);
  assert.ok(!codes(v.data.warnings).includes("W_SINGLE_FILE_SKILL"), JSON.stringify(v.data.warnings));

  // Those bytes under those paths are the same bundle: the registry refuses it as an already published digest.
  const again = await api(base, "POST", "/api/v1/artifacts", { type: "skill", files: fromMcp, version: "0.2.0" }, { cookie: admin.cookie });
  assert.equal(again.status, 409, JSON.stringify(again.data));
  assert.equal(again.data.error, "digest_exists");
});

test("a foreign name under the canonical prefix: the error names both valid paths", async () => {
  const v = await validate([{ path: "skills/other/SKILL.md", content_base64: b64(SKILL) }]);
  const err = (v.data.errors ?? []).find((e) => e.code === "E_NAME_DIR_MISMATCH");
  assert.ok(err, JSON.stringify(v.data));
  assert.match(err.message, /round-trip\/SKILL\.md/);
  assert.match(err.message, /skills\/round-trip\/SKILL\.md/);
});

test("a plain root with a foreign name: the error also names the valid paths", async () => {
  const v = await validate([{ path: "wrong-dir/SKILL.md", content_base64: b64(SKILL) }]);
  const err = (v.data.errors ?? []).find((e) => e.code === "E_NAME_DIR_MISMATCH");
  assert.ok(err, JSON.stringify(v.data));
  assert.match(err.message, /skills\/round-trip\/SKILL\.md/);
});

test("negative cases: two different directories under skills/ are not merged; a skill named skills is not broken", async () => {
  const two = await validate([
    { path: "skills/a/SKILL.md", content_base64: b64(SKILL) },
    { path: "skills/b/notes.md", content_base64: b64(NOTES) },
  ]);
  assert.ok(codes(two.data.errors).length > 0, JSON.stringify(two.data));

  const named = SKILL.replace("name: round-trip", "name: skills");
  const v = await validate([{ path: "skills/SKILL.md", content_base64: b64(named) }]);
  assert.deepEqual(codes(v.data.errors), [], JSON.stringify(v.data));
  assert.ok(v.data.canonical_files?.every?.((f) => f.path.startsWith("skills/skills/")) ?? true);
});

test("regression: the agents/<name>.md path is still accepted", async () => {
  const agent = "---\nname: canon-agent\ndescription: Agent for the canonical path regression. Use when the user asks for it.\n---\n\nDo the task.\n";
  const v = await api(base, "POST", "/api/v1/artifacts/validate", { type: "agent", files: [{ path: "agents/canon-agent.md", content_base64: b64(agent) }] }, { cookie: admin.cookie });
  assert.deepEqual(codes(v.data.errors), [], JSON.stringify(v.data));
});
