// Acceptance tests for metadata and purge, part A.
// Requires `npm run build`.
// The main purge check is not API responses but bytes on disk: the secret must remain in no blob, DB file or WAL.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { existsSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { startServer, api as rawApi, login, createUser, toB64, ADMIN_PASSWORD } from "./lib/client.mjs";

const S_DESC = "SECRET_DESC_7f3a91";
const S_BODY = "SECRET_BODY_9c1d44";
const S_EV = "SECRET_EV_55aa02";
const S_CMT = "SECRET_CMT_31be77";
const S_AUD = "SECRET_AUD_e2f60b"; // a secret that reached the audit log via the evidence url, a metadata edit and a validate note
let srv;
let base;
const U = {};
const auth = (who) => (who === "anon" ? {} : { cookie: U[who].cookie });
const api = (method, path, body, who = "admin") => rawApi(base, method, path, body, auth(who));
const enc = (s) => Buffer.from(s, "utf8");

const files = (name, { skillBody, description }) => [
  { path: `${name}/SKILL.md`, content: enc(`---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${skillBody}\n`) },
  { path: `${name}/references/shared.md`, content: enc("# Shared reference\n\nThis file is identical in every version.\n") },
];
const publish = (name, version, opts, who = "alice", extra = {}) => api("POST", "/api/v1/artifacts", { type: "skill", version, files: toB64(files(name, opts)), ...extra }, who);
const A = (name) => `/api/v1/artifacts/skill/${name}`;
const audit = async (name) => (await api("GET", `${A(name)}/audit`)).data.items;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const blobFiles = () => walk(join(srv.dataDir, "blobs"));
const anyBlobContains = (needle) => blobFiles().some((f) => readFileSync(f).includes(needle));
const dbBytes = () => ["skillforge.db", "skillforge.db-wal"].map((n) => (existsSync(join(srv.dataDir, n)) ? readFileSync(join(srv.dataDir, n)) : Buffer.alloc(0)));
const dbContains = (needle) => dbBytes().some((b) => b.includes(needle));

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-purge-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  U.admin = await login(base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [["alice", "contributor"], ["carol", "contributor"], ["bob", "contributor"], ["rita", "reviewer"], ["vera", "viewer"]]) {
    await createUser(base, U.admin.cookie, { username: u, password: `${u}-pw-123`, role });
    U[u] = await login(base, u, `${u}-pw-123`);
  }
  base = srv.base;
});

after(async () => {
  await srv?.stop();
});

