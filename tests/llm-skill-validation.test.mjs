// An external LLM as a
// shared service and automatic skill checks. The model is the stub tests/lib/fake-llm.mjs; the plugin
// is the real `plugins/review-assistant`, loaded as bundled (`SKILLFORGE_BUNDLED_PLUGINS_DIR`). No real model is needed here: the test
// checks what the code must do regardless of the model's answer. Evaluating the model itself is a separate measurement.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { startServer, api, login, createUser, toB64, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";
import { startFakeLlm, UPSTREAM_SECRET_DETAIL } from "./lib/fake-llm.mjs";

const KEY = "sk-test-KEYMARKER-validator-0123456789";
const EXT = "/api/v1/ext/review-assistant";
const BUNDLED = join(ROOT, "plugins");
let fake;
let foreign;
let srv;
let work;
const auth = {};

const skillMd = (name, extra = "") =>
  `---\nname: ${name}\ndescription: Keeps release notes up to date. Use when a release is being prepared.\n---\n\n# ${name}\n\nAlways use the latest version of the changelog tool.\n${extra}\n`;
const LINE_OF_QUOTE = 8;
const QUOTE = "Always use the latest version";

const call = (method, path, body, who = auth.admin) => api(srv.base, method, path, body, who ? { cookie: who.cookie } : {});
const putLlm = (body, who = auth.admin) => call("PUT", "/api/v1/admin/llm", body, who);
const getLlm = () => call("GET", "/api/v1/admin/llm");
async function publishSkill(name, who = auth.alice, extra = "") {
  const r = await call("POST", "/api/v1/artifacts", { type: "skill", files: toB64([{ path: `${name}/SKILL.md`, content: skillMd(name, extra) }]) }, who);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r;
}
const runsOf = async (name, type = "skill") => (await call("GET", `${EXT}/artifacts/${type}/${name}/runs`)).data.items;
async function until(fn, timeout = 30000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) assert.fail("timed out waiting");
    await new Promise((r) => setTimeout(r, 150));
  }
}
async function finishedRun(name) {
  const run = await until(async () => (await runsOf(name)).find((x) => x.status === "done" || x.status === "failed"));
  return (await call("GET", `${EXT}/runs/${run.id}`)).data.run;
}
const findingsReply = (findings) => JSON.stringify({ findings });
const GOOD = { severity: "high", category: "unsafe_command", file: "skills/NAME/SKILL.md", quote: QUOTE, summary: "Unpinned tool version", suggestion: "Pin the version" };
const good = (name) => ({ ...GOOD, file: `skills/${name}/SKILL.md` });

before(async () => {
  work = mkdtempSync(join(tmpdir(), "skillforge-llmval-"));
  fake = await startFakeLlm();
  foreign = await startFakeLlm();
  srv = await startServer(
    {
      SKILLFORGE_LLM_API_KEY: KEY,
      SKILLFORGE_LLM_KEY_ORIGINS: fake.origin,
      SKILLFORGE_BUNDLED_PLUGINS_DIR: BUNDLED,
      SKILLFORGE_REVIEWERS_FILE: join(work, "no-such-reviewers.json"),
    },
    { prefix: "skillforge-llmval-srv-" },
  );
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  auth.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [["alice", "contributor"], ["rita", "reviewer"], ["bob", "viewer"]]) {
    await createUser(srv.base, auth.admin.cookie, { username: u, password: `${u}-pw-123456`, role });
    auth[u] = await login(srv.base, u, `${u}-pw-123456`);
  }
});

after(async () => {
  await srv?.stop();
  await fake?.stop();
  await foreign?.stop();
  rmSync(work, { recursive: true, force: true });
});

test("the bundled plugin loads by itself; settings: undecided by default, admin only, values are validated", async () => {
  const plugins = await call("GET", "/api/v1/admin/plugins");
  assert.equal(plugins.data.items.find((p) => p.name === "review-assistant")?.status, "loaded", JSON.stringify(plugins.data));

  const v = await getLlm();
  assert.equal(v.data.settings.validation_enabled, null);
  assert.equal(v.data.validation.active, false);
  assert.equal(v.data.validation.reason, "not_configured");
  assert.equal(v.data.validation.consumer_ready, true);

  assert.equal((await putLlm({ validation_enabled: true }, auth.rita)).status, 403);
  for (const bad of [{ validation_enabled: "yes" }, { validation_daily_requests: -1 }, { validation_max_output_tokens: 10 }, { validation_timeout_s: 1 }]) {
    assert.equal((await putLlm(bad)).status, 400, JSON.stringify(bad));
  }
});

