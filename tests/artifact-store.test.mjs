// Acceptance tests for the artifact store core: publishing requires login (admin / alice), the actor comes from the session.
// Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { startServer, api as rawApi, login, createUser, loadDir, toB64, FIXTURES as FIX, ADMIN_PASSWORD } from "./lib/client.mjs";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

let srv;
let dataDir;
let base;
let admin;
let alice;

// admin is the default actor (session), alice is a contributor for scenarios with an explicit actor.
const api = (method, path, body, auth = { cookie: admin.cookie }) => rawApi(base, method, path, body, auth);
const publish = (body, auth) => api("POST", "/api/v1/artifacts", body, auth ?? { cookie: admin.cookie });

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-store-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  dataDir = srv.dataDir;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  await createUser(base, admin.cookie, { username: "alice", password: "alice-pw-1", role: "contributor" });
  alice = await login(base, "alice", "alice-pw-1");
});

after(async () => {
  if (srv?.up) await srv.stop();
});

const skillFiles = loadDir(join(FIX, "skill-standard")); // pdf-tools/SKILL.md, pdf-tools/references/REFERENCE.md
const skillMd = skillFiles.find((f) => f.path.endsWith("SKILL.md"));
let firstDigest;

test("health: artifacts = 0 on an empty registry", async () => {
  const r = await api("GET", "/api/v1/health");
  assert.equal(r.status, 200);
  assert.equal(r.data.artifacts, 0);
});

test("publish: first skill publication -> 201, 0.1.0, candidate, anonymous", async () => {
  const r = await publish({ type: "skill", files: toB64(skillFiles) });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const { artifact, version, warnings } = r.data;
  assert.equal(artifact.type, "skill");
  assert.equal(artifact.name, "pdf-tools");
  assert.equal(artifact.status, "candidate");
  assert.equal(artifact.visibility, "org");
  assert.equal(artifact.latest_version, "0.1.0");
  assert.equal(artifact.versions_count, 1);
  assert.equal(version.version, "0.1.0");
  assert.match(version.digest, /^[0-9a-f]{64}$/);
  assert.ok(version.files.some((f) => f.path === "skills/pdf-tools/SKILL.md"));
  assert.equal(version.published_by, "admin");
  assert.deepEqual(version.provenance, { source: "human", ref: null });
  assert.deepEqual(version.model_compat, []);
  assert.deepEqual(version.evidence, []);
  assert.equal(version.changelog, null);
  assert.equal(version.validated_at, null);
  assert.equal(version.use_count, 0);
  assert.equal(version.help_count, 0);
  assert.ok(Array.isArray(warnings));
  firstDigest = version.digest;
});

test("blob: the file is stored at data/blobs/<ab>/<sha256> with the same content", () => {
  const sha = sha256(skillMd.content);
  const p = join(dataDir, "blobs", sha.slice(0, 2), sha);
  assert.ok(existsSync(p), `missing blob ${p}`);
  assert.equal(readFileSync(p).toString("utf8"), skillMd.content.toString("utf8"));
});

test("publish: repeating the same content -> 409 digest_exists", async () => {
  const r = await publish({ type: "skill", files: toB64(skillFiles) });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.error, "digest_exists");
});

const v2Files = skillFiles.map((f) =>
  f.path.endsWith("SKILL.md")
    ? { path: f.path, content: Buffer.from(f.content.toString("utf8") + "\n4. Merge with `scripts/merge.py`.\n") }
    : f,
);

test("publish: new version 0.2.0 with changelog -> latest 0.2.0, versions_count 2", async () => {
  const r = await publish({ type: "skill", version: "0.2.0", changelog: "Add merge step", files: toB64(v2Files) });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.version.version, "0.2.0");
  assert.equal(r.data.version.changelog, "Add merge step");
  assert.equal(r.data.artifact.latest_version, "0.2.0");
  assert.equal(r.data.artifact.versions_count, 2);
  assert.notEqual(r.data.version.digest, firstDigest);
});

test("publish: repeating version 0.2.0 with different content -> 409 version_exists", async () => {
  const v3 = v2Files.map((f) =>
    f.path.endsWith("SKILL.md") ? { path: f.path, content: Buffer.from(f.content.toString("utf8") + "\n5. Done.\n") } : f,
  );
  const r = await publish({ type: "skill", version: "0.2.0", files: toB64(v3) });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.error, "version_exists");
});