test("metadata: edit without a version, bounds, permissions, publishing does not overwrite, override reset, audit", async () => {
  assert.equal((await publish("meta-skill", "0.1.0", { skillBody: "body", description: "Original description" })).status, 201);
  assert.equal((await api("POST", `${A("meta-skill")}/maintainers`, { username: "carol" }, "alice")).status, 200);
  const versions = () => api("GET", `${A("meta-skill")}/versions`).then((r) => r.data.items.length);
  const before = await versions();

  const P = `${A("meta-skill")}/metadata`;
  const ok = await api("PATCH", P, { display_name: "Renamed Skill", description: "Curated description", tags: ["curated", "team-a"] }, "alice");
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const card = (await api("GET", A("meta-skill"))).data.artifact;
  assert.equal(card.display_name, "Renamed Skill");
  assert.equal(card.description, "Curated description");
  assert.deepEqual([...card.tags].sort(), ["curated", "team-a"]);
  assert.equal(await versions(), before, "no versions were added");
  assert.equal((await api("GET", `${A("meta-skill")}/versions/0.1.0`)).data.description, "Original description", "the version is immutable");
  assert.deepEqual((await api("GET", "/api/v1/artifacts?q=Curated", undefined, "anon")).data.items.map((i) => i.name), ["meta-skill"]);
  assert.deepEqual((await api("GET", "/api/v1/artifacts?tag=curated", undefined, "anon")).data.items.map((i) => i.name), ["meta-skill"]);

  // publishing a new version does not overwrite overrides
  assert.equal((await publish("meta-skill", "0.2.0", { skillBody: "body v2", description: "Second version description" })).status, 201);
  const after = (await api("GET", A("meta-skill"))).data.artifact;
  assert.equal(after.description, "Curated description");
  assert.equal(after.display_name, "Renamed Skill");
  assert.equal(after.latest_version, "0.2.0");

  // reset of one field
  assert.equal((await api("PATCH", P, { description: null }, "carol")).status, 200, "a maintainer can");
  assert.equal((await api("GET", A("meta-skill"))).data.artifact.description, "Second version description", "taken from the latest version again");
  assert.equal((await api("GET", A("meta-skill"))).data.artifact.display_name, "Renamed Skill", "other fields untouched");

  // bounds
  for (const bad of [{ description: "x".repeat(1025) }, { display_name: "n".repeat(101) }, { tags: ["Bad Tag"] }, { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }, { tags: ["a", "a"] }, { description: "bad\u0000char" }, { tags: "x" }, { display_name: 5 }]) {
    const r = await api("PATCH", P, bad, "alice");
    assert.equal(r.status, 400, JSON.stringify(bad).slice(0, 50));
    assert.equal(r.data.error, "metadata_invalid");
  }
  assert.equal((await api("PATCH", P, {}, "alice")).status, 400, "empty request");

  // permissions
  const stranger = await api("PATCH", P, { description: "hack" }, "bob");
  assert.equal(stranger.status, 403);
  assert.equal(stranger.data.error, "not_owner");
  assert.equal((await api("PATCH", P, { description: "hack" }, "vera")).status, 403);
  assert.equal((await api("PATCH", P, { description: "hack" }, "anon")).status, 401);
  const t = await api("POST", "/api/v1/me/tokens", { name: "agent", mcp: true }, "alice");
  const mcp = await rawApi(base, "PATCH", P, { description: "hack" }, { token: t.data.token });
  assert.equal(mcp.status, 403);
  assert.equal(mcp.data.error, "mcp_token_forbidden");
  assert.equal((await api("PATCH", P, { tags: ["by-reviewer"] }, "rita")).status, 200, "reviewer — override");

  const ev = await audit("meta-skill");
  assert.ok(ev.filter((e) => e.action === "metadata_change").length >= 3);
  assert.ok(ev.some((e) => e.action === "publish_override" && e.actor === "rita"));
  assert.notEqual((await api("GET", A("meta-skill"))).data.artifact.description, "hack");
});

