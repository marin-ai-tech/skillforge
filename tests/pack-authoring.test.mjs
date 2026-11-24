// pack-authoring: a method pack is checked before publishing — every problem at once, by role and item, without
// writing anything — and published or shown from the CLI. An item the author cannot see is reported as unknown, so the
// check does not reveal team artifacts. Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, toB64, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
let srv;
let work;
let lenaToken;
const auth = {};
const call = (method, path, body, who = "lena") => api(srv.base, method, path, body, auth[who] ? { cookie: auth[who].cookie } : {});

async function skill(name, { version = "0.1.0", activate = true, by = "lena", extra = {} } = {}) {
  const md = `---\nname: ${name}\ndescription: Pack probe ${name}. Use when testing packs.\n---\n\n# ${name}\n\nSteps ${version}.\n`;
  const r = await call("POST", "/api/v1/artifacts", { type: "skill", version, files: toB64([{ path: `${name}/SKILL.md`, content: md }]), ...extra }, by);
  assert.equal(r.status, 201, `${name}: ${JSON.stringify(r.data)}`);
  if (activate) assert.equal((await call("POST", `/api/v1/artifacts/skill/${name}/transitions`, { to: "active", reason: "pack test" }, "admin")).status, 200);
}

const item = (name, version = "0.1.0") => ({ type: "skill", name, version });
const pack = (version, roles) => ({ name: "team-method", version, title: "Team method", description: "How we work.", roles });
const GOOD = (version) =>
  pack(version, [
    { name: "developer", description: "Builds", items: [item("plan-it"), item("build-it")] },
    { name: "reviewer", description: "Reviews", items: [item("review-it")] },
  ]);
const latest = async () => (await call("GET", "/api/v1/packs/team-method")).data.pack;

function cli(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: work,
    env: { ...process.env, SKILLFORGE_URL: srv.base, SKILLFORGE_TOKEN: lenaToken, SKILLFORGE_CONFIG: join(work, "cli.json"), NO_COLOR: "1" },
    encoding: "utf8",
    timeout: 30_000,
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, stdout: r.stdout };
}

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-pack-authoring-" });
  assert.ok(srv.up, srv.stderr);
  auth.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [["rita", "reviewer"], ["lena", "contributor"], ["oscar", "contributor"], ["vera", "viewer"]]) {
    await createUser(srv.base, auth.admin.cookie, { username: u, password: `${u}-pw-123456`, role });
    auth[u] = await login(srv.base, u, `${u}-pw-123456`);
  }
  for (const n of ["plan-it", "build-it", "review-it"]) await skill(n);
  await skill("draft-it", { activate: false });
  assert.equal((await call("POST", "/api/v1/teams", { name: "alpha", lead: "rita" }, "admin")).status, 201);
  await skill("team-only", { by: "rita", extra: { visibility: "team", owner_team: "alpha" } });
  const first = await call("POST", "/api/v1/packs", GOOD("1.0.0"));
  assert.equal(first.status, 201, JSON.stringify(first.data));
  lenaToken = (await call("POST", "/api/v1/me/tokens", { name: "pack-cli" })).data.token;
  work = mkdtempSync(join(tmpdir(), "skillforge-pack-authoring-"));
});

after(async () => {
  await srv?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("check: every problem at once — items by role and the pack itself — and nothing is written", async () => {
  const draft = pack("1.0.0", [
    { name: "developer", description: "Builds", items: [item("plan-it"), item("draft-it")] },
    { name: "reviewer", description: "Reviews", items: [item("ghost"), item("team-only")] },
  ]);
  const r = await call("POST", "/api/v1/packs/check", draft, "oscar");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ok, false);
  const got = r.data.problems.map((p) => `${p.role ?? "-"}:${p.name ?? "-"}:${p.code}`).sort();
  assert.deepEqual(got, [
    "-:-:not_owner",
    "-:-:version_not_newer",
    "developer:draft-it:item_not_active",
    "reviewer:ghost:unknown_item",
    "reviewer:team-only:unknown_item",
  ]);
  assert.equal(r.data.problems.find((p) => p.code === "version_not_newer").latest, "1.0.0");
  assert.ok(r.data.problems.every((p) => typeof p.message === "string" && p.message.length > 0));
  assert.ok(!JSON.stringify(r.data).includes("item_not_org"), "the check revealed a team artifact");
  const p = await latest();
  assert.equal(p.latest_version, "1.0.0");
  assert.equal(p.versions.length, 1);
});

test("check: a clean draft is ready and still not published", async () => {
  const r = await call("POST", "/api/v1/packs/check", GOOD("1.1.0"));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data, { ok: true, problems: [] });
  assert.equal((await latest()).latest_version, "1.0.0");
});