test("publish: validation error -> 422 with code E_NAME_INVALID, artifact not created", async () => {
  const r = await publish({
    type: "skill",
    files: toB64([{ path: "SKILL.md", content: Buffer.from("---\nname: PDF-Tools\ndescription: Handles PDFs.\n---\n\nBody.\n") }]),
  });
  assert.equal(r.status, 422, JSON.stringify(r.data));
  assert.equal(r.data.error, "validation_failed");
  assert.ok(r.data.errors.some((e) => e.code === "E_NAME_INVALID"));
  const h = await api("GET", "/api/v1/health");
  assert.equal(h.data.artifacts, 1);
});

test("publish: version_invalid and bad_request", async () => {
  const bad = await publish({ type: "skill", version: "v1.0", files: toB64(skillFiles) });
  assert.equal(bad.status, 400, JSON.stringify(bad.data));
  assert.equal(bad.data.error, "version_invalid");
  const noFiles = await publish({ type: "skill" });
  assert.equal(noFiles.status, 400, JSON.stringify(noFiles.data));
  assert.equal(noFiles.data.error, "bad_request");
  const prov = await publish({ type: "command", description: "x", provenance: { source: "vibes", ref: null }, files: toB64([{ path: "x.md", content: Buffer.from("Do x.\n") }]) });
  assert.equal(prov.status, 400, JSON.stringify(prov.data));
  assert.equal(prov.data.error, "provenance_invalid");
});

test("publish: command, agent and hook as alice -> 201, published_by alice", async () => {
  const cmd = await publish({ type: "command", files: toB64(loadDir(join(FIX, "command-propose"))) }, { cookie: alice.cookie });
  assert.equal(cmd.status, 201, JSON.stringify(cmd.data));
  assert.equal(cmd.data.artifact.name, "propose");
  assert.equal(cmd.data.artifact.display_name, "OPSX: Propose");
  assert.ok(cmd.data.artifact.tags.includes("workflow"));
  assert.equal(cmd.data.version.published_by, "alice");

  const agent = await publish(
    { type: "agent", provenance: { source: "reckon", ref: "run-42" }, model_compat: ["opus-5"], files: toB64(loadDir(join(FIX, "agent-executor"))) },
    { cookie: alice.cookie },
  );
  assert.equal(agent.status, 201, JSON.stringify(agent.data));
  assert.equal(agent.data.artifact.name, "handoff-executor");
  assert.deepEqual(agent.data.version.provenance, { source: "reckon", ref: "run-42" });
  assert.deepEqual(agent.data.version.model_compat, ["opus-5"]);

  const hook = await publish({ type: "hook", name: "destructive-guard", files: toB64(loadDir(join(FIX, "hook-guard"))) }, { cookie: alice.cookie });
  assert.equal(hook.status, 201, JSON.stringify(hook.data));
  assert.equal(hook.data.artifact.name, "destructive-guard");
  assert.match(hook.data.artifact.description, /^Asks for confirmation/);
  assert.ok(hook.data.version.files.some((f) => f.path === "hooks/hooks.json"));

  const h = await api("GET", "/api/v1/health");
  assert.equal(h.data.artifacts, 4);
});

test("publish: same-named artifacts of different types coexist", async () => {
  const r = await publish({ type: "command", description: "PDF helper command", files: toB64([{ path: "pdf-tools.md", content: Buffer.from("Run the PDF skill on the current file.\n") }]) });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.artifact.type, "command");
  assert.equal(r.data.artifact.latest_version, "0.1.0");
  const skill = await api("GET", "/api/v1/artifacts/skill/pdf-tools");
  assert.equal(skill.status, 200);
  assert.equal(skill.data.artifact.latest_version, "0.2.0");
});

test("list: type filter, q search, tag, pagination, response shape", async () => {
  const hooks = await api("GET", "/api/v1/artifacts?type=hook");
  assert.equal(hooks.status, 200);
  assert.equal(hooks.data.total, 1);
  assert.equal(hooks.data.items[0].type, "hook");

  const q = await api("GET", "/api/v1/artifacts?q=PDF");
  assert.ok(q.data.items.some((a) => a.name === "pdf-tools" && a.type === "skill"), JSON.stringify(q.data));

  const tag = await api("GET", "/api/v1/artifacts?tag=workflow");
  assert.equal(tag.data.total, 1);
  assert.equal(tag.data.items[0].name, "propose");

  const all = await api("GET", "/api/v1/artifacts");
  assert.equal(all.data.total, 5);
  const page = await api("GET", "/api/v1/artifacts?limit=2&offset=2");
  assert.equal(page.data.items.length, 2);
  assert.equal(page.data.total, 5);
  for (const k of ["type", "name", "description", "display_name", "tags", "status", "visibility", "owner_team", "latest_version", "versions_count", "created_by", "created_at", "updated_at"]) {
    assert.ok(k in all.data.items[0], `ArtifactSummary has no field ${k}`);
  }
  const bad = await api("GET", "/api/v1/artifacts?limit=0");
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error, "bad_request");
});

