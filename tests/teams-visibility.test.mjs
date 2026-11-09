// Acceptance tests for teams and visibility, part A.
// The main protection is the matrix "an outsider does not see a team artifact": if the test is red, it is a leak, not a nitpick.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { startServer, api as rawApi, login, createUser, loadDir, toB64, FIXTURES, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

let srv;
let base;
const U = {}; // username -> { cookie }
const auth = (who) => (who === "anon" ? {} : { cookie: U[who].cookie });
const api = (method, path, body, who = "admin") => rawApi(base, method, path, body, auth(who));
const skillFiles = loadDir(join(FIXTURES, "skill-standard"));
const rename = (to) =>
  skillFiles.map((f) => ({
    path: f.path.replace("pdf-tools", to),
    content: f.path.endsWith("SKILL.md") ? Buffer.from(f.content.toString("utf8").replace(/^name: pdf-tools$/m, `name: ${to}`)) : f.content,
  }));
const publish = (name, who, extra = {}, version) =>
  api("POST", "/api/v1/artifacts", { type: "skill", ...(version ? { version } : {}), files: toB64(rename(name)), ...extra }, who);
const activate = (name) => api("POST", `/api/v1/artifacts/skill/${name}/transitions`, { to: "active", reason: "test" });
const names = (r) => (r.data.items ?? []).map((i) => i.name);
const NOT_FOUND = { error: "not_found" };

const INSIDERS = ["lena", "mia", "carl", "rita", "admin"]; // lead, member, collaborator, reviewer, admin
const OUTSIDERS = ["oscar", "vera", "alice", "ben", "anon"]; // no team, no rights

