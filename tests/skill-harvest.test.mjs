// Skills from past work: rules that repeat in PR review comments (GitHub) and in a human's requests in agent session
// logs become a skill draft with links to the evidence. A draft from a PR is published as a candidate and
// goes through the usual review; a draft from sessions is built locally by the CLI, without a network.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const TOKEN = "ghp-test-HARVEST-TOKEN-0123456789";
const PR = (n) => `https://api.github.example/repos/acme/api/pulls/${n}`;
const HTML = (n, c) => `https://github.example/acme/api/pull/${n}#discussion_r${c}`;
const COMMENTS = [
  { id: 1, body: "Always add a timeout to HTTP calls.", pull_request_url: PR(1), html_url: HTML(1, 1) },
  { id: 2, body: "always add a timeout to http calls", pull_request_url: PR(2), html_url: HTML(2, 2) },
  { id: 3, body: "Looks good otherwise. Please always add a timeout to HTTP calls!", pull_request_url: PR(3), html_url: HTML(3, 3) },
  { id: 4, body: "Never log tokens.", pull_request_url: PR(1), html_url: HTML(1, 4) },
  { id: 5, body: "Never log tokens.", pull_request_url: PR(2), html_url: HTML(2, 5) },
  { id: 6, body: "nit: typo", pull_request_url: PR(2), html_url: HTML(2, 6) },
  { id: 7, body: "```js\n// always add a timeout to http calls\n```", pull_request_url: PR(4), html_url: HTML(4, 7) },
];

const seen = [];
let gh;
let srv;
const auth = {};
const call = (method, path, body, who = auth.admin) => api(srv.base, method, path, body, who ? { cookie: who.cookie } : {});
let harvest;

before(async () => {
  gh = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    seen.push({ method: req.method, path: url.pathname, search: url.search, auth: req.headers.authorization });
    res.writeHead(url.pathname === "/repos/acme/api/pulls/comments" ? 200 : 404, { "content-type": "application/json" });
    const page = Number(url.searchParams.get("page") ?? "1");
    res.end(JSON.stringify(url.pathname === "/repos/acme/api/pulls/comments" ? (page === 1 ? COMMENTS : []) : { message: "Not Found" }));
  });
  await new Promise((r) => gh.listen(0, "127.0.0.1", r));
  srv = await startServer({ SKILLFORGE_GITHUB_API_URL: `http://127.0.0.1:${gh.address().port}`, SKILLFORGE_GITHUB_TOKEN: TOKEN }, { prefix: "skillforge-harvest-" });
  assert.ok(srv.up, srv.stderr);
  auth.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  await createUser(srv.base, auth.admin.cookie, { username: "lena", password: "lena-pw-123456", role: "contributor" });
  auth.lena = await login(srv.base, "lena", "lena-pw-123456");
  const r = await call("POST", "/api/v1/harvests", { source: "github", repo: "acme/api", days: 30 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  harvest = r.data.harvest;
});

after(async () => {
  await srv?.stop();
  await new Promise((r) => gh?.close(r));
});

test("permissions and request validation", async () => {
  assert.equal((await call("POST", "/api/v1/harvests", { source: "github", repo: "acme/api" }, auth.lena)).status, 403);
  assert.equal((await call("POST", "/api/v1/harvests", { source: "github", repo: "not a repo" })).status, 400);
  assert.equal((await call("POST", "/api/v1/harvests", { source: "email", repo: "acme/api" })).status, 400);
});

test("from PR review: only repeating rules, with evidence; code in comments does not count", () => {
  assert.equal(harvest.rules.length, 1, JSON.stringify(harvest.rules));
  const rule = harvest.rules[0];
  assert.match(rule.text, /always add a timeout to http calls/i);
  assert.deepEqual([rule.count, rule.sources], [3, 3]);
  assert.deepEqual(rule.evidence.sort(), [HTML(1, 1), HTML(2, 2), HTML(3, 3)].sort());
  const since = new URLSearchParams(seen.find((r) => r.path === "/repos/acme/api/pulls/comments").search).get("since");
  assert.ok(Date.now() - Date.parse(since) <= 31 * 86400000, "the request period is 30 days");
  assert.ok(seen.every((r) => r.auth === `Bearer ${TOKEN}`));
  assert.ok(!JSON.stringify(harvest).includes(TOKEN));
});