test("get: card, versions, latest, file with etag", async () => {
  const card = await api("GET", "/api/v1/artifacts/skill/pdf-tools");
  assert.equal(card.status, 200);
  assert.equal(card.data.artifact.latest_version, "0.2.0");
  assert.equal(card.data.latest.version, "0.2.0");
  assert.equal(card.data.versions.length, 2);
  assert.ok("digest" in card.data.versions[0] && "published_at" in card.data.versions[0] && "published_by" in card.data.versions[0]);

  const versions = await api("GET", "/api/v1/artifacts/skill/pdf-tools/versions");
  assert.deepEqual(versions.data.items.map((v) => v.version), ["0.2.0", "0.1.0"]);

  const latest = await api("GET", "/api/v1/artifacts/skill/pdf-tools/versions/latest");
  const v020 = await api("GET", "/api/v1/artifacts/skill/pdf-tools/versions/0.2.0");
  assert.equal(latest.status, 200);
  assert.deepEqual(latest.data, v020.data);
  for (const k of ["version", "digest", "description", "display_name", "tags", "frontmatter", "files", "warnings", "changelog", "model_compat", "provenance", "evidence", "validated_at", "use_count", "help_count", "published_by", "published_at"]) {
    assert.ok(k in v020.data, `VersionDetail has no field ${k}`);
  }
  assert.equal(v020.data.frontmatter.name, "pdf-tools");

  const file = await fetch(`${base}/api/v1/artifacts/skill/pdf-tools/versions/0.1.0/files/skills/pdf-tools/SKILL.md`);
  assert.equal(file.status, 200);
  assert.match(file.headers.get("content-type") ?? "", /^text\/markdown/);
  const body = Buffer.from(await file.arrayBuffer());
  assert.equal(body.toString("utf8"), skillMd.content.toString("utf8"));
  assert.equal(file.headers.get("etag")?.replace(/"/g, ""), sha256(skillMd.content));

  const json = await fetch(`${base}/api/v1/artifacts/hook/destructive-guard/versions/latest/files/hooks/hooks.json`);
  assert.equal(json.status, 200);
  assert.match(json.headers.get("content-type") ?? "", /^application\/json/);
});

test("404: unknown artifact, version, file, type", async () => {
  for (const p of [
    "/api/v1/artifacts/skill/nope",
    "/api/v1/artifacts/skill/pdf-tools/versions/9.9.9",
    "/api/v1/artifacts/skill/pdf-tools/versions/0.1.0/files/skills/pdf-tools/missing.md",
    "/api/v1/artifacts/widget/pdf-tools",
  ]) {
    const r = await api("GET", p);
    assert.equal(r.status, 404, p);
    assert.deepEqual(r.data, { error: "not_found" }, p);
  }
});

test("audit: two publications give two publish records, the first for 0.2.0, meta.digest matches", async () => {
  const r = await api("GET", "/api/v1/artifacts/skill/pdf-tools/audit");
  assert.equal(r.status, 200);
  const items = r.data.items;
  assert.equal(items.length, 2);
  assert.equal(items[0].action, "publish");
  assert.equal(items[0].version, "0.2.0");
  assert.equal(items[1].version, "0.1.0");
  assert.equal(items[1].meta.digest, firstDigest);
  assert.equal(items[0].actor, "admin");
  for (const k of ["id", "ts", "actor", "action", "version", "from_status", "to_status", "reason", "meta"]) {
    assert.ok(k in items[0], `AuditEvent has no field ${k}`);
  }
});

test("publish: auto version patch+1 when no version is given", async () => {
  const v4 = v2Files.map((f) =>
    f.path.endsWith("SKILL.md") ? { path: f.path, content: Buffer.from(f.content.toString("utf8") + "\n5. Verify output.\n") } : f,
  );
  const r = await publish({ type: "skill", files: toB64(v4) });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.version.version, "0.2.1");
  assert.equal(r.data.artifact.latest_version, "0.2.1");
});
