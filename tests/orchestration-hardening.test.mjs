// When orchestration is enabled, only an admin sets
// the team's definitions. Workflow and routine definitions (PUT, DELETE, enable) are admin-only; owner/collaborator/reviewer+
// still read, run, cancel and disable definitions approved by an admin.
// Independent oracle: a contributor-owner saved and ran a workflow
// with an arbitrary argv (`run done`). Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { startServer, api, login, createUser, toB64, ADMIN_PASSWORD } from "./lib/client.mjs";

let srv;
const U = {};
const NODE = process.execPath;
const as = (who) => (who === "anon" ? {} : { cookie: U[who].cookie });
const call = (method, path, body, who) => api(srv.base, method, path, body, as(who));
const A = (n) => `/api/v1/artifacts/skill/${n}`;

before(async () => {
  srv = await startServer({ SKILLFORGE_ORCHESTRATION_ENABLED: "true" }, { prefix: "skillforge-orch-hard-" });
  assert.ok(srv.up, srv.stderr);
  U.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [["alice", "contributor"], ["rita", "reviewer"]]) {
    await createUser(srv.base, U.admin.cookie, { username: u, password: `${u}-pw-123`, role });
    U[u] = await login(srv.base, u, `${u}-pw-123`);
  }
  for (const name of ["oh-wf", "oh-rt"]) {
    const md = `---\nname: ${name}\ndescription: Orchestration hardening probe\n---\n\n# ${name}\n`;
    const r = await call("POST", "/api/v1/artifacts", { type: "skill", version: "0.1.0", files: toB64([{ path: `${name}/SKILL.md`, content: md }]) }, "alice");
    assert.equal(r.status, 201, JSON.stringify(r.data));
  }
});

after(async () => {
  try {
    await srv?.stop?.();
  } catch {
    try {
      rmSync(srv.dataDir, { recursive: true, force: true });
    } catch {
      /* Windows EPERM — the OS will sweep the temp directory */
    }
  }
});

const until = async (fn, timeout = 30_000) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > deadline) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
};

const WF = { version: 1, name: "pipe", steps: [{ id: "one", kind: "command", argv: [NODE, "-e", "console.log('approved step')"] }] };
const RT = { version: 1, enabled: false, schedule: { kind: "every", seconds: 3600 }, command: { argv: [NODE, "-e", "process.exit(0)"] } };

test("workflow: only an admin sets the definition; a contributor-owner runs the approved one", { timeout: 90_000 }, async () => {
  const wf = `${A("oh-wf")}/workflows/pipe`;
  for (const who of ["alice", "rita"]) {
    const put = await call("PUT", wf, { definition: WF }, who);
    assert.equal(put.status, 403, `${who} saved a workflow: ${put.status} ${JSON.stringify(put.data)}`);
  }
  const before = await call("GET", `${A("oh-wf")}/workflows`, undefined, "alice");
  assert.equal(before.status, 200);
  assert.equal(before.data.items.length, 0, "a refused PUT must not create a definition");

  const put = await call("PUT", wf, { definition: WF }, "admin");
  assert.equal(put.status, 200, JSON.stringify(put.data));

  const run = await call("POST", `${wf}/runs`, {}, "alice");
  assert.equal(run.status, 202, `the owner did not run the approved workflow: ${JSON.stringify(run.data)}`);
  const done = await until(async () => {
    const g = await call("GET", `${A("oh-wf")}/workflows/runs/${run.data.run.id}`, undefined, "alice");
    return ["done", "failed", "cancelled"].includes(g.data?.run?.status) ? g.data.run : null;
  });
  assert.equal(done?.status, "done", JSON.stringify(done));

  const del = await call("DELETE", wf, undefined, "alice");
  assert.equal(del.status, 403, "contributor deleted the definition");
  const delAdmin = await call("DELETE", wf, undefined, "admin");
  assert.equal(delAdmin.status, 204);
});

test("routine: PUT, enable and DELETE — admin only; disable and manual run — the owner", { timeout: 90_000 }, async () => {
  const rt = `${A("oh-rt")}/routines/tick`;
  const put = await call("PUT", rt, { definition: RT }, "alice");
  assert.equal(put.status, 403, `contributor saved a routine: ${JSON.stringify(put.data)}`);
  const putAdmin = await call("PUT", rt, { definition: RT }, "admin");
  assert.equal(putAdmin.status, 200, JSON.stringify(putAdmin.data));

  const en = await call("POST", `${rt}/enable`, {}, "alice");
  assert.equal(en.status, 403, "contributor enabled a routine");
  const enRev = await call("POST", `${rt}/enable`, {}, "rita");
  assert.equal(enRev.status, 403, "reviewer enabled a routine");
  const enAdmin = await call("POST", `${rt}/enable`, {}, "admin");
  assert.equal(enAdmin.status, 200, JSON.stringify(enAdmin.data));

  const dis = await call("POST", `${rt}/disable`, {}, "alice");
  assert.equal(dis.status, 200, "the owner must be able to disable (kill switch)");
  const runNow = await call("POST", `${rt}/run`, {}, "alice");
  assert.equal(runNow.status, 202, `the owner did not run the approved routine: ${JSON.stringify(runNow.data)}`);

  const del = await call("DELETE", rt, undefined, "alice");
  assert.equal(del.status, 403, "contributor deleted a routine");
  const delAdmin = await call("DELETE", rt, undefined, "admin");
  assert.equal(delAdmin.status, 204);
});