test("a draft from a harvest is a rule candidate by default; type skill keeps the skill draft; another type is refused", async () => {
  // rule-artifacts: the draft is a rule unless the admin asks for a skill.
  const r = await call("POST", `/api/v1/harvests/${harvest.id}/draft`, { name: "api-review-habits" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const rule = (await call("GET", "/api/v1/artifacts/rule/api-review-habits")).data;
  assert.equal(rule.artifact.status, "candidate");
  assert.equal(rule.latest.provenance?.source, "harvest");
  const ruleFile = await fetch(`${srv.base}/api/v1/artifacts/rule/api-review-habits/versions/${rule.latest.version}/files/rules/api-review-habits.md`, { headers: { cookie: auth.admin.cookie } });
  assert.equal(ruleFile.status, 200);
  const ruleText = await ruleFile.text();
  assert.match(ruleText, /timeout/i);
  assert.ok(ruleText.includes(HTML(1, 1)), "a link to the evidence in the rule");
  const refused = await call("POST", `/api/v1/harvests/${harvest.id}/draft`, { name: "api-review-hook", type: "hook" });
  assert.equal(refused.status, 400);
  assert.equal((await call("GET", "/api/v1/artifacts/hook/api-review-hook")).status, 404);

  const d = await call("POST", `/api/v1/harvests/${harvest.id}/draft`, { name: "api-review-rules", type: "skill" });
  assert.equal(d.status, 201, JSON.stringify(d.data));
  const card = (await call("GET", "/api/v1/artifacts/skill/api-review-rules")).data;
  assert.equal(card.artifact.status, "candidate", "the draft does not bypass review");
  assert.equal(card.latest.provenance?.source, "harvest");
  // The file is markdown, not JSON: read it as text.
  const file = await fetch(`${srv.base}/api/v1/artifacts/skill/api-review-rules/versions/${card.latest.version}/files/skills/api-review-rules/SKILL.md`, { headers: { cookie: auth.admin.cookie } });
  assert.equal(file.status, 200);
  const text = await file.text();
  assert.match(text, /timeout/i);
  assert.ok(text.includes(HTML(1, 1)), "a link to the evidence in the text");
  assert.equal((await call("POST", `/api/v1/harvests/${harvest.id}/draft`, { name: "api-review-rules", type: "skill" })).status, 409, "name is taken");
  assert.equal((await call("GET", "/api/v1/harvests")).data.items[0].id, harvest.id);
});

test("CLI: a draft from session logs — only the human's requests, locally, without a network; a rule by default", () => {
  const work = mkdtempSync(join(tmpdir(), "skillforge-harvest-cli-"));
  const logs = join(work, "projects", "app");
  mkdirSync(logs, { recursive: true });
  const user = (text) => JSON.stringify({ type: "user", message: { role: "user", content: text } });
  const userBlocks = (text) => JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
  const assistant = (text) => JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
  const toolResult = (text) => JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: text }] } });
  writeFileSync(join(logs, "s1.jsonl"), [user("Always run the linter before committing."), assistant("Always run the linter before committing.")].join("\n"));
  writeFileSync(join(logs, "s2.jsonl"), [userBlocks("please always run the linter before committing")].join("\n"));
  writeFileSync(join(logs, "s3.jsonl"), [user("Thanks. Always run the linter before committing!"), toolResult("Always run the linter before committing.")].join("\n"));
  writeFileSync(join(logs, "s4.jsonl"), [user("Never push to main."), user("Never push to main.")].join("\n"));
  const out = join(work, "draft");
  const env = { ...process.env, SKILLFORGE_URL: "http://127.0.0.1:9", SKILLFORGE_CONFIG: join(work, "cli.json"), NO_COLOR: "1" };
  const r = spawnSync(process.execPath, [CLI, "harvest", "sessions", "--dir", join(work, "projects"), "--out", out, "--name", "lint-rules", "--json"], { env, encoding: "utf8", timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  assert.equal(res.rules.length, 1, "'Never push to main' is one session, not a rule");
  assert.deepEqual([res.rules[0].count, res.rules[0].sources], [3, 3], "agent answers and tool output do not count");
  const md = readFileSync(join(out, "rules", "lint-rules.md"), "utf8");
  assert.match(md, /^---\nname: lint-rules\n/);
  assert.match(md, /run the linter before committing/i);
  assert.match(md, /s1\.jsonl/, "the evidence is the session file");

  // --type skill keeps the earlier skill draft.
  const outSkill = join(work, "draft-skill");
  const s2 = spawnSync(process.execPath, [CLI, "harvest", "sessions", "--dir", join(work, "projects"), "--out", outSkill, "--name", "lint-rules", "--type", "skill"], { env, encoding: "utf8", timeout: 60_000 });
  assert.equal(s2.status, 0, s2.stderr);
  assert.match(readFileSync(join(outSkill, "skills", "lint-rules", "SKILL.md"), "utf8"), /^---\nname: lint-rules\n/);
});
