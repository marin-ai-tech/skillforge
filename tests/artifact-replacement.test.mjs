// Acceptance tests for "replaced by": it is set by the owner, a collaborator or a reviewer; the target must be of the same type, with no cycles; the card and the catalog show the successor; sync installs
// the successor and removes the replaced artifact, installing the replaced artifact warns.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, toB64, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
let srv;
let work;
const auth = {};
const call = (method, path, body, who = auth.alice) => api(srv.base, method, path, body, who ? { cookie: who.cookie } : {});
const R = (name, type = "skill") => `/api/v1/artifacts/${type}/${name}/replacement`;
const md = (name) => `---\nname: ${name}\ndescription: A replacement test skill. Use when testing successors.\n---\n\n# ${name}\n\nSteps.\n`;
async function publish(name, who = auth.alice) {
  const p = await call("POST", "/api/v1/artifacts", { type: "skill", files: toB64([{ path: `${name}/SKILL.md`, content: md(name) }]) }, who);
  assert.equal(p.status, 201, JSON.stringify(p.data));
}

before(async () => {
  work = mkdtempSync(join(tmpdir(), "skillforge-repl-"));
  srv = await startServer({}, { prefix: "skillforge-repl-srv-" });
  assert.ok(srv.up, srv.stderr);
  auth.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [["alice", "contributor"], ["bob", "contributor"], ["rita", "reviewer"]]) {
    await createUser(srv.base, auth.admin.cookie, { username: u, password: `${u}-pw-123456`, role });
    auth[u] = await login(srv.base, u, `${u}-pw-123456`);
  }
  for (const n of ["old-notes", "new-notes", "third-notes"]) await publish(n);
  const cmd = await call("POST", "/api/v1/artifacts", { type: "command", files: toB64([{ path: "notes-cmd.md", content: "---\nname: notes-cmd\ndescription: A command. Use when asked.\n---\n\nDo it.\n" }]) });
  assert.equal(cmd.status, 201, JSON.stringify(cmd.data));
});

after(async () => {
  await srv?.stop();
  rmSync(work, { recursive: true, force: true });
});

test("who can set it and what is accepted", async () => {
  assert.equal((await call("PUT", R("old-notes"), { replaced_by: "skill/new-notes" }, auth.bob)).status, 403, "not the owner");
  assert.equal((await call("PUT", R("old-notes"), { replaced_by: "skill/nope" })).status, 422);
  assert.equal((await call("PUT", R("old-notes"), { replaced_by: "command/notes-cmd" })).status, 422, "different type");
  assert.equal((await call("PUT", R("old-notes"), { replaced_by: "skill/old-notes" })).status, 422, "itself");
  assert.equal((await call("PUT", R("old-notes"), { replaced_by: "bad" })).status, 400);

  const ok = await call("PUT", R("old-notes"), { replaced_by: "skill/new-notes" });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.replaced_by, "skill/new-notes");

  // A cycle through a chain is forbidden.
  assert.equal((await call("PUT", R("new-notes"), { replaced_by: "skill/third-notes" }, auth.rita)).status, 200, "reviewer can");
  assert.equal((await call("PUT", R("third-notes"), { replaced_by: "skill/old-notes" })).status, 422, "cycle");
  assert.equal((await call("PUT", R("new-notes"), { replaced_by: null }, auth.rita)).status, 200);

  const audit = await call("GET", "/api/v1/artifacts/skill/old-notes/audit");
  assert.ok(audit.data.items.some((e) => e.action === "replacement_set"));
});

test("the card and the catalog show the successor", async () => {
  const card = await call("GET", "/api/v1/artifacts/skill/old-notes");
  assert.equal(card.data.artifact.replaced_by, "skill/new-notes");
  const list = await call("GET", "/api/v1/artifacts?type=skill&limit=50");
  assert.equal(list.data.items.find((a) => a.name === "old-notes").replaced_by, "skill/new-notes");
  assert.equal(list.data.items.find((a) => a.name === "new-notes").replaced_by, null);
});

test("CLI: installing the replaced artifact warns; sync installs the successor and removes the replaced one", async () => {
  const tok = (await call("POST", "/api/v1/me/tokens", { name: "repl" })).data.token;
  const env = { ...process.env, SKILLFORGE_URL: srv.base, SKILLFORGE_TOKEN: tok, SKILLFORGE_CONFIG: join(work, "cli.json"), NO_COLOR: "1" };
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { env, encoding: "utf8", timeout: 60_000 });
  const into = join(work, "agent");
  const has = (n) => existsSync(join(into, "skills", n, "SKILL.md"));

  const i = cli("install", "skill/old-notes", "--into", into);
  assert.equal(i.status, 0, i.stderr);
  assert.match(i.stderr, /replaced by skill\/new-notes/);
  assert.ok(has("old-notes"));

  const s = cli("sync", "--into", into, "--tag", "no-such-tag");
  assert.equal(s.status, 0, s.stderr);
  assert.ok(has("new-notes"), "successor not installed");
  assert.ok(!has("old-notes"), "replaced artifact not removed");
  assert.match(s.stdout + s.stderr, /old-notes.*new-notes/);
});
