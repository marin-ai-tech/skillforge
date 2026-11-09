// Acceptance tests: plugin badges on artifact cards.
// A plugin can put a badge on an artifact card (`ctx.registry.setBadge` / `clearBadge`); the badge is visible in the catalog
// and the review queue and disappears when the plugin is disabled. review-assistant sets a badge with the check outcome, so a
// reviewer sees the findings without opening the artifact.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, toB64, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";
import { startFakeLlm } from "./lib/fake-llm.mjs";

const KEY = "sk-test-KEYMARKER-badges-0123456789";
let srv;
let fake;
let work;
const auth = {};
const call = (method, path, body, who = auth.admin) => api(srv.base, method, path, body, who ? { cookie: who.cookie } : {});
const md = (name) =>
  `---\nname: ${name}\ndescription: Badge probe ${name}. Use when testing badges.\n---\n\n# ${name}\n\nAlways use the latest version of the tool.\n`;
async function publish(name) {
  const r = await call("POST", "/api/v1/artifacts", { type: "skill", files: toB64([{ path: `${name}/SKILL.md`, content: md(name) }]) }, auth.alice);
  assert.equal(r.status, 201, JSON.stringify(r.data));
}
const badgesOf = async (name) => (await call("GET", `/api/v1/artifacts/skill/${name}`)).data.artifact.badges;
const listed = async (name) => (await call("GET", "/api/v1/artifacts?limit=200")).data.items.find((a) => a.name === name);

before(async () => {
  work = mkdtempSync(join(tmpdir(), "skillforge-badges-"));
  const pluginsDir = join(work, "plugins");
  cpSync(join(ROOT, "tests", "fixtures", "plugins", "badge-probe"), join(pluginsDir, "badge-probe"), { recursive: true });
  fake = await startFakeLlm();
  srv = await startServer(
    {
      SKILLFORGE_PLUGINS_DIR: pluginsDir,
      SKILLFORGE_BUNDLED_PLUGINS_DIR: join(ROOT, "plugins"),
      SKILLFORGE_LLM_API_KEY: KEY,
      SKILLFORGE_LLM_KEY_ORIGINS: fake.origin,
      SKILLFORGE_REVIEWERS_FILE: join(work, "no-such-reviewers.json"),
    },
    { prefix: "skillforge-badges-srv-" },
  );
  assert.ok(srv.up, srv.stderr);
  auth.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [["alice", "contributor"], ["rita", "reviewer"]]) {
    await createUser(srv.base, auth.admin.cookie, { username: u, password: `${u}-pw-123456`, role });
    auth[u] = await login(srv.base, u, `${u}-pw-123456`);
  }
});

after(async () => {
  await srv?.stop();
  await fake?.stop();
  rmSync(work, { recursive: true, force: true });
});

test("a plugin sets a badge: card, catalog and review queue; an invalid badge is rejected; clearing removes it", async () => {
  await publish("badged-skill");
  const B = "/api/v1/ext/badge-probe/badge/skill/badged-skill";
  for (const bad of [{ id: "x", label: "", tone: "ok" }, { id: "Bad Id", label: "L", tone: "ok" }, { id: "x", label: "L", tone: "purple" }, { id: "x", label: "L".repeat(41), tone: "ok" }, { id: "x", label: "L", labels: { xx: "L" }, tone: "ok" }, { id: "x", label: "L", labels: { en: "" }, tone: "ok" }, { id: "x", label: "L", labels: "en", tone: "ok" }]) {
    assert.equal((await call("POST", B, bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await call("POST", B, { id: "probe", label: "Probe: 2", tone: "warn" })).status, 200);
  const want = [{ plugin: "badge-probe", id: "probe", label: "Probe: 2", labels: {}, tone: "warn" }];
  assert.deepEqual((await badgesOf("badged-skill")).map(({ updated_at: _u, ...b }) => b), want);
  assert.deepEqual((await listed("badged-skill")).badges.map(({ updated_at: _u, ...b }) => b), want);
  const board = (await call("GET", "/api/v1/lifecycle/board", undefined, auth.rita)).data;
  assert.equal(board.review.find((a) => a.name === "badged-skill")?.badges?.[0]?.label, "Probe: 2", "review queue");
  assert.equal((await call("POST", B, { id: "probe", label: "Probe: 0", labels: { en: "Probe zero" }, tone: "ok" })).status, 200);
  assert.equal((await badgesOf("badged-skill")).length, 1, "the same id replaces the badge");
  assert.deepEqual((await badgesOf("badged-skill"))[0].labels, { en: "Probe zero" }, "a label per interface language is stored and returned");
  assert.equal((await call("DELETE", `${B}/probe`)).status, 200);
  assert.deepEqual(await badgesOf("badged-skill"), []);
});

test("a disabled plugin's badges are not shown", async () => {
  await publish("muted-skill");
  assert.equal((await call("POST", "/api/v1/ext/badge-probe/badge/skill/muted-skill", { id: "probe", label: "Probe", tone: "info" })).status, 200);
  assert.equal((await badgesOf("muted-skill")).length, 1);
  assert.equal((await call("PATCH", "/api/v1/admin/plugins/badge-probe", { enabled: false })).status, 200);
  assert.deepEqual(await badgesOf("muted-skill"), []);
  assert.equal((await call("PATCH", "/api/v1/admin/plugins/badge-probe", { enabled: true })).status, 200);
});

test("review-assistant sets a badge with the outcome of the model check", async () => {
  assert.equal((await call("PUT", "/api/v1/admin/llm", { base_url: fake.url, model: "m1", validation_enabled: true })).status, 200);
  fake.setReply(
    JSON.stringify({
      findings: [{ severity: "high", category: "unsafe_command", file: "skills/checked-skill/SKILL.md", quote: "Always use the latest version", summary: "Unpinned tool version", suggestion: "Pin the version" }],
    }),
  );
  await publish("checked-skill");
  const deadline = Date.now() + 30000;
  let badge;
  while (!badge && Date.now() < deadline) {
    badge = (await badgesOf("checked-skill")).find((b) => b.plugin === "review-assistant");
    if (!badge) await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(badge, "the check badge did not appear");
  assert.equal(badge.tone, "warn");
  assert.equal(badge.label, "Review: 1 finding", "the English label is always set, with the singular form");
  // Translated labels come from optional plugin locale files; whatever is there names the same count.
  assert.equal(typeof badge.labels, "object");
  for (const [lang, text] of Object.entries(badge.labels)) assert.match(text, /(^|\D)1(\D|$)/, `label ${lang}: ${text}`);
});
