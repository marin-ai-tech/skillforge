// Duplicates in an agent snapshot (including one skill in two roots, which once caused 500 UNIQUE constraint)
// and duplicates in the registry. Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { startServer, api, login, ADMIN_PASSWORD } from "./lib/client.mjs";

const b64 = (s) => Buffer.from(s).toString("base64");
const skillMd = (name, description, body) => `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`;
const ALPHA_DESC = "Writes concise release notes from merged pull requests and commit history. Use when preparing a release announcement.";
const BETA_DESC = "Writes concise release notes from merged pull requests and commit history. Use when drafting a release announcement.";
const NOTES_BODY = "# Release notes\n\nCollect merged pull requests since the last tag.\nGroup them by area and keep one line per change.\n\nSee [the guide](references/GUIDE.md).\n";
const GUIDE = "# Release notes guide\n\n" + "Every entry starts with a verb in the past tense and names the user-visible effect of the change. ".repeat(6);

const alphaFiles = (body = NOTES_BODY) => [
  { path: "alpha-writer/SKILL.md", content_base64: b64(skillMd("alpha-writer", ALPHA_DESC, body)) },
  { path: "alpha-writer/references/GUIDE.md", content_base64: b64(GUIDE) },
];
// Same body text, different name and almost the same description; CRLF line endings and trailing spaces must not interfere.
const betaFiles = () => [
  { path: "beta-writer/SKILL.md", content_base64: b64(skillMd("beta-writer", BETA_DESC, NOTES_BODY.replace(/\n/g, "  \r\n") + "\r\n\r\n")) },
  { path: "beta-writer/references/GUIDE.md", content_base64: b64(GUIDE + "\nBeta specific addendum.\n") },
];
const gammaFiles = () => [
  {
    path: "gamma-writer/SKILL.md",
    content_base64: b64(skillMd("gamma-writer", "Formats changelog entries for internal libraries. Use when a library bumps its version.", "# Changelog\n\nFollow [the guide](references/GUIDE.md) for wording.\n")),
  },
  { path: "gamma-writer/references/GUIDE.md", content_base64: b64(GUIDE) },
];
const soloFiles = () => [
  { path: "solo-tool/SKILL.md", content_base64: b64(skillMd("solo-tool", "Converts spreadsheet exports into typed JSON fixtures. Use when seeding integration tests.", "# Solo\n\nParse the header row, infer column types, emit JSON.\n")) },
];

let srv;
let base;
let admin;

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-dups-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
});

after(async () => {
  if (srv?.up) await srv.stop();
});

const auth = () => ({ cookie: admin.cookie });
const kinds = (list, type, name) => list.filter((d) => d.type === type && d.name === name).map((d) => d.kind);

