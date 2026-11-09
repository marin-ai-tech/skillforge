// Acceptance tests for MCP artifact files: sums and a binary-file flag in get_artifact,
// reading a binary file as base64, record_usage accepting extra fields.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { startServer, api, login, ADMIN_PASSWORD } from "./lib/client.mjs";

// A real-size binary file; the starter pack no longer ships images.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(2 * 1024 * 1024)]);
const BIG = randomBytes(4 * 1024 * 1024 + 10); // above the 4 MiB ceiling
const SKILL_MD = "---\nname: bin-skill\ndescription: Skill with binary assets for MCP file checks. Use when the user asks for covers.\n---\n\n# bin-skill\n\nSee assets/cover.png.\n";
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

let srv;
let base;
let admin;
let mcp;

async function call(name, args) {
  const r = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${mcp}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  assert.equal(r.status, 200);
  const json = await r.json();
  assert.equal(json.error, undefined, JSON.stringify(json));
  return json.result;
}

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-mcpfiles-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  const files = [
    { path: "SKILL.md", content_base64: Buffer.from(SKILL_MD).toString("base64") },
    { path: "assets/cover.png", content_base64: PNG.toString("base64") },
    { path: "assets/big.bin", content_base64: BIG.toString("base64") },
  ];
  const pub = await api(base, "POST", "/api/v1/artifacts", { type: "skill", files }, { cookie: admin.cookie });
  assert.equal(pub.status, 201, JSON.stringify(pub.data));
  const pub2 = await api(base, "POST", "/api/v1/artifacts", { type: "skill", files: [{ path: "SKILL.md", content_base64: Buffer.from(SKILL_MD.replaceAll("bin-skill", "draft-skill")).toString("base64") }] }, { cookie: admin.cookie });
  assert.equal(pub2.status, 201, JSON.stringify(pub2.data));
  const t = await api(base, "POST", "/api/v1/artifacts/skill/bin-skill/transitions", { to: "active", reason: "fixture" }, { cookie: admin.cookie });
  assert.equal(t.status, 200, JSON.stringify(t.data));
  const tok = await api(base, "POST", "/api/v1/me/tokens", { name: "agent", mcp: true }, { cookie: admin.cookie });
  assert.equal(tok.status, 201);
  mcp = tok.data.token;
});

after(async () => {
  if (srv?.up) await srv.stop();
});

test("get_artifact: version digest and sha256 of each file as in the registry; binary for PNG", async () => {
  const res = await call("get_artifact", { type: "skill", name: "bin-skill" });
  assert.notEqual(res.isError, true, JSON.stringify(res));
  const data = res.structuredContent;
  const rest = await api(base, "GET", "/api/v1/artifacts/skill/bin-skill/versions/0.1.0", undefined, { cookie: admin.cookie });
  assert.equal(rest.status, 200);
  assert.equal(data.digest, rest.data.digest);
  const byPath = Object.fromEntries(data.files.map((f) => [f.path, f]));
  const skillPath = Object.keys(byPath).find((p) => p.endsWith("SKILL.md"));
  const pngPath = Object.keys(byPath).find((p) => p.endsWith("assets/cover.png"));
  assert.ok(skillPath && pngPath, Object.keys(byPath).join(", "));
  assert.equal(byPath[pngPath].sha256, sha(PNG));
  assert.equal(byPath[skillPath].sha256, sha(Buffer.from(SKILL_MD)));
  assert.equal(byPath[pngPath].binary, true);
  assert.equal(byPath[skillPath].binary, false);
});

test("read_artifact_file: utf-8 text, PNG as base64 with the correct bytes, a file over 4 MiB gives an error naming the limit", async () => {
  const listing = (await call("get_artifact", { type: "skill", name: "bin-skill" })).structuredContent.files;
  const path = (suffix) => listing.find((f) => f.path.endsWith(suffix)).path;

  const text = await call("read_artifact_file", { type: "skill", name: "bin-skill", path: path("SKILL.md") });
  assert.notEqual(text.isError, true);
  assert.equal(text.structuredContent.encoding, "utf-8");
  assert.equal(text.structuredContent.text, SKILL_MD);

  const png = await call("read_artifact_file", { type: "skill", name: "bin-skill", path: path("assets/cover.png") });
  assert.notEqual(png.isError, true, JSON.stringify(png).slice(0, 300));
  assert.equal(png.structuredContent.encoding, "base64");
  const bytes = Buffer.from(png.structuredContent.content_base64, "base64");
  assert.ok(bytes.equals(PNG), "PNG bytes did not match");
  assert.equal(png.structuredContent.sha256, sha(PNG));
  assert.equal(png.structuredContent.size, PNG.length);

  const big = await call("read_artifact_file", { type: "skill", name: "bin-skill", path: path("assets/big.bin") });
  assert.equal(big.isError, true);
  assert.match(big.content[0].text, /4194304/);
});

test("record_usage accepts an extra event field; the schema has no additionalProperties: false", async () => {
  const before = await api(base, "GET", "/api/v1/artifacts/skill/bin-skill/usage", undefined, { cookie: admin.cookie });
  const res = await call("record_usage", { type: "skill", name: "bin-skill", uses: 1, helped: 1, event: { kind: "stage_done", stage: "review" } });
  assert.notEqual(res.isError, true, JSON.stringify(res));
  const after = await api(base, "GET", "/api/v1/artifacts/skill/bin-skill/usage", undefined, { cookie: admin.cookie });
  assert.equal(after.data.total.uses, before.data.total.uses + 1);

  const list = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${mcp}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
  }).then((r) => r.json());
  const tool = list.result.tools.find((t) => t.name === "record_usage");
  assert.notEqual(tool.inputSchema.additionalProperties, false);
});

test("unaffected: candidate and a path with .. give not found; helped > uses gives an error without a write", async () => {
  const draft = await call("get_artifact", { type: "skill", name: "draft-skill" });
  assert.equal(draft.isError, true);
  const dots = await call("read_artifact_file", { type: "skill", name: "bin-skill", path: "skills/bin-skill/../SKILL.md" });
  assert.equal(dots.isError, true);
  const before = await api(base, "GET", "/api/v1/artifacts/skill/bin-skill/usage", undefined, { cookie: admin.cookie });
  const bad = await call("record_usage", { type: "skill", name: "bin-skill", uses: 1, helped: 2, event: {} });
  assert.equal(bad.isError, true);
  const after = await api(base, "GET", "/api/v1/artifacts/skill/bin-skill/usage", undefined, { cookie: admin.cookie });
  assert.equal(after.data.total.uses, before.data.total.uses);
});
