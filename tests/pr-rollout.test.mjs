// Rollout via
// pull request: an administrator picks repositories and artifacts, the registry creates a branch, puts the artifact files and the CLI lock file there
// (like `skillforge install --into .claude`: version paths already start with skills/, commands/ or agents/) and opens a PR. GitHub here is a local API imitation; the token comes only from the environment.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { startServer, api, login, createUser, toB64, ADMIN_PASSWORD } from "./lib/client.mjs";

const TOKEN = "ghp-test-ROLLOUT-TOKEN-0123456789";
const RO = "/api/v1/rollouts";
const SKILL = "---\nname: rollout-skill\ndescription: Rollout probe skill. Use when testing rollouts.\n---\n\n# rollout-skill\n\nSteps.\n";
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// ---- GitHub REST API imitation ----
const seen = [];
const EXISTING_LOCK = JSON.stringify({ registry: "http://old", artifacts: { "skill/other": { version: "1.0.0", digest: "d", files: {}, installed_at: "2026-01-01T00:00:00Z" } } });
let gh;
function ghHandler(req, res) {
  let raw = "";
  req.on("data", (d) => (raw += d));
  req.on("end", () => {
    const url = new URL(req.url, "http://x");
    const body = raw ? JSON.parse(raw) : null;
    seen.push({ method: req.method, path: url.pathname, query: url.search, auth: req.headers.authorization, body });
    const send = (code, data) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    const m = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
    if (!m) return send(404, { message: "Not Found" });
    const [, owner, repo, rest = ""] = m;
    if (repo === "missing") return send(404, { message: "Not Found" });
    if (req.method === "GET" && rest === "") return send(200, { full_name: `${owner}/${repo}`, default_branch: "main" });
    if (req.method === "GET" && rest === "/git/ref/heads/main") return send(200, { object: { sha: "base-sha" } });
    if (req.method === "POST" && rest === "/git/refs") return send(201, { ref: body.ref });
    if (req.method === "GET" && rest.startsWith("/contents/")) {
      if (repo === "web" && rest === "/contents/.claude/.skillforge-lock.json") {
        return send(200, { sha: "lock-sha", encoding: "base64", content: Buffer.from(EXISTING_LOCK).toString("base64") });
      }
      return send(404, { message: "Not Found" });
    }
    if (req.method === "PUT" && rest.startsWith("/contents/")) return send(201, { content: { path: rest.slice(10) } });
    if (req.method === "POST" && rest === "/pulls") return send(201, { number: 7, html_url: `https://github.example/${owner}/${repo}/pull/7` });
    return send(404, { message: "Not Found" });
  });
}

let srv;
const auth = {};
const call = (method, path, body, who = auth.admin) => api(srv.base, method, path, body, who ? { cookie: who.cookie } : {});
const puts = (repo) => seen.filter((r) => r.method === "PUT" && r.path.startsWith(`/repos/acme/${repo}/contents/`));
const fileOf = (r) => Buffer.from(r.body.content, "base64").toString("utf8");

let rollout;
before(async () => {
  gh = createServer(ghHandler);
  await new Promise((r) => gh.listen(0, "127.0.0.1", r));
  const ghUrl = `http://127.0.0.1:${gh.address().port}`;
  srv = await startServer({ SKILLFORGE_GITHUB_API_URL: ghUrl, SKILLFORGE_GITHUB_TOKEN: TOKEN }, { prefix: "skillforge-rollout-" });
  assert.ok(srv.up, srv.stderr);
  auth.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [["rita", "reviewer"], ["lena", "contributor"]]) {
    await createUser(srv.base, auth.admin.cookie, { username: u, password: `${u}-pw-123456`, role });
    auth[u] = await login(srv.base, u, `${u}-pw-123456`);
  }
  for (const n of ["rollout-skill", "draft-skill"]) {
    const md = n === "rollout-skill" ? SKILL : SKILL.replaceAll("rollout-skill", n);
    assert.equal((await call("POST", "/api/v1/artifacts", { type: "skill", version: "1.2.0", files: toB64([{ path: `${n}/SKILL.md`, content: md }]) }, auth.lena)).status, 201);
  }
  assert.equal((await call("POST", "/api/v1/artifacts/skill/rollout-skill/transitions", { to: "active", reason: "rollout test" }, auth.rita)).status, 200);
  const r = await call("POST", RO, { repos: ["acme/api", "acme/web", "acme/missing"], artifacts: [{ type: "skill", name: "rollout-skill" }] });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  rollout = r.data.rollout;
});

after(async () => {
  await srv?.stop();
  await new Promise((r) => gh?.close(r));
});