test("agent snapshot: one skill in two roots does not break the snapshot; classes replica / divergent / stale_backup", async () => {
  const dupMd = skillMd("dup-skill", "Duplicate probe skill for snapshot checks. Use when testing duplicates.", "# Dup\n\nSame everywhere.\n");
  const files = [
    { path: ".claude/skills/dup-skill/SKILL.md", content_base64: b64(dupMd) },
    { path: ".agents/skills/dup-skill/SKILL.md", content_base64: b64(dupMd) },
    { path: ".claude/skills/div-skill/SKILL.md", content_base64: b64(skillMd("div-skill", "Divergent probe skill. Use when testing duplicates.", "# Div\n\nVersion A.\n")) },
    { path: "skills/div-skill/SKILL.md", content_base64: b64(skillMd("div-skill", "Divergent probe skill. Use when testing duplicates.", "# Div\n\nVersion B, edited.\n")) },
    { path: ".claude/skills/note/SKILL.md", content_base64: b64(skillMd("note", "Keeps short notes. Use when the user asks to remember something.", "# Note\n\nCurrent.\n")) },
    { path: ".claude/skills/note.bak/SKILL.md", content_base64: b64(skillMd("note", "Keeps short notes. Use when the user asks to remember something.", "# Note\n\nOld copy.\n")) },
  ];
  const put = await api(base, "PUT", "/api/v1/me/agents/dups", { files }, auth());
  assert.equal(put.status, 200, `a snapshot with duplicates must be accepted: ${put.status} ${JSON.stringify(put.data)}`);
  const raw = JSON.stringify(put.data);
  assert.ok(!/SQLITE|constraint/i.test(raw), "internal database errors do not reach the response");

  const keys = put.data.items.map((i) => i.key).sort();
  assert.deepEqual(keys, ["skill/div-skill", "skill/dup-skill", "skill/note"], "each key appears once");
  const rootOf = (k) => put.data.items.find((i) => i.key === k).root;
  assert.equal(rootOf("skill/dup-skill"), ".claude/skills/dup-skill");
  assert.equal(rootOf("skill/div-skill"), ".claude/skills/div-skill");
  assert.equal(rootOf("skill/note"), ".claude/skills/note", "a backup does not become the primary item");

  const d = put.data.duplicates;
  assert.deepEqual(d.map((g) => [g.key, g.class, g.keep]), [
    ["skill/div-skill", "divergent", ".claude/skills/div-skill"],
    ["skill/dup-skill", "replica", ".claude/skills/dup-skill"],
    ["skill/note", "stale_backup", ".claude/skills/note"],
  ]);
  assert.deepEqual(d[0].roots.map((r) => r.root), [".claude/skills/div-skill", "skills/div-skill"]);
  assert.notEqual(d[0].roots[0].digest, d[0].roots[1].digest);
  assert.deepEqual(d[1].roots.map((r) => r.root), [".agents/skills/dup-skill", ".claude/skills/dup-skill"]);
  assert.equal(d[1].roots[0].digest, d[1].roots[1].digest);
  assert.deepEqual(d[2].roots.map((r) => r.root), [".claude/skills/note", ".claude/skills/note.bak"]);
  for (const g of d) assert.ok(typeof g.reason === "string" && g.reason.length > 0);

  const get = await api(base, "GET", "/api/v1/me/agents/dups", undefined, auth());
  assert.equal(get.status, 200);
  assert.deepEqual(get.data.duplicates, d, "GET agent returns the same groups");

  const clean = await api(base, "PUT", "/api/v1/me/agents/clean", { files: [files[0]] }, auth());
  assert.equal(clean.status, 200);
  assert.deepEqual(clean.data.duplicates, []);
});

test("registry: the same text under another name gives identical_body and similar_description; publication is not blocked", async () => {
  const pubA = await api(base, "POST", "/api/v1/artifacts", { type: "skill", files: alphaFiles() }, auth());
  assert.equal(pubA.status, 201, JSON.stringify(pubA.data));
  assert.deepEqual(pubA.data.duplicates, []);

  const v = await api(base, "POST", "/api/v1/artifacts/validate", { type: "skill", files: betaFiles() }, auth());
  assert.equal(v.status, 200, JSON.stringify(v.data));
  assert.deepEqual(kinds(v.data.duplicates, "skill", "alpha-writer"), ["identical_body", "similar_description"]);
  const sim = v.data.duplicates.find((x) => x.kind === "similar_description");
  assert.ok(sim.detail.score >= 0.6 && sim.detail.score <= 1, JSON.stringify(sim));
  assert.equal(Math.round(sim.detail.score * 100) / 100, sim.detail.score, "score is rounded to two decimals");

  const pubB = await api(base, "POST", "/api/v1/artifacts", { type: "skill", files: betaFiles() }, auth());
  assert.equal(pubB.status, 201, "duplicates do not block publication");
  assert.deepEqual(pubB.data.duplicates, v.data.duplicates);
});

