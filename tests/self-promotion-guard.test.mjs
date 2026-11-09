// The author of the latest version cannot move it to active; an admin can only
// with a reason and an audit mark. Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, api, login, createUser, ADMIN_PASSWORD } from "./lib/client.mjs";

let srv;
let base;
let admin;
let rita;
let rob;
let alice;

const skill = (name) => [
  {
    path: "SKILL.md",
    content_base64: Buffer.from(
      `---\nname: ${name}\ndescription: Skill ${name} for self-promotion checks. Use when the user asks for ${name}.\n---\n\n# ${name}\n\nBody.\n`,
    ).toString("base64"),
  },
];

async function publish(who, name) {
  const r = await api(base, "POST", "/api/v1/artifacts", { type: "skill", files: skill(name) }, { cookie: who.cookie });
  assert.equal(r.status, 201, `${name}: ${JSON.stringify(r.data)}`);
}
const status = async (name) => (await api(base, "GET", `/api/v1/artifacts/skill/${name}`, undefined, { cookie: admin.cookie })).data.artifact.status;
const transitions = async (name) =>
  (await api(base, "GET", `/api/v1/artifacts/skill/${name}/audit`, undefined, { cookie: admin.cookie })).data.items.filter((e) => e.action === "transition");

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-selfpromo-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  await createUser(base, admin.cookie, { username: "rita", password: "rita-pw-12", role: "reviewer" });
  await createUser(base, admin.cookie, { username: "rob", password: "rob-pw-123", role: "reviewer" });
  await createUser(base, admin.cookie, { username: "alice", password: "alice-pw-1", role: "contributor" });
  rita = await login(base, "rita", "rita-pw-12");
  rob = await login(base, "rob", "rob-pw-123");
  alice = await login(base, "alice", "alice-pw-1");
  await publish(rita, "own");
  await publish(admin, "admin-own");
  await publish(rita, "r1");
  await publish(alice, "a1");
});

after(async () => {
  if (srv?.up) await srv.stop();
});

test("reviewer-author: 403 self_promotion_forbidden, status and audit unchanged", async () => {
  const r = await api(base, "POST", "/api/v1/artifacts/skill/own/transitions", { to: "active", reason: "ok" }, { cookie: rita.cookie });
  assert.equal(r.status, 403, JSON.stringify(r.data));
  assert.equal(r.data.error, "self_promotion_forbidden");
  assert.equal(await status("own"), "candidate");
  assert.equal((await transitions("own")).length, 0);
});

test("another reviewer promotes without a mark; the author can move their own to retired", async () => {
  const r = await api(base, "POST", "/api/v1/artifacts/skill/own/transitions", { to: "active" }, { cookie: rob.cookie });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.notEqual(r.data.event.meta?.self_promotion, true);
  const retire = await api(base, "POST", "/api/v1/artifacts/skill/own/transitions", { to: "retired", reason: "superseded by v2" }, { cookie: rita.cookie });
  assert.equal(retire.status, 200, JSON.stringify(retire.data));
});

test("admin-author: 400 without a reason, 200 with a reason and meta.self_promotion", async () => {
  const noReason = await api(base, "POST", "/api/v1/artifacts/skill/admin-own/transitions", { to: "active" }, { cookie: admin.cookie });
  assert.equal(noReason.status, 400, JSON.stringify(noReason.data));
  assert.equal(noReason.data.error, "reason_required");
  assert.equal(await status("admin-own"), "candidate");
  const ok = await api(base, "POST", "/api/v1/artifacts/skill/admin-own/transitions", { to: "active", reason: "single maintainer" }, { cookie: admin.cookie });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const [event] = await transitions("admin-own");
  assert.equal(event.meta?.self_promotion, true);
  assert.equal(event.reason, "single maintainer");
});

test("bundle: someone else's item passes, own item — self_promotion_forbidden", async () => {
  const r = await api(
    base,
    "POST",
    "/api/v1/lifecycle/batch-transitions",
    { items: [{ type: "skill", name: "r1", to: "active" }, { type: "skill", name: "a1", to: "active" }], reason: "batch review" },
    { cookie: rita.cookie },
  );
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const by = Object.fromEntries(r.data.results.map((x) => [x.name, x]));
  assert.equal(by.a1.ok, true, JSON.stringify(by.a1));
  assert.equal(by.r1.ok, false);
  assert.equal(by.r1.error, "self_promotion_forbidden");
  assert.equal(await status("r1"), "candidate");
  assert.equal(await status("a1"), "active");
});
