// GET /api/v1/me/agents with 50 agents x 200 items took ~807 ms to respond; the registry comparison summary must
// be cached, and the cache must be invalidated on any change that alters the result: publication, visibility (team
// membership), a new agent snapshot, a different user. The main oracle is correctness after changes; speed is secondary.
// Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { startServer, api, login, createUser, toB64, ADMIN_PASSWORD } from "./lib/client.mjs";

const N_SKILLS = 200;
const N_AGENTS = 50;
const WARM_MAX_MS = 300;

let srv;
const U = {};
const call = (who, method, path, body) => api(srv.base, method, path, body, { cookie: U[who].cookie });
const skillMd = (name, rev = "") => `---\nname: ${name}\ndescription: Agents cache probe ${name}\n---\n\n# ${name}\n${rev}\n`;
const skillName = (i) => `ac-${String(i).padStart(3, "0")}`;
const agentFiles = (extra = []) =>
  toB64([...Array.from({ length: N_SKILLS }, (_, i) => ({ path: `skills/${skillName(i)}/SKILL.md`, content: skillMd(skillName(i)) })), ...extra]);

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-agents-cache-" });
  assert.ok(srv.up, srv.stderr);
  U.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [["alice", "contributor"], ["bob", "contributor"], ["lena", "contributor"]]) {
    await createUser(srv.base, U.admin.cookie, { username: u, password: `${u}-pw-123`, role });
    U[u] = await login(srv.base, u, `${u}-pw-123`);
  }
  for (let i = 0; i < N_SKILLS; i++) {
    const r = await call("admin", "POST", "/api/v1/artifacts", { type: "skill", version: "0.1.0", files: toB64([{ path: `${skillName(i)}/SKILL.md`, content: skillMd(skillName(i)) }]) });
    assert.equal(r.status, 201, JSON.stringify(r.data));
  }
  assert.equal((await call("admin", "POST", "/api/v1/teams", { name: "cachet", lead: "lena" })).status, 201);
  assert.equal((await call("lena", "POST", "/api/v1/teams/cachet/members", { username: "alice" })).status, 201);
  const team = await call("lena", "POST", "/api/v1/artifacts", {
    type: "skill", version: "0.1.0", visibility: "team", owner_team: "cachet",
    files: toB64([{ path: "ac-team/SKILL.md", content: skillMd("ac-team") }]),
  });
  assert.equal(team.status, 201, JSON.stringify(team.data));
  const teamFile = [{ path: "skills/ac-team/SKILL.md", content: skillMd("ac-team") }];
  for (let a = 0; a < N_AGENTS; a++) {
    const r = await call("alice", "PUT", `/api/v1/me/agents/ac-agent-${a}`, { runtime: "claude-code", files: agentFiles(a === 0 ? teamFile : []) });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  const b = await call("bob", "PUT", "/api/v1/me/agents/bob-agent", { runtime: "claude-code", files: toB64(teamFile) });
  assert.equal(b.status, 200, JSON.stringify(b.data));
});

after(async () => {
  try {
    await srv?.stop?.();
  } catch {
    try {
      rmSync(srv.dataDir, { recursive: true, force: true });
    } catch {
      /* Windows EPERM */
    }
  }
});

const list = async (who) => {
  const r = await call(who, "GET", "/api/v1/me/agents");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return Object.fromEntries(r.data.items.map((a) => [a.name, a.summary]));
};

test("warm agents list is fast and the result matches the cold one", { timeout: 600_000 }, async () => {
  const t0 = Date.now();
  const cold = await list("alice");
  const coldMs = Date.now() - t0;
  assert.equal(Object.keys(cold).length, N_AGENTS);
  assert.equal(cold["ac-agent-0"].in_sync, N_SKILLS + 1, JSON.stringify(cold["ac-agent-0"]));
  const warm = [];
  for (let k = 0; k < 5; k++) {
    const t = Date.now();
    const again = await list("alice");
    warm.push(Date.now() - t);
    assert.deepEqual(again, cold, "warm response differs from the cold one");
  }
  warm.sort((a, b) => a - b);
  const median = warm[2];
  console.log(`agents list: cold ${coldMs} ms, warm median ${median} ms (${warm.join(", ")})`);
  assert.ok(median < WARM_MAX_MS, `warm request median ${median} ms >= ${WARM_MAX_MS} ms (cold ${coldMs} ms)`);
});

test("cache is invalidated: new registry version, leaving a team, new snapshot; each user gets their own result", { timeout: 600_000 }, async () => {
  const before0 = await list("alice"); // warm-up
  assert.equal(before0["ac-agent-0"].in_sync, N_SKILLS + 1);

  // 1. New skill version in the registry: the local copy becomes outdated in all agents.
  const pub = await call("admin", "POST", "/api/v1/artifacts", { type: "skill", version: "0.2.0", files: toB64([{ path: `${skillName(0)}/SKILL.md`, content: skillMd(skillName(0), "v2") }]) });
  assert.equal(pub.status, 201, JSON.stringify(pub.data));
  const afterPub = await list("alice");
  assert.equal(afterPub["ac-agent-5"].outdated, 1, `after publishing 0.2.0: ${JSON.stringify(afterPub["ac-agent-5"])}`);
  assert.equal(afterPub["ac-agent-5"].in_sync, N_SKILLS - 1);

  // 2. Leaving the team: the team skill stops being visible — local_only.
  assert.equal(afterPub["ac-agent-0"].local_only, 0);
  const del = await call("lena", "DELETE", "/api/v1/teams/cachet/members/alice");
  assert.equal(del.status, 200, JSON.stringify(del.data));
  const afterTeam = await list("alice");
  assert.equal(afterTeam["ac-agent-0"].local_only, 1, `after leaving the team: ${JSON.stringify(afterTeam["ac-agent-0"])}`);

  // 3. New agent snapshot with a modified file: modified.
  const changed = toB64(Array.from({ length: N_SKILLS }, (_, i) => ({
    path: `skills/${skillName(i)}/SKILL.md`,
    content: i === 7 ? skillMd(skillName(i), "local edit") : skillMd(skillName(i)),
  })));
  assert.equal((await call("alice", "PUT", "/api/v1/me/agents/ac-agent-1", { runtime: "claude-code", files: changed })).status, 200);
  const afterScan = await list("alice");
  assert.equal(afterScan["ac-agent-1"].modified, 1, `after the new snapshot: ${JSON.stringify(afterScan["ac-agent-1"])}`);

  // 4. Another user: bob is not in the team — his team item is local_only, alice's cache is not served to him.
  const bob = await list("bob");
  assert.equal(bob["bob-agent"].local_only, 1, JSON.stringify(bob["bob-agent"]));
  assert.equal(Object.keys(bob).length, 1, "bob sees only his own agents");
});