test("check: a viewer and an anonymous caller are refused; a broken body is 400", async () => {
  assert.equal((await call("POST", "/api/v1/packs/check", GOOD("1.1.0"), "vera")).status, 403);
  assert.equal((await call("POST", "/api/v1/packs/check", GOOD("1.1.0"), "nobody")).status, 401);
  assert.equal((await call("POST", "/api/v1/packs/check", { ...GOOD("1.1.0"), roles: [] })).status, 400);
});

test("publish refusal: the first problem's code plus every problem; an item the author cannot see is unknown", async () => {
  const r = await call("POST", "/api/v1/packs", pack("1.1.0", [
    { name: "developer", description: "Builds", items: [item("draft-it")] },
    { name: "reviewer", description: "Reviews", items: [item("ghost")] },
  ]));
  assert.equal(r.status, 422, JSON.stringify(r.data));
  assert.equal(r.data.error, "item_not_active");
  assert.deepEqual(r.data.problems.map((p) => `${p.role}:${p.name}:${p.code}`), ["developer:draft-it:item_not_active", "reviewer:ghost:unknown_item"]);
  const hidden = await call("POST", "/api/v1/packs", pack("1.1.0", [{ name: "developer", description: "x", items: [item("team-only")] }]));
  assert.equal(hidden.status, 422);
  assert.equal(hidden.data.error, "unknown_item", "a team artifact the author cannot see must look unknown");
  assert.equal((await latest()).latest_version, "1.0.0");
});

test("a version view names who published it and when", async () => {
  const v = await call("GET", "/api/v1/packs/team-method/versions/1.0.0", undefined, "vera");
  assert.equal(v.status, 200, JSON.stringify(v.data));
  assert.equal(v.data.version.published_by, "lena");
  assert.ok(Date.parse(v.data.version.published_at));
});

test("CLI: publish --dry-run lists problems and writes nothing; publish and show; bad files never reach the server", async () => {
  const bad = join(work, "bad.json");
  writeFileSync(bad, JSON.stringify(pack("1.2.0", [{ name: "developer", description: "x", items: [item("plan-it"), item("draft-it")] }])));
  const dry = cli(["pack", "publish", bad, "--dry-run"]);
  assert.equal(dry.status, 1, dry.out);
  assert.match(dry.out, /draft-it/);
  assert.match(dry.out, /item_not_active/);
  assert.equal((await latest()).latest_version, "1.0.0");

  const good = join(work, "good.json");
  writeFileSync(good, JSON.stringify(GOOD("1.2.0")));
  const okDry = cli(["pack", "publish", good, "--dry-run"]);
  assert.equal(okDry.status, 0, okDry.out);
  assert.equal((await latest()).latest_version, "1.0.0", "--dry-run published");
  const pub = cli(["pack", "publish", good]);
  assert.equal(pub.status, 0, pub.out);
  assert.match(pub.out, /Published pack team-method@1\.2\.0/);

  const show = cli(["pack", "show", "team-method", "--json"]);
  assert.equal(show.status, 0, show.out);
  const shown = JSON.parse(show.stdout);
  assert.equal(shown.version ?? shown.latest?.version, "1.2.0", show.stdout);
  assert.match(show.stdout, /"published_by":\s*"lena"/);
  assert.match(show.stdout, /review-it/);
  const human = cli(["pack", "show", "team-method@1.0.0"]);
  assert.equal(human.status, 0, human.out);
  assert.match(human.out, /1\.0\.0/);
  assert.match(human.out, /lena/);
  assert.match(human.out, /developer/);
  assert.equal(cli(["pack", "show", "no-such-pack"]).status, 6);

  const huge = join(work, "huge.json");
  writeFileSync(huge, JSON.stringify({ ...GOOD("1.3.0"), description: "x".repeat(300 * 1024) }));
  const big = cli(["pack", "publish", huge]);
  assert.equal(big.status, 1, big.out);
  const broken = join(work, "broken.json");
  writeFileSync(broken, "{ not json");
  assert.equal(cli(["pack", "publish", broken]).status, 1);
  assert.equal((await latest()).latest_version, "1.2.0", "a bad file reached the server");
});
