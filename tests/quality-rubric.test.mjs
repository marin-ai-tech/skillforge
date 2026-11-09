// Company rules as a publish gate: weights of Q_* codes, custom criteria (heading, file, forbidden phrase), a threshold and a mode
// (off | warn | block). A team can only tighten the rules for its own artifacts.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, api, login, createUser, toB64, ADMIN_PASSWORD } from "./lib/client.mjs";

const COMPANY = "/api/v1/admin/quality-rubric";
const TEAM = "/api/v1/teams/alpha/quality-rubric";
let srv;
const auth = {};
const call = (method, path, body, who = auth.admin) => api(srv.base, method, path, body, who ? { cookie: who.cookie } : {});

// A skill with an example (no Q_NO_EXAMPLE) and a "Limits" section passes the rules; without them it does not.
const GOOD = (name) => `---\nname: ${name}\ndescription: Formats notes for a rubric test. Use when testing company rules.\n---\n\n# ${name}\n\n## Limits\n\nOnly plain text.\n\n## Example\n\n\`\`\`text\ninput: a\noutput: b\n\`\`\`\n`;
const BAD = (name) => `---\nname: ${name}\ndescription: Formats notes for a rubric test. Use when testing company rules.\n---\n\n# ${name}\n\nDo it. Internal only, see TODO-SECRET.\n`;
const files = (name, md) => toB64([{ path: `${name}/SKILL.md`, content: md }]);
const publish = (name, md, who = auth.lena, extra = {}) => call("POST", "/api/v1/artifacts", { type: "skill", files: files(name, md), ...extra }, who);

const RULES = {
  threshold: 70,
  enforce: "block",
  weights: { Q_NO_EXAMPLE: 40 },
  criteria: [
    { id: "has-limits", type: "require_heading", value: "Limits", weight: 30 },
    { id: "no-todo", type: "forbid_phrase", value: "TODO-SECRET", weight: 10 },
  ],
};

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-rubric-" });
  assert.ok(srv.up, srv.stderr);
  auth.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [["lena", "contributor"], ["mia", "contributor"]]) {
    await createUser(srv.base, auth.admin.cookie, { username: u, password: `${u}-pw-123456`, role });
    auth[u] = await login(srv.base, u, `${u}-pw-123456`);
  }
  assert.equal((await call("POST", "/api/v1/teams", { name: "alpha", lead: "lena" })).status, 201);
  assert.equal((await call("POST", "/api/v1/teams/alpha/members", { username: "mia" }, auth.lena)).status, 201);
});

after(async () => {
  await srv?.stop();
});

test("only admin sets company rules; invalid ones get 400", async () => {
  assert.equal((await call("PUT", COMPANY, RULES, auth.lena)).status, 403);
  for (const bad of [
    { threshold: 101 },
    { enforce: "maybe" },
    { weights: { Q_NOT_A_CODE: 10 } },
    { criteria: [{ id: "x", type: "regex", value: ".*", weight: 5 }] },
    { criteria: [{ id: "Bad Id", type: "require_file", value: "a.md", weight: 5 }] },
  ]) {
    assert.equal((await call("PUT", COMPANY, { ...RULES, ...bad })).status, 400, JSON.stringify(bad));
  }
  const ok = await call("PUT", COMPANY, RULES);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.deepEqual((await call("GET", COMPANY, undefined, auth.mia)).data.rubric, RULES, "the rules are visible to everyone signed in");
});

test("gate: below the threshold in block mode — 422 E_RUBRIC_BLOCKED with the unmet items; above — published with a score", async () => {
  const dry = await call("POST", "/api/v1/artifacts/validate", { type: "skill", files: files("bad-notes", BAD("bad-notes")) }, auth.lena);
  assert.equal(dry.data.ok, false);
  // 100 − 40 (no example) − 30 (no Limits) − 10 (forbidden phrase) − other default Q_* checks (15 / 5).
  const others = dry.data.quality.checks.filter((c) => c.code !== "Q_NO_EXAMPLE");
  const rest = others.reduce((n, c) => n + (c.severity === "warn" ? 15 : 5), 0);
  assert.equal(dry.data.rubric.score, Math.max(0, 100 - 40 - 30 - 10 - rest));
  assert.deepEqual(
    dry.data.rubric.failed.map((f) => f.id).sort(),
    ["Q_NO_EXAMPLE", "has-limits", "no-todo", ...others.map((c) => c.code)].sort(),
  );
  const bad = await publish("bad-notes", BAD("bad-notes"));
  assert.equal(bad.status, 422, JSON.stringify(bad.data));
  assert.equal(bad.data.errors[0].code, "E_RUBRIC_BLOCKED");
  const good = await publish("good-notes", GOOD("good-notes"));
  assert.equal(good.status, 201, JSON.stringify(good.data));
  assert.equal(good.data.rubric.passed, true);
  assert.ok(good.data.rubric.score >= 70, String(good.data.rubric.score));
  const card = await call("GET", "/api/v1/artifacts/skill/good-notes");
  assert.equal(card.data.latest.rubric.passed, true, "the score is stored in the version");
});

test("warn mode publishes below the threshold and reports it; off does not score", async () => {
  assert.equal((await call("PUT", COMPANY, { ...RULES, enforce: "warn" })).status, 200);
  const warned = await publish("warned-notes", BAD("warned-notes"));
  assert.equal(warned.status, 201, JSON.stringify(warned.data));
  assert.equal(warned.data.rubric.passed, false);
  assert.equal(warned.data.rubric.enforce, "warn");
  assert.equal((await call("PUT", COMPANY, { ...RULES, enforce: "off" })).status, 200);
  const off = await publish("free-notes", BAD("free-notes"));
  assert.equal(off.status, 201);
  assert.equal(off.data.rubric ?? null, null, "no score when off");
  assert.equal((await call("PUT", COMPANY, RULES)).status, 200);
});

test("a team can only tighten; its rules apply to its artifacts, not to others", async () => {
  assert.equal((await call("PUT", TEAM, { ...RULES, threshold: 90 }, auth.mia)).status, 403, "not a lead");
  for (const looser of [{ threshold: 60 }, { enforce: "warn" }, { weights: { Q_NO_EXAMPLE: 10 } }]) {
    const r = await call("PUT", TEAM, { ...RULES, ...looser }, auth.lena);
    assert.equal(r.status, 400, JSON.stringify(looser));
    assert.equal(r.data.error, "rubric_looser");
  }
  const tight = { threshold: 95, enforce: "block", weights: {}, criteria: [{ id: "team-readme", type: "require_file", value: "README.md", weight: 20 }] };
  assert.equal((await call("PUT", TEAM, tight, auth.lena)).status, 200);
  // A team artifact: company (threshold 70) + team (95, needs README.md) — GOOD without README gets 80 < 95.
  const teamPub = await publish("team-notes", GOOD("team-notes"), auth.lena, { visibility: "team", owner_team: "alpha" });
  assert.equal(teamPub.status, 422, JSON.stringify(teamPub.data));
  assert.equal(teamPub.data.errors[0].code, "E_RUBRIC_BLOCKED");
  // The same text without a team passes: the alpha rules do not apply to it.
  assert.equal((await publish("org-notes", GOOD("org-notes"))).status, 201);
});

test("rule changes are in the audit log", async () => {
  const items = (await call("GET", "/api/v1/admin/audit?action=quality_rubric_change&limit=100")).data.items;
  assert.ok(items.some((e) => e.target === "company"), JSON.stringify(items));
  assert.ok(items.some((e) => e.target === "alpha" && e.actor === "lena"));
});
