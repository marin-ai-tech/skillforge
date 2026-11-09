// The second optional starter pack: three affaan-m/ECC skills in the SkillForge edition. Negative cases: no rejected candidates,
// no CodeAlive names, no references to ECC agents and skills, the agent instruction file is not written without a request,
// an unselected pack is not installed. Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { startServer, api, login, loadDir, toB64, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const PACKS = join(ROOT, "packages", "server", "starter-packs");
const PACK_DIR = join(PACKS, "ecc-essentials");
const EXPECTED = ["architecture-decision-records", "change-impact", "codebase-onboarding"];
const REJECTED = ["database-migrations", "api-design", "error-handling", "security-review", "verification-loop"];
const REPO = "affaan-m/ECC";

const readPack = () => JSON.parse(readFileSync(join(PACK_DIR, "pack.json"), "utf8"));
const skillFiles = (entry) => toB64(loadDir(join(PACK_DIR, entry.path)).map((f) => ({ path: `${entry.name}/${f.path}`, content: f.content })));
const skillText = (name) => readFileSync(join(PACK_DIR, "skills", name, "SKILL.md"), "utf8");

let srv;
let admin;

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-pack-ecc-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  admin = await login(srv.base, "admin", ADMIN_PASSWORD);
});

after(async () => {
  if (srv?.up) await srv.stop();
});

test("contents: three ECC skills with attribution and Local changes; no rejected ones and no CodeAlive names; text only", () => {
  assert.ok(existsSync(join(PACK_DIR, "pack.json")), `no ${PACK_DIR}/pack.json`);
  const pack = readPack();
  assert.equal(pack.id, "ecc-essentials");
  assert.equal(pack.license, "MIT");
  assert.deepEqual(pack.artifacts.map((a) => a.name).sort(), EXPECTED);
  for (const r of REJECTED) assert.ok(!pack.artifacts.some((a) => a.name === r), `rejected skill ${r} is in the pack`);
  const codealive = JSON.parse(readFileSync(join(PACKS, "codealive", "pack.json"), "utf8")).artifacts.map((a) => a.name);
  for (const a of pack.artifacts) assert.ok(!codealive.includes(a.name), `${a.name} matches CodeAlive`);
  const notice = readFileSync(join(PACK_DIR, "NOTICE.md"), "utf8");
  const local = notice.split("## Local changes")[1] ?? "";
  assert.ok(local.length > 0, "NOTICE.md: no Local changes section");
  for (const a of pack.artifacts) {
    assert.equal(a.repo, REPO);
    assert.match(a.commit, /^[0-9a-f]{40}$/);
    assert.ok(existsSync(join(PACK_DIR, a.path, "SKILL.md")), `${a.name}: no SKILL.md`);
    for (const needle of [a.name, a.repo, a.commit]) assert.ok(notice.includes(needle), `NOTICE.md: no "${needle}"`);
    assert.ok(local.includes(a.name), `Local changes: no edit for ${a.name}`);
    for (const f of loadDir(join(PACK_DIR, a.path))) {
      const bytes = Buffer.from(f.content);
      assert.ok(!bytes.includes(0), `${a.name}/${f.path}: NUL byte`);
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
  }
  const license = readFileSync(join(PACK_DIR, "LICENSE"), "utf8");
  assert.ok(license.includes("MIT License"), "LICENSE: no MIT text");
  assert.match(license, /Copyright \(c\)/i);
});

test("skill edits: no references to ECC; the agent instruction file only on request", () => {
  for (const name of EXPECTED) {
    const text = skillText(name);
    assert.ok(!/origin:\s*ECC/.test(text), `${name}: metadata origin ECC`);
    for (const ref of ["contract-first", "test-collaboration", "module-regression", "Planner agent", "Code reviewer agent"]) {
      assert.ok(!text.includes(ref), `${name}: reference to ${ref}`);
    }
  }
  const onboarding = skillText("codebase-onboarding");
  assert.ok(!/written to the project root/i.test(onboarding), "codebase-onboarding writes CLAUDE.md without being asked");
  assert.match(onboarding, /only when the user explicitly asks/i, "codebase-onboarding: no 'only on request' rule");
  assert.match(skillText("architecture-decision-records"), /rationale unknown/i, "ADR: no rationale-unknown rule");
  // The boundary is named from both sides — the agent instruction file
  // is part of the skill's task on request; agent settings, permissions and hooks are not.
  const description = /^description:\s*(.+)$/m.exec(onboarding)?.[1] ?? "";
  assert.match(description, /AGENTS\.md/, "the description does not name the instruction file as its task");
  assert.match(description, /settings, permissions or hooks/i, "the description does not exclude settings, permissions and hooks");
  const whenToUse = onboarding.split("## When to Use")[1]?.split("## ")[0] ?? "";
  assert.match(whenToUse, /settings, permissions (and|or) hooks/i, "When to Use does not say what is out of scope");
});

test("validation without errors and without Q_DESC_NO_BOUNDARY", async () => {
  for (const entry of readPack().artifacts) {
    const r = await api(srv.base, "POST", "/api/v1/artifacts/validate", { type: "skill", files: skillFiles(entry) }, { cookie: admin.cookie });
    assert.equal(r.status, 200, `${entry.name}: ${r.status}`);
    assert.deepEqual(r.data.errors, [], `${entry.name}: ${JSON.stringify(r.data.errors)}`);
    const codes = (r.data.quality?.checks ?? []).map((c) => c.code);
    assert.ok(!codes.includes("Q_DESC_NO_BOUNDARY"), `${entry.name}: the description has no applicability boundary`);
  }
});

test("installing only ecc-essentials: three candidates with import provenance, a repeat gives exists, CodeAlive is not installed", async () => {
  const list = await api(srv.base, "GET", "/api/v1/admin/starter-packs", undefined, { cookie: admin.cookie });
  assert.deepEqual(list.data.items.map((i) => i.id).sort(), ["codealive", "ecc-essentials"]);
  const r = await api(srv.base, "POST", "/api/v1/admin/starter-packs/ecc-essentials/install", {}, { cookie: admin.cookie });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.results.map((x) => `${x.name}:${x.status}`).sort(), EXPECTED.map((n) => `${n}:created`));
  const pack = readPack();
  for (const name of EXPECTED) {
    const card = await api(srv.base, "GET", `/api/v1/artifacts/skill/${name}`, undefined, { cookie: admin.cookie });
    assert.equal(card.data.artifact.status, "candidate");
    const entry = pack.artifacts.find((a) => a.name === name);
    assert.equal(card.data.latest.provenance.ref, `${REPO}@${entry.commit}:${entry.source_path}`);
  }
  const again = await api(srv.base, "POST", "/api/v1/admin/starter-packs/ecc-essentials/install", {}, { cookie: admin.cookie });
  assert.deepEqual(again.data.results.map((x) => x.status), ["exists", "exists", "exists"]);
  const after = await api(srv.base, "GET", "/api/v1/admin/starter-packs", undefined, { cookie: admin.cookie });
  assert.equal(after.data.items.find((i) => i.id === "ecc-essentials").installed, 3);
  assert.equal(after.data.items.find((i) => i.id === "codealive").installed, 0, "an unselected pack was installed");
});