before(async () => {
  srv = await startServer({ SKILLFORGE_ORCHESTRATION_ENABLED: "true" }, { prefix: "skillforge-teams-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  U.admin = await login(base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [["lena", "contributor"], ["mia", "viewer"], ["carl", "contributor"], ["rita", "reviewer"], ["oscar", "contributor"], ["vera", "viewer"], ["alice", "contributor"], ["ben", "contributor"]]) {
    await createUser(base, U.admin.cookie, { username: u, password: `${u}-pw-123`, role });
    U[u] = await login(base, u, `${u}-pw-123`);
  }
});

after(async () => {
  await srv?.stop();
});

test("teams: creation (admin), validation, duplicate, members, last_lead, reading and permissions", async () => {
  assert.equal((await api("POST", "/api/v1/teams", { name: "alpha", lead: "lena" }, "lena")).status, 403, "not admin");
  assert.equal((await api("POST", "/api/v1/teams", { name: "Bad Name", lead: "lena" })).status, 400);
  assert.equal((await api("POST", "/api/v1/teams", { name: "alpha", lead: "nobody" })).status, 422);
  const a = await api("POST", "/api/v1/teams", { name: "alpha", display_name: "Alpha", lead: "lena" });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  assert.equal((await api("POST", "/api/v1/teams", { name: "ALPHA", lead: "lena" })).status, 409, "case-insensitive duplicate");
  assert.equal((await api("POST", "/api/v1/teams", { name: "beta", lead: "ben" })).status, 201);

  assert.equal((await api("POST", "/api/v1/teams/alpha/members", { username: "mia" }, "lena")).status, 201);
  assert.equal((await api("POST", "/api/v1/teams/alpha/members", { username: "mia" }, "lena")).status, 200, "idempotent");
  assert.equal((await api("POST", "/api/v1/teams/alpha/members", { username: "nobody" }, "lena")).status, 422);
  assert.equal((await api("POST", "/api/v1/teams/alpha/members", { username: "oscar" }, "mia")).status, 403, "a member, not lead");
  assert.equal((await api("POST", "/api/v1/teams/alpha/members", { username: "oscar" }, "ben")).status, 404, "an outsider, not a member");
  assert.equal((await api("DELETE", "/api/v1/teams/alpha/members/lena", undefined, "lena")).status, 409, "the last lead");

  const list = await api("GET", "/api/v1/teams", undefined, "oscar");
  assert.equal(list.status, 200);
  const alpha = list.data.items.find((t) => t.name === "alpha");
  assert.equal(alpha.members_count, null, "an outsider does not see the member count");
  assert.equal(alpha.is_member, false);
  assert.equal((await api("GET", "/api/v1/teams", undefined, "anon")).status, 401);
  const mine = (await api("GET", "/api/v1/teams/alpha", undefined, "mia")).data;
  assert.deepEqual(mine.members.map((m) => m.username).sort(), ["lena", "mia"]);
  assert.equal((await api("GET", "/api/v1/teams/alpha", undefined, "oscar")).data.members, null);
  assert.equal((await api("GET", "/api/v1/teams/nope", undefined, "oscar")).status, 404);
  const audit = await api("GET", "/api/v1/teams/alpha/audit", undefined, "mia");
  assert.ok(audit.data.items.some((e) => e.action === "member_add"));
  assert.equal((await api("GET", "/api/v1/teams/alpha/audit", undefined, "oscar")).status, 404);
});

test("publishing to a team: team_required / team_unknown / not_team_member; fields are ignored for an existing artifact", async () => {
  assert.equal((await publish("team-skill", "lena", { visibility: "team" })).data.error, "team_required");
  assert.equal((await publish("team-skill", "lena", { visibility: "team", owner_team: "nope" })).data.error, "team_unknown");
  const denied = await publish("team-skill", "oscar", { visibility: "team", owner_team: "alpha" });
  assert.equal(denied.status, 403);
  assert.equal(denied.data.error, "not_team_member");
  const ok = await publish("team-skill", "lena", { visibility: "team", owner_team: "alpha" });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  const card = (await api("GET", "/api/v1/artifacts/skill/team-skill", undefined, "lena")).data.artifact;
  assert.equal(card.visibility, "team");
  assert.equal(card.owner_team, "alpha");
  assert.equal(card.owner, "lena");
  assert.deepEqual(card.labels, []);
  assert.equal((await activate("team-skill")).status, 200);
  assert.equal((await api("POST", "/api/v1/artifacts/skill/team-skill/maintainers", { username: "carl" }, "lena")).status, 200);

  // org artifact: published by alice; scope fields of an existing artifact are ignored
  assert.equal((await publish("org-skill", "alice")).status, 201);
  assert.equal((await activate("org-skill")).status, 200);
  const v2 = toB64(rename("org-skill").map((f) => (f.path.endsWith("SKILL.md") ? { path: f.path, content: Buffer.from(f.content.toString("utf8") + "\nSecond version.\n") } : f)));
  const again = await api("POST", "/api/v1/artifacts", { type: "skill", version: "0.2.0", files: v2, visibility: "team", owner_team: "alpha" }, "alice");
  assert.equal(again.status, 201, JSON.stringify(again.data));
  assert.equal((await api("GET", "/api/v1/artifacts/skill/org-skill")).data.artifact.visibility, "org");
});

test("MATRIX: an outsider does not see a team artifact on any read route; permitted users do", async () => {
  const N = "team-skill";
  const paths = [
    `/api/v1/artifacts/skill/${N}`,
    `/api/v1/artifacts/skill/${N}/versions`,
    `/api/v1/artifacts/skill/${N}/versions/0.1.0`,
    `/api/v1/artifacts/skill/${N}/versions/latest`,
    `/api/v1/artifacts/skill/${N}/versions/0.1.0/files/skills/${N}/SKILL.md`,
    `/api/v1/artifacts/skill/${N}/versions/0.1.0/bundle.zip`,
    `/api/v1/artifacts/skill/${N}/audit`,
    `/api/v1/artifacts/skill/${N}/duplicates`,
    `/api/v1/artifacts/skill/${N}/resolve?spec=latest`,
    `/api/v1/artifacts/skill/${N}/metrics`,
    `/api/v1/artifacts/skill/${N}/usage`,
    `/api/v1/plugins/skill/${N}/0.1.0.tar.gz`,
    `/api/v1/plugins/skill/${N}/latest.tar.gz`,
  ];
  const ghost = await rawApi(base, "GET", "/api/v1/artifacts/skill/does-not-exist", undefined, {});
  assert.equal(ghost.status, 404);
  for (const p of paths) {
    for (const who of INSIDERS) {
      const r = await api("GET", p, undefined, who);
      assert.ok(r.status === 200, `${who} must see ${p}: ${r.status}`);
    }
    for (const who of OUTSIDERS) {
      const r = await api("GET", p, undefined, who);
      assert.equal(r.status, 404, `LEAK: ${who} sees ${p}: ${r.status}`);
      if (r.data && !(r.data instanceof ArrayBuffer)) assert.deepEqual(r.data, NOT_FOUND, `${who} ${p}: the body differs from that of a nonexistent one`);
    }
  }
  // writing is hidden too: 404, not 403
  const writes = [
    ["POST", `/api/v1/artifacts/skill/${N}/transitions`, { to: "retired", reason: "x" }],
    ["POST", `/api/v1/artifacts/skill/${N}/owner`, { owner: "oscar", reason: "x" }],
    ["POST", `/api/v1/artifacts/skill/${N}/maintainers`, { username: "oscar" }],
    ["POST", `/api/v1/artifacts/skill/${N}/versions/0.1.0/channel`, { channel: "beta" }],
    ["POST", `/api/v1/artifacts/skill/${N}/versions/0.1.0/validate`, { note: "x" }],
    ["PUT", `/api/v1/artifacts/skill/${N}/scope`, { visibility: "org", owner_team: null }],
    ["PUT", `/api/v1/artifacts/skill/${N}/labels`, { labels: ["x"] }],
  ];
  for (const [m, p, b] of writes) {
    for (const who of OUTSIDERS.filter((w) => w !== "anon")) {
      const r = await api(m, p, b, who);
      assert.equal(r.status, 404, `write LEAK: ${who} ${m} ${p}: ${r.status} ${JSON.stringify(r.data)}`);
    }
  }
  // run-outputs: the visibility gate → 404 for outsiders; then canManageEvals.
  // The list for managers is 200 (empty items is acceptable); for :id paths it is 404, since there are no outputs.
  const managers = ["lena", "carl", "rita", "admin"];
  const runList = `/api/v1/artifacts/skill/${N}/run-outputs`;
  for (const who of OUTSIDERS) {
    const r = await api("GET", runList, undefined, who);
    assert.equal(r.status, 404, `LEAK: ${who} sees ${runList}: ${r.status}`);
  }
  assert.equal((await api("GET", runList, undefined, "mia")).status, 403, "a member without canManageEvals: list");
  for (const who of managers) {
    const r = await api("GET", runList, undefined, who);
    assert.equal(r.status, 200, `manager ${who}: run-outputs list`);
    assert.ok(Array.isArray(r.data.items), `manager ${who}: items is an array`);
  }
  for (const p of [`${runList}/1`, `${runList}/1/content`]) {
    for (const who of OUTSIDERS) {
      const r = await api("GET", p, undefined, who);
      assert.equal(r.status, 404, `LEAK: ${who} sees ${p}: ${r.status}`);
    }
    assert.equal((await api("GET", p, undefined, "mia")).status, 403, `a member without canManageEvals: ${p}`);
    for (const who of managers) {
      const r = await api("GET", p, undefined, who);
      assert.equal(r.status, 404, `manager ${who}: ${p} — no output (not a leak)`);
    }
  }
  // workflows: the same chain of gates — 404 for outsiders, 403 for a member
  // without canManageEvals, the list is 200 for managers; :wf/runs and runs/:id paths — 404 (no such object).
  const wfBase = `/api/v1/artifacts/skill/${N}/workflows`;
  for (const who of OUTSIDERS) {
    const r = await api("GET", wfBase, undefined, who);
    assert.equal(r.status, 404, `LEAK: ${who} sees ${wfBase}: ${r.status}`);
  }
  assert.equal((await api("GET", wfBase, undefined, "mia")).status, 403, "a member without canManageEvals: workflows");
  for (const who of managers) {
    const r = await api("GET", wfBase, undefined, who);
    assert.equal(r.status, 200, `manager ${who}: workflows list`);
  }
  // Each route is checked with its own method: outsiders → 404 (visibility before auth),
  // mia → 403 (gate), managers → an object-level answer (200 list / 404 "no such object").
  for (const [m, p, mgrStatus] of [
    ["GET", `${wfBase}/pipe`, 404],
    ["PUT", `${wfBase}/pipe`, 422],
    ["DELETE", `${wfBase}/pipe`, 404],
    ["POST", `${wfBase}/pipe/runs`, 404],
    ["GET", `${wfBase}/runs`, 200],
    ["GET", `${wfBase}/runs/1`, 404],
    ["POST", `${wfBase}/runs/1/cancel`, 404],
    ["POST", `${wfBase}/runs/1/replay`, 404],
  ]) {
    const body = m === "GET" ? undefined : m === "PUT" ? { definition: {} } : {};
    for (const who of OUTSIDERS) {
      const r = await api(m, p, body, who);
      // write: auth comes before visibility — 401 for anon, 404 for the other outsiders
      assert.equal(r.status, m === "GET" || who !== "anon" ? 404 : 401, `LEAK: ${who} ${m} ${p}: ${r.status}`);
    }
    assert.equal((await api(m, p, body, "mia")).status, 403, `a member without canManageEvals: ${m} ${p}`);
    for (const who of managers) {
      const r = await api(m, p, body, who);
      assert.equal(r.status, mgrStatus, `manager ${who}: ${m} ${p}`);
    }
  }
  // routines: the same chain of gates — 404 for outsiders, 403 for a member
  // without canManageEvals, the list is 200 for managers; :rt and runs/:id paths — 404 (no such object).
  const rtBase = `/api/v1/artifacts/skill/${N}/routines`;
  for (const who of OUTSIDERS) {
    const r = await api("GET", rtBase, undefined, who);
    assert.equal(r.status, 404, `LEAK: ${who} sees ${rtBase}: ${r.status}`);
  }
  assert.equal((await api("GET", rtBase, undefined, "mia")).status, 403, "a member without canManageEvals: routines");
  for (const who of managers) {
    const r = await api("GET", rtBase, undefined, who);
    assert.equal(r.status, 200, `manager ${who}: routines list`);
  }
  for (const [m, p, mgrStatus] of [
    ["GET", `${rtBase}/tick`, 404],
    ["PUT", `${rtBase}/tick`, 422],
    ["DELETE", `${rtBase}/tick`, 404],
    ["POST", `${rtBase}/tick/run`, 404],
    ["POST", `${rtBase}/tick/disable`, 404],
    ["POST", `${rtBase}/tick/enable`, 404],
    ["GET", `${rtBase}/runs`, 200],
    ["GET", `${rtBase}/runs/1`, 404],
  ]) {
    const body = m === "GET" ? undefined : m === "PUT" ? { definition: {} } : {};
    for (const who of OUTSIDERS) {
      const r = await api(m, p, body, who);
      // write: auth comes before visibility — 401 for anon, 404 for the other outsiders
      assert.equal(r.status, m === "GET" || who !== "anon" ? 404 : 401, `LEAK: ${who} ${m} ${p}: ${r.status}`);
    }
    assert.equal((await api(m, p, body, "mia")).status, 403, `a member without canManageEvals: ${m} ${p}`);
    for (const who of managers) {
      const r = await api(m, p, body, who);
      assert.equal(r.status, mgrStatus, `manager ${who}: ${m} ${p}`);
    }
  }
  // evals/batches: the same chain of gates — 404 for outsiders,
  // 403 for a member without canManageEvals; the list is 200 for managers, :id — 404 (no such batch).
  const btBase = `/api/v1/artifacts/skill/${N}/evals/batches`;
  const batchBody = { kind: "trigger", version: "0.1.0" };
  for (const [m, p, mgrStatus] of [
    ["GET", btBase, 200],
    ["GET", `${btBase}/1`, 404],
    ["POST", btBase, 503], // a valid body reaches createBatch → runners_not_configured
  ]) {
    const body = m === "GET" ? undefined : batchBody;
    for (const who of OUTSIDERS) {
      const r = await api(m, p, body, who);
      // evals plugin: the visibility preHandler runs before auth — 404 for all outsiders (and for anon)
      assert.equal(r.status, 404, `LEAK: ${who} ${m} ${p}: ${r.status}`);
    }
    assert.equal((await api(m, p, body, "mia")).status, 403, `a member without canManageEvals: ${m} ${p}`);
    for (const who of managers) {
      const r = await api(m, p, body, who);
      assert.equal(r.status, mgrStatus, `manager ${who}: ${m} ${p}: ${JSON.stringify(r.data)}`);
    }
  }
  // overhang: visibility before auth — 404 for outsiders,
  // a member without the reviewer+ role → 403, reviewer+ → 200 (the verdict unknown is acceptable).
  const ohPath = `/api/v1/artifacts/skill/${N}/overhang`;
  for (const who of OUTSIDERS) {
    const r = await api("GET", ohPath, undefined, who);
    assert.equal(r.status, 404, `LEAK: ${who} sees ${ohPath}: ${r.status}`);
  }
  // members without the reviewer+ role → 403 (lena/carl are contributors, mia is a viewer)
  for (const who of ["lena", "carl", "mia"]) {
    assert.equal((await api("GET", ohPath, undefined, who)).status, 403, `${who}: overhang`);
  }
  for (const who of ["rita", "admin"]) {
    const r = await api("GET", ohPath, undefined, who);
    assert.equal(r.status, 200, `reviewer+ ${who}: overhang ${JSON.stringify(r.data)}`);
  }
  // provenance: GET is like /audit (visibility by the global preHandler,
  // reading is open to a viewer); POST derive — owner/maintainer|reviewer+.
  const plPath = `/api/v1/artifacts/skill/${N}/provenance`;
  for (const who of OUTSIDERS) {
    assert.equal((await api("GET", plPath, undefined, who)).status, 404, `LEAK: ${who} GET ${plPath}`);
    // write: auth comes before visibility — 401 for anon, 404 for the other outsiders
    const post = await api("POST", plPath, {}, who);
    assert.equal(post.status, who === "anon" ? 401 : 404, `LEAK: ${who} POST ${plPath}: ${post.status}`);
  }
  // reading is open to everyone who sees the artifact
  for (const who of ["mia", "lena", "carl", "rita", "admin"]) {
    assert.equal((await api("GET", plPath, undefined, who)).status, 200, `${who}: GET provenance`);
  }
  // write: members without rights on the version → 403, reviewer+ → 400 (a valid call reaches body validation)
  for (const who of ["mia"]) {
    assert.equal((await api("POST", plPath, {}, who)).status, 403, `${who}: POST provenance`);
  }
  for (const who of ["rita", "admin"]) {
    assert.equal((await api("POST", plPath, {}, who)).status, 400, `${who}: POST provenance → validation`);
  }
  assert.equal((await api("GET", `/api/v1/artifacts/skill/${N}`, undefined, "admin")).data.artifact.status, "active", "the artifact is untouched");
});

test("MATRIX: lists, search, counters, facets, marketplace, board, duplicates and publish responses do not reveal a team artifact", async () => {
  // a candidate team artifact for the board
  assert.equal((await publish("team-cand", "lena", { visibility: "team", owner_team: "alpha" })).status, 201);
  for (const who of OUTSIDERS) {
    const list = await api("GET", "/api/v1/artifacts", undefined, who);
    assert.ok(!names(list).includes("team-skill") && !names(list).includes("team-cand"), `${who}: list`);
    assert.equal(list.data.total, 1, `${who}: total counts only what is visible (org-skill only)`);
    const q = await api("GET", "/api/v1/artifacts?q=team", undefined, who);
    assert.deepEqual(names(q), [], `${who}: search`);
    const st = await api("GET", "/api/v1/artifacts?status=candidate", undefined, who);
    assert.ok(!names(st).includes("team-cand"), `${who}: status filter`);
    const facets = await api("GET", "/api/v1/artifacts/facets", undefined, who);
    assert.equal(facets.status, 200, `${who}: facets ${facets.status}`);
    assert.equal(facets.data.types.find((t) => t.value === "skill").count, 1, `${who}: type facet over what is visible`);
    assert.ok(!facets.data.teams.some((t) => t.value === "alpha"), `${who}: the teams facet does not reveal alpha`);
    const mp = await api("GET", "/marketplace.json", undefined, who);
    assert.equal(mp.status, 200);
    assert.deepEqual(mp.data.plugins.map((p) => p.name), ["org-skill"], `${who}: marketplace`);
    const board = await api("GET", "/api/v1/lifecycle/board", undefined, who);
    if (board.status === 200) {
      const all = [...board.data.review, ...board.data.stale_candidates, ...board.data.aging, ...board.data.zombie, ...board.data.retired_recent].map((a) => a.name);
      assert.ok(!all.includes("team-cand") && !all.includes("team-skill"), `${who}: board`);
      assert.equal(board.data.counts.candidate, 0, `${who}: board counters`);
    }
  }
  for (const who of INSIDERS) {
    const list = await api("GET", "/api/v1/artifacts", undefined, who);
    assert.ok(names(list).includes("team-skill"), `${who}: must see in the list`);
    // carl is a collaborator on team-skill only (not a team member): he must NOT see team-cand
    assert.equal(list.data.total, who === "carl" ? 2 : 3, `${who}: total`);
    if (who === "carl") assert.ok(!names(list).includes("team-cand"), "a collaborator on one artifact does not see the team's other artifacts");
    const mp = await api("GET", "/marketplace.json", undefined, who);
    assert.ok(mp.data.plugins.some((p) => p.name === "team-skill"), `${who}: marketplace`);
  }
  // duplicates: a copy of the team-skill content under another name does not reveal the original to an outsider
  const copyFiles = toB64(rename("team-skill").map((f) => ({ path: f.path.replace("team-skill", "copy-of-team"), content: f.path.endsWith("SKILL.md") ? Buffer.from(f.content.toString("utf8").replace("name: team-skill", "name: copy-of-team")) : f.content })));
  const v = await api("POST", "/api/v1/artifacts/validate", { type: "skill", files: copyFiles }, "oscar");
  assert.equal(v.status, 200, JSON.stringify(v.data));
  assert.ok(!JSON.stringify(v.data).includes("team-skill"), "validate reveals team-skill");
  const pub = await api("POST", "/api/v1/artifacts", { type: "skill", files: copyFiles }, "oscar");
  assert.ok(!JSON.stringify(pub.data).includes("team-skill"), "publish reveals team-skill");
  // name conflict: a stranger does not learn the owner
  const clash = await publish("team-skill", "oscar", {}, "0.9.0");
  assert.equal(clash.status, 403);
  assert.equal(clash.data.error, "not_owner");
  assert.equal(clash.data.owner, undefined, "the owner is hidden");
});

test("MCP: an outsider does not see a team artifact; a permitted user does; registry labels work as mcp_tags", async () => {
  const token = async (who, body) => (await api("POST", "/api/v1/me/tokens", body, who)).data.token;
  const insider = await token("mia", { name: "agent", mcp: true });
  const outsider = await token("oscar", { name: "agent", mcp: true });
  let id = 1;
  const call = async (tok, name, args) => {
    const r = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${tok}` }, body: JSON.stringify({ jsonrpc: "2.0", id: id++, method: "tools/call", params: { name, arguments: args } }) });
    assert.equal(r.status, 200);
    return (await r.json()).result;
  };
  const found = async (tok) => (await call(tok, "search_artifacts", { query: "skill" })).structuredContent.items.map((i) => i.name);
  assert.ok((await found(insider)).includes("team-skill"));
  assert.ok(!(await found(outsider)).includes("team-skill"));
  const get = { type: "skill", name: "team-skill" };
  assert.ok(!(await call(insider, "get_artifact", get)).isError);
  assert.equal((await call(outsider, "get_artifact", get)).isError, true);
  assert.equal((await call(outsider, "read_artifact_file", { ...get, path: "skills/team-skill/SKILL.md" })).isError, true);

  // registry labels as mcp_tags: admin labels org-skill, a token with mcp_tags ["team-a"] finds it by the label
  assert.equal((await api("PUT", "/api/v1/artifacts/skill/org-skill/labels", { labels: ["team-a"] })).status, 200);
  const tagged = await token("oscar", { name: "tagged", mcp: true, mcp_tags: ["team-a"] });
  assert.deepEqual(await found(tagged), ["org-skill"], "a registry label opens the org artifact to a token with mcp_tags");
  // tags narrow, but do not open a team artifact to an outsider
  assert.equal((await api("PUT", "/api/v1/artifacts/skill/team-skill/labels", { labels: ["team-a"] }, "lena")).status, 200);
  assert.ok(!(await found(tagged)).includes("team-skill"), "a label does not open a team artifact to an outsider");
});

test("scope: change by permissions, audit, widening opens, a narrowed artifact is hidden, role checks", async () => {
  const P = "/api/v1/artifacts/skill/org-skill/scope";
  // the owner of org-skill is alice, not a member of alpha → she cannot give the artifact to another team
  assert.equal((await api("PUT", P, { visibility: "team", owner_team: "alpha" }, "alice")).status, 403);
  assert.equal((await api("PUT", P, { visibility: "team", owner_team: "alpha" }, "vera")).status, 403);
  assert.equal((await api("PUT", P, { visibility: "team" }, "admin")).status, 422, "team_required");
  const r = await api("PUT", P, { visibility: "team", owner_team: "alpha", reason: "hide it" }, "admin");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await api("GET", "/api/v1/artifacts/skill/org-skill", undefined, "vera")).status, 404, "became team — an outsider does not see it");
  assert.equal((await api("GET", "/api/v1/artifacts/skill/org-skill", undefined, "alice")).status, 200, "the owner sees it");
  // the lead of the current team can widen it
  assert.equal((await api("PUT", P, { visibility: "org", owner_team: null, reason: "open it" }, "lena")).status, 200);
  assert.equal((await api("GET", "/api/v1/artifacts/skill/org-skill", undefined, "vera")).status, 200);
  const ev = (await api("GET", "/api/v1/artifacts/skill/org-skill/audit")).data.items.filter((e) => e.action === "scope_change");
  assert.equal(ev.length, 2);
  assert.deepEqual([ev[0].meta.from.visibility, ev[0].meta.to.visibility], ["team", "org"], "newest events first");
  // an MCP token does not change the scope
  const t = await api("POST", "/api/v1/me/tokens", { name: "agent", mcp: true }, "admin");
  const m = await rawApi(base, "PUT", P, { visibility: "org", owner_team: null }, { token: t.data.token });
  assert.equal(m.status, 403);
  assert.equal(m.data.error, "mcp_token_forbidden");
});

test("scope: an owner-member who opened an artifact (org) can return it to their team; a non-member cannot", async () => {
  // regression guard: after org, an owner-member used to get 403 and could not close the artifact again
  const P = "/api/v1/artifacts/skill/team-skill/scope";
  assert.equal((await api("GET", "/api/v1/artifacts/skill/team-skill", undefined, "oscar")).status, 404, "initially team");
  assert.equal((await api("PUT", P, { visibility: "org", owner_team: null, reason: "open" }, "lena")).status, 200);
  assert.equal((await api("GET", "/api/v1/artifacts/skill/team-skill", undefined, "oscar")).status, 200, "opened");
  // not a member of the target team — cannot close it into another team
  assert.equal((await api("PUT", P, { visibility: "team", owner_team: "alpha" }, "oscar")).status, 403);
  const back = await api("PUT", P, { visibility: "team", owner_team: "alpha", reason: "close again" }, "lena");
  assert.equal(back.status, 200, `owner-member of alpha: ${JSON.stringify(back.data)}`);
  assert.equal((await api("GET", "/api/v1/artifacts/skill/team-skill", undefined, "oscar")).status, 404, "hidden again");
  assert.equal((await api("GET", "/api/v1/artifacts/skill/team-skill", undefined, "mia")).status, 200, "a member sees it");
});

test("labels: permissions, validation, no new version, filters and facets", async () => {
  const L = "/api/v1/artifacts/skill/org-skill/labels";
  const versions = (await api("GET", "/api/v1/artifacts/skill/org-skill/versions")).data.items.length;
  assert.equal((await api("PUT", L, { labels: ["payments", "team-a"] }, "vera")).status, 403);
  assert.equal((await api("PUT", L, { labels: ["payments", "team-a"] }, "rita")).status, 200, "reviewer+");
  for (const bad of [["Bad Label"], ["a".repeat(33)], Array.from({ length: 21 }, (_, i) => `l${i}`), ["dup", "dup"], "x"]) {
    const r = await api("PUT", L, { labels: bad }, "alice");
    assert.equal(r.status, 400, JSON.stringify(bad).slice(0, 40));
    assert.equal(r.data.error, "labels_invalid");
  }
  assert.equal((await api("GET", "/api/v1/artifacts/skill/org-skill/versions")).data.items.length, versions, "no versions were added");
  assert.ok((await api("GET", "/api/v1/artifacts/skill/org-skill/audit")).data.items.some((e) => e.action === "labels_change"));
  assert.deepEqual(names(await api("GET", "/api/v1/artifacts?label=payments", undefined, "oscar")), ["org-skill"]);
  assert.deepEqual(names(await api("GET", "/api/v1/artifacts?owner=alice", undefined, "oscar")), ["org-skill"]);
  assert.deepEqual(names(await api("GET", "/api/v1/artifacts?team=alpha", undefined, "oscar")), [], "an outsider does not see the team filter");
  assert.deepEqual(names(await api("GET", "/api/v1/artifacts?team=alpha", undefined, "mia")).sort(), ["team-cand", "team-skill"]);
  assert.deepEqual(names(await api("GET", "/api/v1/artifacts?visibility=team", undefined, "mia")).sort(), ["team-cand", "team-skill"]);
  const f = await api("GET", "/api/v1/artifacts/facets", undefined, "mia");
  assert.equal(f.data.teams.find((t) => t.value === "alpha").count, 2);
  assert.equal(f.data.owners.find((o) => o.value === "lena").count, 2);
  assert.equal(f.data.labels.find((l) => l.value === "payments").count, 1);
});

test("membership: removal from a team revokes access immediately; deleting a team that is in use is forbidden", async () => {
  assert.equal((await api("GET", "/api/v1/artifacts/skill/team-skill", undefined, "mia")).status, 200);
  assert.equal((await api("DELETE", "/api/v1/teams/alpha/members/mia", undefined, "lena")).status, 200);
  assert.equal((await api("GET", "/api/v1/artifacts/skill/team-skill", undefined, "mia")).status, 404, "access revoked");
  const del = await api("DELETE", "/api/v1/teams/alpha");
  assert.equal(del.status, 409);
  assert.equal(del.data.error, "team_in_use");
  assert.equal((await api("DELETE", "/api/v1/teams/beta")).status, 200, "an empty team is deleted");
});

test("route inventory: every path with /:type/:name is known to the test (a new route requires a deliberate entry)", async () => {
  const known = new Set([
    "/api/v1/artifacts/:type/:name",
    "/api/v1/artifacts/:type/:name/audit",
    "/api/v1/artifacts/:type/:name/duplicates",
    // version-diff: covered by the visibility gate; tests/version-diff.test.mjs checks a team artifact.
    "/api/v1/artifacts/:type/:name/diff",
    // team-availability: covered by the visibility gate.
    "/api/v1/artifacts/:type/:name/availability",
    // artifact-replacement: covered by the visibility gate.
    "/api/v1/artifacts/:type/:name/replacement",
    "/api/v1/artifacts/:type/:name/maintainers",
    "/api/v1/artifacts/:type/:name/maintainers/:username",
    "/api/v1/artifacts/:type/:name/owner",
    "/api/v1/artifacts/:type/:name/resolve",
    "/api/v1/artifacts/:type/:name/scope",
    "/api/v1/artifacts/:type/:name/labels",
    "/api/v1/artifacts/:type/:name/usage",
    "/api/v1/artifacts/:type/:name/metrics",
    // mcp-server-card: covered by the visibility gate; tests/mcp-server-card.test.mjs checks a team artifact.
    "/api/v1/artifacts/:type/:name/mcp",
    "/api/v1/artifacts/:type/:name/comments",
    "/api/v1/artifacts/:type/:name/watch",
    "/api/v1/artifacts/:type/:name/metadata",
    "/api/v1/artifacts/:type/:name/purge",
    "/api/v1/artifacts/:type/:name/versions/:version/purge",
    "/api/v1/artifacts/:type/:name/lifecycle",
    "/api/v1/artifacts/:type/:name/lifecycle-hold",
    "/api/v1/artifacts/:type/:name/run-outputs",
    "/api/v1/artifacts/:type/:name/run-outputs/:id",
    "/api/v1/artifacts/:type/:name/run-outputs/:id/content",
    "/api/v1/artifacts/:type/:name/workflows",
    "/api/v1/artifacts/:type/:name/workflows/:wf",
    "/api/v1/artifacts/:type/:name/workflows/:wf/runs",
    "/api/v1/artifacts/:type/:name/workflows/runs",
    "/api/v1/artifacts/:type/:name/workflows/runs/:id",
    "/api/v1/artifacts/:type/:name/workflows/runs/:id/cancel",
    "/api/v1/artifacts/:type/:name/workflows/runs/:id/replay",
    "/api/v1/artifacts/:type/:name/routines",
    "/api/v1/artifacts/:type/:name/routines/:rt",
    "/api/v1/artifacts/:type/:name/routines/:rt/run",
    "/api/v1/artifacts/:type/:name/routines/:rt/disable",
    "/api/v1/artifacts/:type/:name/routines/:rt/enable",
    "/api/v1/artifacts/:type/:name/routines/runs",
    "/api/v1/artifacts/:type/:name/routines/runs/:id",
    "/api/v1/artifacts/:type/:name/evals",
    "/api/v1/artifacts/:type/:name/evals/runs",
    "/api/v1/artifacts/:type/:name/evals/runs/:id",
    "/api/v1/artifacts/:type/:name/evals/journal",
    "/api/v1/artifacts/:type/:name/evals/cost",
    "/api/v1/artifacts/:type/:name/overlays",
    "/api/v1/artifacts/:type/:name/overlays/company",
    "/api/v1/artifacts/:type/:name/overlays/team/:team",
    "/api/v1/artifacts/:type/:name/overlays/me",
    "/api/v1/artifacts/:type/:name/workflows/:wf/from-template",
    "/api/v1/artifacts/:type/:name/workflows/runs/:id/gates/:step",
    "/api/v1/artifacts/:type/:name/workflows/runs/:id/resume",
    "/api/v1/artifacts/:type/:name/evals/batches",
    "/api/v1/artifacts/:type/:name/evals/batches/:id",
    "/api/v1/artifacts/:type/:name/overhang",
    "/api/v1/artifacts/:type/:name/provenance",
    "/api/v1/artifacts/:type/:name/transitions",
    "/api/v1/artifacts/:type/:name/versions",
    "/api/v1/artifacts/:type/:name/versions/:version",
    "/api/v1/artifacts/:type/:name/versions/:version/bundle.zip",
    "/api/v1/artifacts/:type/:name/versions/:version/channel",
    "/api/v1/artifacts/:type/:name/versions/:version/evidence",
    "/api/v1/artifacts/:type/:name/versions/:version/evidence/documents/:sha256",
    "/api/v1/artifacts/:type/:name/versions/:version/files/*",
    "/api/v1/artifacts/:type/:name/versions/:version/validate",
    "/api/v1/plugins/:type/:name/:tarball",
    "/api/v1/plugins/ui/tabs/:plugin/:tab/:type/:name",
  ]);
  const found = new Set();
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts") || p.endsWith(".js")) {
        for (const m of readFileSync(p, "utf8").matchAll(/["'`](\/api\/v1\/[^"'`\s]*\/:type\/:name[^"'`\s]*)["'`]/g)) found.add(m[1]);
      }
    }
  };
  walk(join(ROOT, "packages", "server", "src"));
  walk(join(ROOT, "plugins"));
  const unknown = [...found].filter((p) => !known.has(p.replace(/\/api\/v1\/ext\/[^/]+/, "")));
  assert.deepEqual(unknown, [], `routes with /:type/:name without an entry in the test — add a visibility check and an entry in known: ${unknown.join(", ")}`);
  assert.ok(found.size >= 12, `the inventory is empty or broken: ${found.size}`);
});
