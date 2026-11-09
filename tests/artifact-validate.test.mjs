// Acceptance tests for the dry-run validate API (artifact-api, "Dry-run validation"): dry-run requires contributor+ (log in as admin).
// Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { startServer, api as rawApi, login, loadDir, toB64, FIXTURES as FIX, ADMIN_PASSWORD } from "./lib/client.mjs";

let srv;
let dataDir;
let base;
let admin;
const api = (method, path, body) => rawApi(base, method, path, body, { cookie: admin.cookie });
const validate = (body) => api("POST", "/api/v1/artifacts/validate", body);

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-validate-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  dataDir = srv.dataDir;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  const seeded = await api("POST", "/api/v1/artifacts", { type: "skill", files: toB64(loadDir(join(FIX, "skill-standard"))) });
  assert.equal(seeded.status, 201, `failed to seed pdf-tools: ${JSON.stringify(seeded.data)}`);
});

after(async () => {
  if (srv?.up) await srv.stop();
});

const e2eSkill = loadDir(join(FIX, "skill-e2e")); // pdf-tools-e2e/SKILL.md, pdf-tools-e2e/references/REFERENCE.md

test("validate: new artifact without type → detected skill, next 0.1.0, no conflicts", async () => {
  const r = await validate({ files: toB64(e2eSkill) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const d = r.data;
  assert.equal(d.ok, true, JSON.stringify(d.errors));
  assert.equal(d.detected_type, "skill");
  assert.equal(d.type, "skill");
  assert.equal(d.artifact.name, "pdf-tools-e2e");
  assert.equal(d.artifact.type, "skill");
  assert.ok(d.artifact.files.some((f) => f.path === "skills/pdf-tools-e2e/SKILL.md"));
  assert.match(d.artifact.digest, /^[0-9a-f]{64}$/);
  assert.equal(d.existing, null);
  assert.equal(d.next_version, "0.1.0");
  assert.deepEqual(d.conflicts, []);
  assert.ok(Array.isArray(d.warnings));
  for (const k of ["ok", "detected_type", "type", "artifact", "errors", "warnings", "existing", "next_version", "conflicts"]) {
    assert.ok(k in d, `validate response has no field ${k}`);
  }
});

test("validate: parse errors → ok false, artifact null, E_NAME_INVALID, next_version null", async () => {
  const r = await validate({
    type: "skill",
    files: toB64([{ path: "SKILL.md", content: Buffer.from("---\nname: PDF-Tools\ndescription: Handles PDFs.\n---\n\nBody.\n") }]),
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, false);
  assert.equal(r.data.artifact, null);
  assert.ok(r.data.errors.some((e) => e.code === "E_NAME_INVALID"), JSON.stringify(r.data.errors));
  assert.equal(r.data.next_version, null);
});

test("validate: same bundle of an existing artifact → existing and digest_exists", async () => {
  const r = await validate({ type: "skill", files: toB64(loadDir(join(FIX, "skill-standard"))) });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.existing.latest_version, "0.1.0");
  assert.equal(r.data.existing.versions_count, 1);
  assert.equal(r.data.existing.status, "candidate");
  assert.ok(r.data.conflicts.includes("digest_exists"), JSON.stringify(r.data.conflicts));
  assert.equal(r.data.next_version, "0.1.1");
});

test("validate: explicit version — valid and invalid", async () => {
  const files = toB64(loadDir(join(FIX, "skill-standard")).map((f) => (f.path.endsWith("SKILL.md") ? { path: f.path, content: Buffer.from(f.content.toString("utf8") + "\nExtra.\n") } : f)));
  const ok = await validate({ type: "skill", version: "0.0.1", files });
  assert.equal(ok.data.next_version, "0.0.1");
  assert.deepEqual(ok.data.conflicts, []);
  const dup = await validate({ type: "skill", version: "0.1.0", files });
  assert.ok(dup.data.conflicts.includes("version_exists"), JSON.stringify(dup.data.conflicts));
  const bad = await validate({ type: "skill", version: "v1", files });
  assert.ok(bad.data.conflicts.includes("version_invalid"), JSON.stringify(bad.data.conflicts));
  assert.equal(bad.data.next_version, null);
});

test("validate: type not detected → type null and E_TYPE_UNKNOWN", async () => {
  const r = await validate({ files: toB64([{ path: "a.txt", content: Buffer.from("a") }, { path: "b.txt", content: Buffer.from("b") }]) });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, false);
  assert.equal(r.data.type, null);
  assert.equal(r.data.detected_type, null);
  assert.ok(r.data.errors.some((e) => e.code === "E_TYPE_UNKNOWN"), JSON.stringify(r.data.errors));
});

test("validate: agent hint for a single md with model", async () => {
  const r = await validate({ files: toB64([{ path: "helper.md", content: Buffer.from("---\nname: helper\ndescription: Helps.\nmodel: sonnet\n---\nPrompt.\n") }]) });
  assert.equal(r.data.detected_type, "agent");
  assert.equal(r.data.type, "agent");
  assert.equal(r.data.ok, true, JSON.stringify(r.data.errors));
});

const countBlobs = () => {
  let n = 0;
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else n++;
    }
  };
  walk(join(dataDir, "blobs"));
  return n;
};

test("validate: writes nothing (no artifacts, no blobs)", async () => {
  const artifactsBefore = (await api("GET", "/api/v1/health")).data.artifacts;
  const blobsBefore = countBlobs();
  const r = await validate({ files: toB64(e2eSkill) });
  assert.equal(r.data.ok, true);
  assert.equal((await api("GET", "/api/v1/health")).data.artifacts, artifactsBefore);
  assert.equal(countBlobs(), blobsBefore, "validate wrote blobs");
  const get = await api("GET", "/api/v1/artifacts/skill/pdf-tools-e2e");
  assert.equal(get.status, 404);
  const audit = await api("GET", "/api/v1/artifacts/skill/pdf-tools/audit");
  assert.equal(audit.data.items.length, 1, "validate added an audit entry");
});

test("validate: structural errors → 400 bad_request", async () => {
  const noFiles = await validate({ type: "skill" });
  assert.equal(noFiles.status, 400);
  assert.equal(noFiles.data.error, "bad_request");
  const badB64 = await validate({ type: "skill", files: [{ path: "SKILL.md", content_base64: "***" }] });
  assert.equal(badB64.status, 400);
  assert.equal(badB64.data.error, "bad_request");
});
