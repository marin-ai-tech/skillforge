// Acceptance tests for a single strict base64 decoder on every input that carries `content_base64`.
// There are three copies of `decodeBase64` (publish.ts, imports/sources.ts, routes/agents.ts) that accept non-canonical
// base64 and silently corrupt the content (for example, an extra trailing character is dropped: length % 4 == 1).
// Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { startServer, api, login, loadDir, FIXTURES, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const SKILL_MD = Buffer.from(
  "---\nname: b64-probe\ndescription: Probe skill for base64 decoding checks. Use when testing uploads.\n---\n\n# Probe\n\nBody text.\n",
);
const ZIP = readFileSync(join(ROOT, "tests", "fixtures", "imports", "plugin-sample.zip"));

let srv;
let base;
let admin;

const b64 = (buf) => Buffer.from(buf).toString("base64");
/**
 * base64 without padding, extended to a length % 4 == 1: such a string cannot be decoded losslessly
 * (Buffer silently drops the tail). A naive helper that just appended "Q" would, for data with padding,
 * yield VALID base64 of different content.
 */
const truncating = (buf) => {
  let s = b64(buf).replace(/=+$/, "");
  while (s.length % 4 !== 1) s += "A";
  return s;
};

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-b64-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
});

after(async () => {
  if (srv?.up) await srv.stop();
});

function expectBadBase64(r, path, where) {
  assert.equal(r.status, 400, `${where}: expected 400, got ${r.status} ${JSON.stringify(r.data)}`);
  assert.equal(r.data.error, "bad_request", `${where}: ${JSON.stringify(r.data)}`);
  assert.ok(typeof r.data.message === "string" && r.data.message.includes(path), `${where}: message must name the path ${path}: ${JSON.stringify(r.data)}`);
}

test("publish and validate: length % 4 == 1 and non-canonical bits -> 400 with the file path; the artifact is not created", async () => {
  const files = [
    { path: "SKILL.md", content_base64: b64(SKILL_MD) },
    { path: "notes.txt", content_base64: truncating(Buffer.from("hello notes")) },
  ];
  expectBadBase64(await api(base, "POST", "/api/v1/artifacts", { type: "skill", files }, { cookie: admin.cookie }), "notes.txt", "publish");
  const card = await api(base, "GET", "/api/v1/artifacts/skill/b64-probe", undefined, { cookie: admin.cookie });
  assert.equal(card.status, 404, "an artifact with a corrupted file must not be created");
  expectBadBase64(await api(base, "POST", "/api/v1/artifacts/validate", { type: "skill", files }, { cookie: admin.cookie }), "notes.txt", "validate");

  // "QR==" decodes to one byte, but the last character has non-zero trailing bits, so it is not canonical base64.
  const nonCanonical = [
    { path: "SKILL.md", content_base64: b64(SKILL_MD) },
    { path: "odd.txt", content_base64: "QR==" },
  ];
  expectBadBase64(await api(base, "POST", "/api/v1/artifacts/validate", { type: "skill", files: nonCanonical }, { cookie: admin.cookie }), "odd.txt", "validate non-canonical");
  // Garbage inside the string and padding in the middle are still 400 (regression).
  const garbage = [{ path: "SKILL.md", content_base64: "QU=JD" }];
  const g = await api(base, "POST", "/api/v1/artifacts/validate", { type: "skill", files: garbage }, { cookie: admin.cookie });
  assert.equal(g.status, 400);
});

test("valid forms are accepted: line breaks (MIME), no padding, empty file", async () => {
  const okSkill = Buffer.from(SKILL_MD.toString().replace("b64-probe", "b64-ok"));
  const wrapped = b64(okSkill).replace(/(.{76})/g, "$1\r\n");
  const unpadded = b64(Buffer.from("tail")).replace(/=+$/, "");
  const files = [
    { path: "SKILL.md", content_base64: wrapped },
    { path: "notes.txt", content_base64: unpadded },
    { path: "empty.txt", content_base64: "" },
  ];
  const v = await api(base, "POST", "/api/v1/artifacts/validate", { type: "skill", files }, { cookie: admin.cookie });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  const pub = await api(base, "POST", "/api/v1/artifacts", { type: "skill", files }, { cookie: admin.cookie });
  assert.equal(pub.status, 201, JSON.stringify(pub.data));
  const file = await fetch(`${base}/api/v1/artifacts/skill/b64-ok/versions/${pub.data.version.version}/files/skills/b64-ok/notes.txt`, { headers: { cookie: admin.cookie } });
  assert.equal(file.status, 200);
  assert.equal(await file.text(), "tail", "content without padding decodes losslessly");
});

test("agent snapshot: non-canonical base64 -> 400 with the path", async () => {
  const files = [
    { path: "skills/b64-agent/SKILL.md", content_base64: b64(Buffer.from(SKILL_MD.toString().replace("b64-probe", "b64-agent"))) },
    { path: "skills/b64-agent/extra.md", content_base64: truncating(Buffer.from("extra text")) },
  ];
  expectBadBase64(await api(base, "PUT", "/api/v1/me/agents/b64-check", { files }, { cookie: admin.cookie }), "skills/b64-agent/extra.md", "agents PUT");
  const list = await api(base, "GET", "/api/v1/me/agents", undefined, { cookie: admin.cookie });
  assert.ok(!list.data.items.some((a) => a.name === "b64-check"), "an agent with a corrupted file must not be created");
});

test("import: files and zip sources with non-canonical base64 -> 400", async () => {
  const sample = loadDir(join(FIXTURES, "..", "imports", "plugin-sample"))
    .filter((f) => !f.path.includes("node_modules"))
    .map((f, i) => ({ path: `plugin-sample/${f.path}`, content_base64: i === 0 ? truncating(f.content) : b64(f.content) }));
  const brokenPath = sample[0].path;
  expectBadBase64(await api(base, "POST", "/api/v1/imports/preview", { source: { kind: "files", files: sample } }, { cookie: admin.cookie }), brokenPath, "import files");
  const zip = await api(base, "POST", "/api/v1/imports/preview", { source: { kind: "zip", content_base64: truncating(ZIP) } }, { cookie: admin.cookie });
  assert.equal(zip.status, 400, `import zip: ${zip.status} ${JSON.stringify(zip.data)}`);
  assert.equal(zip.data.error, "bad_request");
  const okZip = await api(base, "POST", "/api/v1/imports/preview", { source: { kind: "zip", content_base64: b64(ZIP) } }, { cookie: admin.cookie });
  assert.equal(okZip.status, 200, "valid zip: regression");
});