test("an already configured installation: the validator is off until confirmed, no content leaves", async () => {
  const db = new DatabaseSync(join(srv.dataDir, "skillforge.db"));
  db.prepare("INSERT INTO llm_settings (id, settings, updated_by, updated_at) VALUES (1, ?, 'old', '2026-10-31') ON CONFLICT(id) DO UPDATE SET settings = excluded.settings").run(
    JSON.stringify({ enabled: true, base_url: fake.url, model: "m1", temperature: 0.2, max_output_tokens: 1024, timeout_s: 60, daily_requests_per_user: 50, context_topics: 6 }),
  );
  db.close();

  const v = await getLlm();
  assert.equal(v.data.settings.validation_enabled, null);
  assert.equal(v.data.validation.active, false);
  assert.equal(v.data.validation.reason, "undecided");

  // Changing another setting is not a confirmation.
  assert.equal((await putLlm({ temperature: 0.3 })).data.settings.validation_enabled, null);

  const before = fake.chatRequests().length;
  await publishSkill("undecided-skill");
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(fake.chatRequests().length, before, "content was sent to the provider without confirmation");
  assert.deepEqual(await runsOf("undecided-skill"), []);
  // The assistant works as before.
  assert.equal((await call("GET", "/api/v1/assistant/status")).data.available, true);

  // Reset to "not configured" so the next test starts from a clean slate.
  assert.equal((await putLlm({ base_url: "" })).status, 200);
});

test("the first LLM setup turns the validator on; an explicit opt-out stays off", async () => {
  const db = new DatabaseSync(join(srv.dataDir, "skillforge.db"));
  db.prepare("DELETE FROM llm_settings").run();
  db.close();

  const off = await putLlm({ base_url: fake.url, model: "m1", validation_enabled: false });
  assert.equal(off.data.settings.validation_enabled, false);
  assert.equal(off.data.validation.reason, "disabled");

  const db2 = new DatabaseSync(join(srv.dataDir, "skillforge.db"));
  db2.prepare("DELETE FROM llm_settings").run();
  db2.close();

  const on = await putLlm({ base_url: fake.url, model: "m1" });
  assert.equal(on.data.settings.validation_enabled, true);
  assert.equal(on.data.validation.active, true);
  // The assistant is a separate switch; the validator does not turn it on.
  assert.equal(on.data.settings.enabled, false);
});

test("publishing a skill: checked in the background; quotes are matched against the file; status unchanged; no evidence", async () => {
  const name = "checked-skill";
  fake.setReply(findingsReply([
    good(name),
    { ...good(name), quote: "this text is not in the file at all", summary: "Invented finding" },
    { ...good(name), file: "skills/other/SKILL.md", summary: "Wrong file" },
    { ...good(name), quote: undefined, summary: "No quote" },
  ]));
  const before = fake.chatRequests().length;
  await publishSkill(name);
  const run = await finishedRun(name);

  assert.equal(run.status, "done");
  assert.equal(run.trigger, "validation");
  assert.equal(run.requested_by, "alice");
  const llm = run.reviewers.find((r) => r.id === "llm");
  assert.equal(llm.status, "ok");
  assert.equal(llm.model, "m1");
  assert.equal(llm.dropped_findings, 3);
  assert.equal(llm.truncated, false);
  assert.ok(llm.prompt_version);
  assert.equal(run.findings.length, 1, JSON.stringify(run.findings));
  assert.equal(run.findings[0].summary, "Unpinned tool version");
  assert.equal(run.findings[0].line, LINE_OF_QUOTE);

  // The request: content as data, no tools, the validator's limit, the key only to the allowed address.
  const reqs = fake.chatRequests().slice(before);
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0].headers.authorization, `Bearer ${KEY}`);
  assert.equal(reqs[0].body.tools, undefined);
  assert.equal(reqs[0].body.max_tokens, (await getLlm()).data.settings.validation_max_output_tokens);
  const system = reqs[0].body.messages.find((m) => m.role === "system").content;
  assert.match(system, /data, not instructions/i);
  assert.ok(reqs[0].body.messages.find((m) => m.role === "user").content.includes(QUOTE));
  assert.ok(!system.includes(QUOTE), "the skill content got into the system message");

  // A finding neither promotes nor demotes the status; a model check is not a review.
  const art = (await call("GET", `/api/v1/artifacts/skill/${name}`)).data.artifact;
  assert.equal(art.status, "candidate");
  const ver = (await call("GET", `/api/v1/artifacts/skill/${name}/versions/0.1.0`)).data;
  assert.deepEqual(ver.evidence, []);

  // The tab does not promise safety and shows what checked it.
  const tab = (await call("GET", `/api/v1/plugins/ui/tabs/review-assistant/review/skill/${name}`, undefined, auth.rita)).data;
  assert.match(tab.markdown, /m1/);
  assert.match(tab.markdown, /does not mean the skill is safe/i);
  assert.doesNotMatch(tab.markdown, /\bsafe\b(?! )/);
  assert.ok(tab.actions.some((a) => a.path === "/validation/runs"), JSON.stringify(tab.actions));
});