test("version purge: protection against accidental and foreign use, required reason and confirmation", async () => {
  assert.equal((await publish("leaky", "0.1.0", { skillBody: `token=${S_BODY}`, description: `Uses key ${S_DESC} for the API` })).status, 201);
  assert.equal((await publish("leaky", "0.2.0", { skillBody: "clean body", description: "Clean description" })).status, 201);
  assert.equal((await api("POST", `${A("leaky")}/versions/0.1.0/evidence`, { kind: "gate", url: "https://ci.example/1", summary: S_EV }, "alice")).status, 201, "evidence intake is required");
  assert.equal((await api("POST", `${A("leaky")}/versions/0.1.0/evidence`, { kind: "run", url: `https://ci.example/${S_AUD}` }, "alice")).status, 201);
  assert.equal((await api("PATCH", `${A("leaky")}/metadata`, { description: `edited ${S_AUD}` }, "alice")).status, 200);
  assert.equal((await api("PATCH", `${A("leaky")}/metadata`, { description: null }, "alice")).status, 200);
  assert.equal((await api("POST", `${A("leaky")}/versions/0.1.0/validate`, { note: `checked ${S_AUD}`, model_compat: ["opus-5"] })).status, 200);
  const cm = await api("POST", `${A("leaky")}/comments`, { body: `does this token ${S_CMT} work?`, version: "0.1.0" }, "bob");
  assert.equal(cm.status, 201, "comments and notifications are required: " + JSON.stringify(cm.data));
  // sanity check: without it the "no secret" check is vacuous
  assert.ok(anyBlobContains(S_BODY), "secret in the blob before purge");
  assert.ok(dbContains(S_DESC), "secret in the DB (description) before purge");
  assert.ok(dbContains(S_CMT), "comment secret in the DB before purge");
  assert.ok(dbContains(S_AUD), "secret in the audit log before purge");

  const P = `${A("leaky")}/versions/0.1.0/purge`;
  const body = { reason: "leaked API key in SKILL.md", confirm: "skill/leaky@0.1.0" };
  assert.equal((await api("POST", P, body, "alice")).status, 403, "the owner cannot");
  assert.equal((await api("POST", P, body, "rita")).status, 403, "a reviewer cannot");
  assert.equal((await api("POST", P, body, "anon")).status, 401);
  const t = await api("POST", "/api/v1/me/tokens", { name: "agent", mcp: true }, "admin");
  const mcp = await rawApi(base, "POST", P, body, { token: t.data.token });
  assert.equal(mcp.status, 403);
  assert.equal(mcp.data.error, "mcp_token_forbidden");
  const short = await api("POST", P, { ...body, reason: "short" });
  assert.equal(short.status, 400);
  assert.equal(short.data.error, "reason_required");
  assert.equal((await api("POST", P, { ...body, reason: "r".repeat(501) })).status, 400);
  const wrong = await api("POST", P, { ...body, confirm: "skill/leaky@0.2.0" });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.data.error, "confirm_mismatch");
  assert.equal((await api("POST", `${A("leaky")}/versions/9.9.9/purge`, { reason: body.reason, confirm: "skill/leaky@9.9.9" })).status, 404);
  assert.ok(anyBlobContains(S_BODY), "nothing was deleted after the refusals");
  assert.equal((await api("GET", `${A("leaky")}/versions/0.1.0`)).status, 200);
});