test("a name of another type is name_collision; a shared reference file is shared_files", async () => {
  const cmd = `---\ndescription: Release notes command for the alpha writer flow. Use when asked for notes.\n---\n\nRun the alpha writer.\n`;
  const v = await api(base, "POST", "/api/v1/artifacts/validate", { type: "command", files: [{ path: "alpha-writer.md", content_base64: b64(cmd) }] }, auth());
  assert.equal(v.status, 200, JSON.stringify(v.data));
  assert.deepEqual(kinds(v.data.duplicates, "skill", "alpha-writer"), ["name_collision"]);
  const pubCmd = await api(base, "POST", "/api/v1/artifacts", { type: "command", files: [{ path: "alpha-writer.md", content_base64: b64(cmd) }] }, auth());
  assert.equal(pubCmd.status, 201, JSON.stringify(pubCmd.data));

  const g = await api(base, "POST", "/api/v1/artifacts/validate", { type: "skill", files: gammaFiles() }, auth());
  assert.equal(g.status, 200);
  assert.deepEqual(kinds(g.data.duplicates, "skill", "alpha-writer"), ["shared_files"]);
  const shared = g.data.duplicates.find((x) => x.kind === "shared_files");
  assert.deepEqual(shared.detail.paths, ["skills/gamma-writer/references/GUIDE.md"]);
  assert.ok(!g.data.duplicates.some((x) => x.name === "beta-writer" && x.kind === "shared_files"), "beta has a different GUIDE.md");
  // Order: by kind, then type, then name.
  const order = ["name_collision", "identical_body", "shared_files", "similar_description"];
  const sorted = [...g.data.duplicates].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  assert.deepEqual(g.data.duplicates, sorted);
});

test("card route: duplicates of the latest version; a unique one is empty; an unknown one is 404", async () => {
  const r = await api(base, "GET", "/api/v1/artifacts/skill/beta-writer/duplicates", undefined, auth());
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(kinds(r.data.items, "skill", "alpha-writer"), ["identical_body", "similar_description"]);
  const pub = await api(base, "POST", "/api/v1/artifacts", { type: "skill", files: soloFiles() }, auth());
  assert.equal(pub.status, 201);
  const solo = await api(base, "GET", "/api/v1/artifacts/skill/solo-tool/duplicates", undefined, auth());
  assert.deepEqual(solo.data.items, []);
  const missing = await api(base, "GET", "/api/v1/artifacts/skill/no-such-skill/duplicates", undefined, auth());
  assert.equal(missing.status, 404);
});

test("a new version of the same artifact is not counted as its duplicate", async () => {
  const v = await api(base, "POST", "/api/v1/artifacts/validate", { type: "skill", files: alphaFiles(NOTES_BODY + "\nAlso mention breaking changes first.\n") }, auth());
  assert.equal(v.status, 200);
  assert.ok(!v.data.duplicates.some((x) => x.type === "skill" && x.name === "alpha-writer"), JSON.stringify(v.data.duplicates));
  assert.deepEqual(kinds(v.data.duplicates, "command", "alpha-writer"), ["name_collision"], "a command with the same name is another type");
});

test("the body fingerprint is backfilled on start", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "skillforge-dups-backfill-"));
  let s1;
  let s2;
  try {
    s1 = await startServer({ SKILLFORGE_DATA_DIR: dataDir }, { prefix: "skillforge-dups-s1-" });
    assert.ok(s1.up, s1.stderr);
    const a1 = await login(s1.base, "admin", ADMIN_PASSWORD);
    assert.equal((await api(s1.base, "POST", "/api/v1/artifacts", { type: "skill", files: alphaFiles() }, { cookie: a1.cookie })).status, 201);
    await s1.stop();
    const db = new DatabaseSync(join(dataDir, "skillforge.db"));
    const changed = db.prepare("UPDATE artifact_versions SET body_sha256 = NULL").run();
    db.close();
    assert.ok(changed.changes >= 1);
    s2 = await startServer({ SKILLFORGE_DATA_DIR: dataDir }, { prefix: "skillforge-dups-s2-" });
    assert.ok(s2.up, s2.stderr);
    const a2 = await login(s2.base, "admin", ADMIN_PASSWORD);
    const v = await api(s2.base, "POST", "/api/v1/artifacts/validate", { type: "skill", files: betaFiles() }, { cookie: a2.cookie });
    assert.ok(kinds(v.data.duplicates, "skill", "alpha-writer").includes("identical_body"), JSON.stringify(v.data.duplicates));
  } finally {
    if (s1?.up) await s1.stop();
    if (s2?.up) await s2.stop();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