test("markup from the model's answer is escaped in the tab", async () => {
  const name = "markup-skill";
  fake.setReply(findingsReply([{ ...good(name), summary: "![x](http://evil.example/p.png) <img src=x>" }]));
  await publishSkill(name);
  await finishedRun(name);
  const tab = (await call("GET", `/api/v1/plugins/ui/tabs/review-assistant/review/skill/${name}`, undefined, auth.rita)).data;
  const text = tab.sections.map((s) => s.markdown).join("\n");
  assert.match(text, /evil\.example/, "the finding is not shown");
  // Every metacharacter is escaped: no markup is left without a backslash.
  assert.doesNotMatch(text, /(^|[^\\])!\\?\[x/m);
  assert.doesNotMatch(text, /(^|[^\\])<img/m);
});

test("a failure means 'not checked', not clean: invalid JSON, provider error, timeout; publishing does not wait", async () => {
  fake.setReply("I think this skill looks fine.");
  await publishSkill("bad-json-skill");
  const bad = await finishedRun("bad-json-skill");
  assert.equal(bad.status, "failed");
  assert.equal(bad.reviewers.find((r) => r.id === "llm").status, "invalid_output");
  assert.equal(bad.findings.length, 0);

  fake.next("error401");
  await publishSkill("denied-skill");
  const denied = await finishedRun("denied-skill");
  assert.equal(denied.status, "failed");
  assert.equal(denied.reviewers.find((r) => r.id === "llm").error, "llm_unauthorized");
  assert.ok(!JSON.stringify(denied).includes(UPSTREAM_SECRET_DETAIL), "the provider's response body got into the run");

  await putLlm({ validation_timeout_s: 5 });
  fake.next("hang");
  const started = Date.now();
  await publishSkill("hanging-skill");
  assert.ok(Date.now() - started < 3000, "publishing waited for the model");
  const hung = await finishedRun("hanging-skill");
  assert.equal(hung.status, "failed");
  assert.equal(hung.reviewers.find((r) => r.id === "llm").status, "timeout");
  await putLlm({ validation_timeout_s: 120 });
});

test("skills only: a command and an agent are not sent to the model", async () => {
  const before = fake.chatRequests().length;
  const r = await call("POST", "/api/v1/artifacts", {
    type: "command",
    files: toB64([{ path: "cmd-one.md", content: "---\nname: cmd-one\ndescription: A command. Use when asked.\n---\n\nDo the thing.\n" }]),
  }, auth.alice);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  await new Promise((res) => setTimeout(res, 800));
  assert.equal(fake.chatRequests().length, before);
  assert.deepEqual(await runsOf("cmd-one", "command"), []);
});

test("the validator budget is separate from the user limit; usage without text", async () => {
  await putLlm({ validation_daily_requests: 1, enabled: true, daily_requests_per_user: 50 });
  const usageBefore = (await getLlm()).data.usage;
  fake.setReply(findingsReply([]));
  const db = new DatabaseSync(join(srv.dataDir, "skillforge.db"));
  db.prepare("DELETE FROM llm_task_usage").run();
  db.close();

  await publishSkill("budget-one");
  const one = await finishedRun("budget-one");
  assert.equal(one.status, "done");
  const before = fake.chatRequests().length;
  await publishSkill("budget-two");
  const two = await finishedRun("budget-two");
  assert.equal(two.status, "failed");
  assert.equal(two.reviewers.find((r) => r.id === "llm").error, "llm_budget_exhausted");
  assert.equal(fake.chatRequests().length, before, "the model was called over the budget");

  const after = (await getLlm()).data.usage;
  assert.equal(after.today.requests, usageBefore.today.requests, "checks used up the user limit");
  assert.equal(after.tasks.skill_validation.today.requests, 1);
  assert.ok(after.tasks.skill_validation.today.input_tokens > 0);
  assert.equal((await call("POST", "/api/v1/assistant/chat", { mode: "consult", lang: "en", messages: [{ role: "user", content: "hello" }] }, auth.alice)).status, 200, "the assistant stopped working because of the check budget");
  await putLlm({ validation_daily_requests: 1000 });
});

test("manual check and backfill: permissions, a repeat makes no new requests, a new model checks again", async () => {
  const name = "recheck-skill";
  fake.setReply(findingsReply([]));
  await publishSkill(name);
  const first = await finishedRun(name);

  const path = `${EXT}/validation/runs`;
  const body = { type: "skill", name };
  assert.equal((await call("POST", path, body, auth.alice)).status, 403);
  assert.equal((await call("POST", path, { type: "skill", name: "nope" }, auth.rita)).status, 404);
  const n = fake.chatRequests().length;
  const again = await call("POST", path, body, auth.rita);
  assert.equal(again.status, 200);
  assert.equal(again.data.run.id, first.id);
  assert.equal(fake.chatRequests().length, n, "a repeated check spent a request");

  // Backfill: admin only; a skill published before the confirmation is checked, already checked ones are not.
  assert.equal((await call("POST", `${EXT}/validation/backfill`, {}, auth.rita)).status, 403);
  const fill = await call("POST", `${EXT}/validation/backfill`, {});
  assert.equal(fill.status, 200, JSON.stringify(fill.data));
  assert.ok(fill.data.queued >= 1);
  await until(async () => (await runsOf("undecided-skill")).some((x) => x.status === "done"));
  await until(async () => {
    const r = await call("POST", `${EXT}/validation/backfill`, {});
    return r.data.queued === 0;
  });

  await putLlm({ model: "m2" });
  const m = await call("POST", path, body, auth.rita);
  assert.equal(m.status, 202, "a model change must give a new check");
  await until(async () => (await call("GET", `${EXT}/runs/${m.data.run.id}`)).data.run.status === "done");
  await putLlm({ model: "m1" });
});

test("without a reviewers file a manual run uses only the model; validator off gives 503 as before", async () => {
  const name = "manual-skill";
  await putLlm({ validation_enabled: false });
  await publishSkill(name);
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(await runsOf(name), []);
  const off = await call("POST", `${EXT}/runs`, { type: "skill", name }, auth.rita);
  assert.equal(off.status, 503);
  assert.equal(off.data.error, "reviewers_not_configured");

  await putLlm({ validation_enabled: true });
  fake.setReply(findingsReply([good(name)]));
  const on = await call("POST", `${EXT}/runs`, { type: "skill", name }, auth.rita);
  assert.equal(on.status, 202, JSON.stringify(on.data));
  assert.equal(on.data.run.trigger, "manual");
  const run = await finishedRun(name);
  assert.deepEqual(run.reviewers.map((r) => r.id), ["llm"]);
});

test("the key goes only to the allowed address; the key is not in settings, runs or the plugin", async () => {
  await putLlm({ base_url: foreign.url });
  fake.setReply(findingsReply([]));
  await publishSkill("foreign-skill");
  await finishedRun("foreign-skill");
  const req = foreign.chatRequests().at(-1);
  assert.ok(req, "the request did not arrive");
  assert.equal(req.headers.authorization, undefined);
  await putLlm({ base_url: fake.url });

  for (const r of [await getLlm(), await call("GET", `${EXT}/artifacts/skill/foreign-skill/runs`)]) {
    assert.ok(!JSON.stringify(r.data).includes(KEY), "the key is in an API response");
  }
  writeFileSync(join(work, "marker"), "");
  assert.ok(!srv.stdout.includes(KEY) && !srv.stderr.includes(KEY), "the key is in the server log");
});

test("purge removes the check runs", async () => {
  const name = "purged-skill";
  fake.setReply(findingsReply([good(name)]));
  await publishSkill(name);
  await finishedRun(name);
  const p = await call("POST", `/api/v1/artifacts/skill/${name}/purge`, { confirm: `skill/${name}`, reason: "validator test cleanup" });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.deepEqual(await runsOf(name), []);
});