test("version purge: the secret is gone from blobs and DB/WAL files; the shared blob remains; latest, 410, tombstone, content_purged, audit", async () => {
  const backup = await api("POST", "/api/v1/admin/backups");
  assert.equal(backup.status, 201, JSON.stringify(backup.data));
  const backupName = backup.data.backup.name;

  const P = `${A("leaky")}/versions/0.1.0/purge`;
  const r = await api("POST", P, { reason: "leaked API key in SKILL.md", confirm: "skill/leaky@0.1.0" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.purged, "0.1.0");
  assert.ok(r.data.blobs_deleted >= 1);
  assert.equal(r.data.blobs_failed ?? 0, 0);
  const shared = r.data.blobs_shared;
  assert.ok(Array.isArray(shared) && shared.length >= 1 && shared.every((s) => s.versions.includes("0.2.0")), JSON.stringify(shared));
  assert.ok(r.data.backups_predating.includes(backupName), "the backup predating purge is listed");
  assert.equal((await api("GET", "/api/v1/admin/backups")).data.items.some((b) => b.name === backupName), true, "without delete_backups the backup is not deleted");

  // bytes on disk
  assert.equal(anyBlobContains(S_BODY), false, "the secret remained in the blob");
  assert.equal(dbContains(S_DESC), false, "the description secret remained in the DB files");
  assert.equal(dbContains(S_EV), false, "the evidence secret remained in the DB files");
  assert.equal(dbContains(S_BODY), false);
  assert.equal(dbContains(S_AUD), false, "the secret remained in the audit log (evidence_add / metadata_change / validate) in the DB files");
  assert.ok(!JSON.stringify((await api("GET", `${A("leaky")}/audit`)).data.items).includes(S_AUD), "the secret is visible via GET .../audit");
  assert.equal(dbContains(S_CMT), false, "the comment of the purged version remained in the DB files");
  assert.equal((await api("GET", `${A("leaky")}/comments?version=0.1.0`)).data.items.length, 0, "comments of the purged version were deleted");
  assert.ok(!JSON.stringify((await api("GET", "/api/v1/me/notifications", undefined, "alice")).data).includes(S_CMT), "notifications about the purged version's comment were deleted");
  const shas = shared.map((s) => s.sha256);
  const remaining = blobFiles().map((f) => f.split(/[\\/]/).pop());
  for (const sha of shas) assert.ok(remaining.includes(sha), "the shared blob was deleted");

  // API after purge
  const list = (await api("GET", `${A("leaky")}/versions`)).data.items;
  const tomb = list.find((v) => v.version === "0.1.0");
  assert.equal(tomb.purged, true);
  assert.ok(tomb.purged_at);
  assert.ok(!JSON.stringify(list).includes(S_DESC));
  for (const p of [`${A("leaky")}/versions/0.1.0`, `${A("leaky")}/versions/0.1.0/files/leaky/SKILL.md`, `${A("leaky")}/versions/0.1.0/bundle.zip`, `/api/v1/plugins/skill/leaky/0.1.0.tar.gz`, `${A("leaky")}/resolve?spec=0.1.0`]) {
    const g = await api("GET", p, undefined, "alice");
    assert.equal(g.status, 410, `${p}: ${g.status}`);
    if (!(g.data instanceof ArrayBuffer)) assert.equal(g.data.error, "purged");
  }
  const card = (await api("GET", A("leaky"))).data.artifact;
  assert.equal(card.latest_version, "0.2.0");
  assert.equal(card.description, "Clean description");
  assert.equal((await api("GET", `${A("leaky")}/versions/latest`)).data.version, "0.2.0");
  assert.equal((await api("GET", `${A("leaky")}/resolve?spec=latest`)).data.version, "0.2.0");

  // the content cannot be resurrected
  const again = await publish("leaky", "0.3.0", { skillBody: `token=${S_BODY}`, description: `Uses key ${S_DESC} for the API` });
  assert.equal(again.status, 409, JSON.stringify(again.data));
  assert.equal(again.data.error, "content_purged");
  assert.equal(anyBlobContains(S_BODY), false, "the block worked before the blobs were written");

  // audit: reason and version, without the secret
  const ev = (await audit("leaky")).find((e) => e.action === "purge");
  assert.ok(ev, "purge event in the audit");
  assert.equal(ev.actor, "admin");
  assert.equal(ev.reason, "leaked API key in SKILL.md");
  assert.equal(ev.meta.version, "0.1.0");
  assert.ok(!JSON.stringify(ev).includes(S_DESC));
});

test("artifact purge + delete_backups: tombstone for admin, 404 for others, name reserved, backups deleted, secret wiped", async () => {
  assert.equal((await publish("leaky2", "0.1.0", { skillBody: `token=${S_BODY}2`, description: `Key ${S_DESC}2 inside` })).status, 201);
  assert.ok(anyBlobContains(`${S_BODY}2`));
  const b = await api("POST", "/api/v1/admin/backups");
  assert.equal(b.status, 201);
  const before = (await api("GET", "/api/v1/admin/backups")).data.items.length;
  assert.ok(before >= 2);

  const P = `${A("leaky2")}/purge`;
  assert.equal((await api("POST", P, { reason: "leaked API key everywhere", confirm: "skill/leaky2@0.1.0" })).status, 400, "for an artifact, confirm has no version");
  assert.equal((await api("POST", P, { reason: "leaked API key everywhere", confirm: "skill/leaky2" }, "alice")).status, 403);
  const r = await api("POST", P, { reason: "leaked API key everywhere", confirm: "skill/leaky2", delete_backups: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.backups_deleted >= 2, JSON.stringify(r.data));
  assert.equal((await api("GET", "/api/v1/admin/backups")).data.items.length, 0, "backups deleted");

  assert.equal(anyBlobContains(`${S_BODY}2`), false);
  assert.equal(dbContains(`${S_DESC}2`), false);
  // for everyone else the artifact does not exist; admin sees the tombstone
  assert.equal((await api("GET", A("leaky2"), undefined, "alice")).status, 404);
  assert.equal((await api("GET", A("leaky2"), undefined, "anon")).status, 404);
  const list = await api("GET", "/api/v1/artifacts", undefined, "alice");
  assert.ok(!list.data.items.some((i) => i.name === "leaky2"));
  assert.ok(!(await api("GET", "/api/v1/artifacts?q=leaky2", undefined, "anon")).data.items.length);
  const mp = (await api("GET", "/marketplace.json", undefined, "anon")).data;
  assert.ok(!JSON.stringify(mp).includes("leaky2"));
  const tomb = await api("GET", A("leaky2"), undefined, "admin");
  assert.equal(tomb.status, 200);
  assert.ok(tomb.data.artifact.purged_at, "admin sees the tombstone");
  assert.equal(tomb.data.artifact.purged_by, "admin");
  assert.ok((await audit("leaky2")).some((e) => e.action === "purge"));

  const name = await publish("leaky2", "0.1.0", { skillBody: "new", description: "new" });
  assert.equal(name.status, 409);
  assert.equal(name.data.error, "name_purged");
});

test("blob GC: dry run, grace period, blobs referenced by versions are not deleted, permissions", async () => {
  const dir = join(srv.dataDir, "blobs");
  const mk = (ageDays) => {
    const sha = randomBytes(32).toString("hex");
    const p = join(dir, sha.slice(0, 2), sha);
    mkdirSync(join(dir, sha.slice(0, 2)), { recursive: true });
    writeFileSync(p, randomBytes(64));
    const t = new Date(Date.now() - ageDays * 86400000);
    utimesSync(p, t, t);
    return p;
  };
  const oldOrphan = mk(30);
  const freshOrphan = mk(0);
  const ver = (await api("GET", `${A("meta-skill")}/versions/0.1.0`)).data;
  const referenced = ver.files.map((f) => join(dir, f.sha256.slice(0, 2), f.sha256));
  assert.ok(referenced.every((p) => existsSync(p)));

  assert.equal((await api("POST", "/api/v1/admin/blobs/gc", {}, "alice")).status, 403);
  assert.equal((await api("POST", "/api/v1/admin/blobs/gc", {}, "anon")).status, 401);
  assert.equal((await api("POST", "/api/v1/admin/blobs/gc", { grace_days: 400 })).status, 400);
  const dry = await api("POST", "/api/v1/admin/blobs/gc", {});
  assert.equal(dry.status, 200, JSON.stringify(dry.data));
  assert.equal(dry.data.dry_run, true, "dry run by default");
  assert.ok(dry.data.orphans >= 2);
  assert.equal(dry.data.deleted, 0);
  assert.ok(existsSync(oldOrphan));

  const real = await api("POST", "/api/v1/admin/blobs/gc", { dry_run: false, grace_days: 7 });
  assert.equal(real.status, 200, JSON.stringify(real.data));
  assert.ok(real.data.deleted >= 1);
  assert.equal(existsSync(oldOrphan), false, "the old orphan was deleted");
  assert.equal(existsSync(freshOrphan), true, "the fresh one is within the grace period");
  assert.ok(referenced.every((p) => existsSync(p)), "version blobs are intact");
});

test("migration: tombstone and override columns exist", async () => {
  const db = new DatabaseSync(join(srv.dataDir, "skillforge.db"), { readOnly: true });
  try {
    const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    for (const c of ["meta_override", "purged_at", "purged_by"]) assert.ok(cols("artifacts").includes(c), `artifacts.${c}`);
    for (const c of ["purged_at", "purged_by"]) assert.ok(cols("artifact_versions").includes(c), `artifact_versions.${c}`);
  } finally {
    db.close();
  }
});