test("permissions and request validation", async () => {
  assert.equal((await call("POST", RO, { repos: ["acme/api"], artifacts: [{ type: "skill", name: "rollout-skill" }] }, auth.lena)).status, 403);
  for (const bad of [
    { repos: ["not a repo"], artifacts: [{ type: "skill", name: "rollout-skill" }] },
    { repos: [], artifacts: [{ type: "skill", name: "rollout-skill" }] },
    { repos: ["acme/api"], artifacts: [] },
    { repos: ["acme/api"], artifacts: [{ type: "hook", name: "rollout-skill" }] },
  ]) {
    assert.equal((await call("POST", RO, bad)).status, 400, JSON.stringify(bad));
  }
  const draft = await call("POST", RO, { repos: ["acme/api"], artifacts: [{ type: "skill", name: "draft-skill" }] });
  assert.equal(draft.status, 422, "active only");
  assert.equal(draft.data.error, "not_active");
  const ghost = await call("POST", RO, { repos: ["acme/api"], artifacts: [{ type: "skill", name: "no-such" }] });
  assert.equal(ghost.status, 422);
  assert.equal(ghost.data.error, "unknown_artifact");
});

test("result per repository; a failure of one does not stop the others", () => {
  const by = Object.fromEntries(rollout.results.map((x) => [x.repo, x]));
  assert.equal(by["acme/api"].status, "opened");
  assert.equal(by["acme/api"].pr_url, "https://github.example/acme/api/pull/7");
  assert.equal(by["acme/web"].status, "opened");
  assert.equal(by["acme/missing"].status, "failed");
  assert.ok(by["acme/missing"].error, "failure reason");
});

test("branch from the default branch, artifact files and CLI lock file, PR into the default branch", async () => {
  const ref = seen.find((r) => r.method === "POST" && r.path === "/repos/acme/api/git/refs");
  assert.equal(ref.body.sha, "base-sha");
  assert.match(ref.body.ref, /^refs\/heads\/skillforge\//);
  const branch = ref.body.ref.slice("refs/heads/".length);
  const files = Object.fromEntries(puts("api").map((r) => [r.path.slice("/repos/acme/api/contents/".length), r]));
  assert.equal(fileOf(files[".claude/skills/rollout-skill/SKILL.md"]), SKILL);
  assert.ok(puts("api").every((r) => r.body.branch === branch), "all files go to the new branch");
  const lock = JSON.parse(fileOf(files[".claude/.skillforge-lock.json"]));
  const card = (await call("GET", "/api/v1/artifacts/skill/rollout-skill")).data;
  assert.match(lock.registry, /^https?:\/\//);
  assert.equal(lock.artifacts["skill/rollout-skill"].version, "1.2.0");
  assert.equal(lock.artifacts["skill/rollout-skill"].digest, card.latest.digest);
  assert.deepEqual(lock.artifacts["skill/rollout-skill"].files, { "skills/rollout-skill/SKILL.md": sha256(SKILL) });
  const pr = seen.find((r) => r.method === "POST" && r.path === "/repos/acme/api/pulls");
  assert.deepEqual([pr.body.base, pr.body.head], ["main", branch]);
  assert.match(pr.body.body, /rollout-skill@1\.2\.0/);
});

test("an existing lock file is extended, not overwritten", () => {
  const lockPut = puts("web").find((r) => r.path.endsWith("/.skillforge-lock.json"));
  assert.equal(lockPut.body.sha, "lock-sha", "update of an existing file");
  const lock = JSON.parse(fileOf(lockPut));
  assert.ok(lock.artifacts["skill/other"], "another entry is preserved");
  assert.ok(lock.artifacts["skill/rollout-skill"]);
});

test("the token goes only to GitHub and is visible nowhere", async () => {
  assert.ok(seen.length > 0 && seen.every((r) => r.auth === `Bearer ${TOKEN}`));
  const list = await call("GET", RO);
  assert.equal(list.status, 200);
  assert.equal(list.data.items[0].id, rollout.id);
  const audit = await call("GET", "/api/v1/admin/audit?action=rollout_create");
  assert.equal(audit.data.items.length, 1);
  for (const text of [JSON.stringify(rollout), JSON.stringify(list.data), JSON.stringify(audit.data)]) {
    assert.ok(!text.includes(TOKEN), "token in the response");
  }
});

test("without a token rollout is unavailable", async () => {
  const bare = await startServer({}, { prefix: "skillforge-rollout-bare-" });
  try {
    const admin = await login(bare.base, "admin", ADMIN_PASSWORD);
    const r = await api(bare.base, "POST", RO, { repos: ["acme/api"], artifacts: [{ type: "skill", name: "x" }] }, { cookie: admin.cookie });
    assert.equal(r.status, 503);
    assert.equal(r.data.error, "github_not_configured");
  } finally {
    await bare.stop();
  }
});
