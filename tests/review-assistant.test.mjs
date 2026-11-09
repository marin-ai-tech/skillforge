// Independent review plugin: external reviewer agents (processes listed in the `SKILLFORGE_REVIEWERS_FILE` file), a "judge"
// (built-in or a command), findings with a reviewer's decision, version evidence, a tab with actions; plugin platform
// extensions (`sections[].actions`, `user` in a tab, `registry.addEvidence`) — the contract is set by the fixture tests/fixtures/plugins/actions.
// Reviewers in the test are tests/fixtures/review/mock-reviewer.mjs (personas), the judge is mock-judge.mjs.
// Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const PLUGIN_SRC = join(ROOT, "plugins", "review-assistant");
const ACTIONS_FIXTURE = join(ROOT, "tests", "fixtures", "plugins", "actions");
const MOCK = join(ROOT, "tests", "fixtures", "review", "mock-reviewer.mjs");
const JUDGE = join(ROOT, "tests", "fixtures", "review", "mock-judge.mjs");
const EXT = "/api/v1/ext/review-assistant";

const SKILL_MD = `---
name: stale-notes
description: Keeps release notes up to date. Use when a release is being prepared and the notes are missing.
---

# Stale notes

Always use the latest version of the changelog tool.

Steps:
1. Collect merged PRs.
2. Group them by label.
`;
const FRESHNESS_LINE = SKILL_MD.split("\n").findIndex((l) => /latest version/.test(l)) + 1;
// Published as `stale-notes/SKILL.md` (a skill folder); in the version the canonical path is `skills/stale-notes/SKILL.md`.
const SKILL_PATH = "skills/stale-notes/SKILL.md";
const INPUT_PATH = "stale-notes/SKILL.md";

let work;
let reviewersFile;
let srv;
let base;
let admin;
let rita;
let alice;

const reviewer = (id, personaArgs, extra = {}) => ({ id, command: [process.execPath, MOCK, ...personaArgs], timeout_s: 20, ...extra });
const baseReviewers = () => [
  reviewer("strict", ["--persona", "strict", "--input", "json"]),
  reviewer("lenient", ["--persona", "lenient", "--input", "prompt", "--wrap", "claude"]),
  reviewer("injection", ["--persona", "injection", "--input", "json", "--wrap", "fence"]),
  reviewer("broken", ["--persona", "broken"]),
  reviewer("crash", ["--persona", "crash"]),
  reviewer("slow", ["--persona", "slow", "--pid-file", join(work, "slow.pid")], { timeout_s: 2 }),
];
const writeReviewers = (cfg) => writeFileSync(reviewersFile, JSON.stringify(cfg, null, 2));

async function until(fn, { timeout = 30000, step = 200 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return v;
    await new Promise((r) => setTimeout(r, step));
  }
}

const b64 = (s) => Buffer.from(s).toString("base64");
async function publishSkill(version) {
  // Each version has its own content (the registry rejects an identical digest as a duplicate); the "latest version" row does not shift.
  const content = version === "0.1.0" ? SKILL_MD : `${SKILL_MD}\nRevision ${version}: wording unchanged.\n`;
  const r = await api(base, "POST", "/api/v1/artifacts", { type: "skill", version, files: [{ path: INPUT_PATH, content_base64: b64(content) }] }, { cookie: admin.cookie });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.version.version;
}

async function runReview(auth, body = { type: "skill", name: "stale-notes" }) {
  const r = await api(base, "POST", `${EXT}/runs`, body, auth);
  assert.equal(r.status, 202, JSON.stringify(r.data));
  const id = r.data.run.id;
  const done = await until(async () => {
    const g = await api(base, "GET", `${EXT}/runs/${id}`, undefined, auth);
    return ["done", "failed"].includes(g.data.run?.status) ? g.data : null;
  });
  assert.ok(done, "the run did not finish within 30 s");
  return done;
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

before(async () => {
  assert.ok(existsSync(PLUGIN_SRC), `no plugin ${PLUGIN_SRC}`);
  work = mkdtempSync(join(tmpdir(), "skillforge-review-work-"));
  const pluginsDir = join(work, "plugins");
  mkdirSync(pluginsDir, { recursive: true });
  cpSync(PLUGIN_SRC, join(pluginsDir, "review-assistant"), { recursive: true });
  cpSync(ACTIONS_FIXTURE, join(pluginsDir, "actions"), { recursive: true });
  reviewersFile = join(work, "reviewers.json");
  writeReviewers({ reviewers: baseReviewers() });
  srv = await startServer({ SKILLFORGE_PLUGINS_DIR: pluginsDir, SKILLFORGE_REVIEWERS_FILE: reviewersFile }, { prefix: "skillforge-review-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  await createUser(base, admin.cookie, { username: "rita", password: "rita-pw-123", role: "reviewer" });
  await createUser(base, admin.cookie, { username: "alice", password: "alice-pw-1", role: "contributor" });
  rita = await login(base, "rita", "rita-pw-123");
  alice = await login(base, "alice", "alice-pw-1");
  await publishSkill("0.1.0");
});

after(async () => {
  if (srv?.up) await srv.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("plugin loaded: status loaded, config schema, tab", async () => {
  const list = await api(base, "GET", "/api/v1/admin/plugins", undefined, { cookie: admin.cookie });
  const p = list.data.items.find((x) => x.name === "review-assistant");
  assert.ok(p, JSON.stringify(list.data));
  assert.equal(p.status, "loaded", p.error);
  assert.equal(p.config_schema.properties.auto_on_publish.type, "boolean");
  assert.equal(p.config.auto_on_publish, false);
  const ui = await api(base, "GET", "/api/v1/plugins/ui");
  assert.ok(ui.data.artifact_tabs.some((t) => t.plugin === "review-assistant" && t.id === "review"), JSON.stringify(ui.data));
});

test("run: reviewers in parallel, error statuses, timeout kills the process, the judge merges findings, secrets do not leak", async () => {
  const { run } = await runReview({ cookie: rita.cookie });
  assert.equal(run.status, "done", JSON.stringify(run));
  assert.equal(run.artifact.name, "stale-notes");
  assert.equal(run.version, "0.1.0");
  const st = Object.fromEntries(run.reviewers.map((r) => [r.id, r]));
  assert.equal(st.strict.status, "ok");
  assert.equal(st.lenient.status, "ok", "a response wrapped by claude -p --output-format json was not parsed");
  assert.equal(st.injection.status, "ok", "JSON in a ```json block was not extracted");
  assert.equal(st.broken.status, "invalid_output");
  assert.equal(st.crash.status, "failed");
  assert.match(st.crash.error, /quota exceeded/);
  assert.equal(st.slow.status, "timeout");
  const pid = Number(readFileSync(join(work, "slow.pid"), "utf8"));
  assert.ok(pid > 0);
  assert.ok(await until(async () => !alive(pid), { timeout: 5000 }), `reviewer process ${pid} is alive after the timeout`);

  const fresh = run.findings.find((f) => f.category === "freshness");
  assert.ok(fresh, JSON.stringify(run.findings));
  assert.equal(fresh.file, SKILL_PATH);
  assert.equal(fresh.line, FRESHNESS_LINE);
  assert.deepEqual([...fresh.reviewers].sort(), ["injection", "lenient", "strict"], "one finding from three reviewers was not merged");
  assert.equal(fresh.agreed, 3);
  assert.equal(fresh.of, 3, "the denominator is the number of successful reviewers");
  assert.equal(fresh.severity, "medium", "severity is the maximum of the merged ones");
  const examples = run.findings.find((f) => f.category === "examples");
  assert.deepEqual(examples.reviewers, ["strict"]);
  assert.equal(examples.agreed, 1);
  assert.ok(run.findings.every((f) => !/ENV LEAK/.test(f.summary)), `the reviewer sees SKILLFORGE_* variables: ${JSON.stringify(run.findings)}`);
  assert.ok(run.findings.every((f) => f.decision === null));
  const sev = { high: 3, medium: 2, low: 1 };
  for (let i = 1; i < run.findings.length; i++) assert.ok(sev[run.findings[i - 1].severity] >= sev[run.findings[i].severity], "sorted by severity");
});

test("access: contributor and anonymous cannot start; unknown artifact → 404; restarting the same version during a run → 409", async () => {
  assert.equal((await api(base, "POST", `${EXT}/runs`, { type: "skill", name: "stale-notes" }, { cookie: alice.cookie })).status, 403);
  assert.equal((await api(base, "POST", `${EXT}/runs`, { type: "skill", name: "stale-notes" })).status, 401);
  assert.equal((await api(base, "POST", `${EXT}/runs`, { type: "skill", name: "nope" }, { cookie: rita.cookie })).status, 404);
  const first = await api(base, "POST", `${EXT}/runs`, { type: "skill", name: "stale-notes" }, { cookie: rita.cookie });
  assert.equal(first.status, 202);
  const second = await api(base, "POST", `${EXT}/runs`, { type: "skill", name: "stale-notes" }, { cookie: rita.cookie });
  assert.equal(second.status, 409, JSON.stringify(second.data));
  await until(async () => ["done", "failed"].includes((await api(base, "GET", `${EXT}/runs/${first.data.run.id}`, undefined, { cookie: rita.cookie })).data.run?.status));
});

test("decision on a finding: fix | verify | defer | reject — reviewer+ only, with a note; version evidence", async () => {
  const runs = await api(base, "GET", `${EXT}/artifacts/skill/stale-notes/runs`, undefined, { cookie: rita.cookie });
  assert.equal(runs.status, 200);
  const latest = runs.data.items[0];
  const { run } = (await api(base, "GET", `${EXT}/runs/${latest.id}`, undefined, { cookie: rita.cookie })).data;
  const f = run.findings.find((x) => x.category === "freshness");
  assert.equal((await api(base, "POST", `${EXT}/findings/${f.id}/decision`, { decision: "defer", note: "after the release" }, { cookie: alice.cookie })).status, 403);
  assert.equal((await api(base, "POST", `${EXT}/findings/${f.id}/decision`, { decision: "maybe" }, { cookie: rita.cookie })).status, 422);
  assert.equal((await api(base, "POST", `${EXT}/findings/${f.id}/decision`, { decision: "fix", note: "x".repeat(501) }, { cookie: rita.cookie })).status, 422);
  const ok = await api(base, "POST", `${EXT}/findings/${f.id}/decision`, { decision: "defer", note: "after the release" }, { cookie: rita.cookie });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.finding.decision, "defer");
  assert.equal(ok.data.finding.decided_by, "rita");
  assert.equal(ok.data.finding.decision_note, "after the release");
  assert.equal((await api(base, "POST", `${EXT}/findings/999999/decision`, { decision: "fix" }, { cookie: rita.cookie })).status, 404);

  const ver = await api(base, "GET", "/api/v1/artifacts/skill/stale-notes/versions/0.1.0");
  const ev = ver.data.evidence.filter((e) => e.kind === "review");
  assert.ok(ev.some((e) => e.url === `${EXT}/runs/${run.id}`), JSON.stringify(ver.data.evidence));
  assert.equal(new Set(ev.map((e) => e.url)).size, ev.length, "evidence is not duplicated by url");
});

test("Review tab: summary, findings with agreement, markdown escaping, actions only for a reviewer", async () => {
  const tab = (auth) => api(base, "GET", "/api/v1/plugins/ui/tabs/review-assistant/review/skill/stale-notes", undefined, auth);
  const r = await tab({ cookie: rita.cookie });
  assert.equal(r.status, 200);
  const text = [r.data.markdown, ...(r.data.sections ?? []).map((s) => s.markdown)].join("\n");
  assert.match(text, /3\/3/);
  assert.match(text, /freshness/);
  assert.match(text, /defer/i, "the decision on the finding is shown");
  assert.ok(!text.includes("![pixel]"), "an image from the finding is not escaped (leaks the reader's address)");
  assert.ok(!text.includes("<script>"), "HTML from the finding is not escaped");
  assert.ok(!text.includes("](javascript:"), "a link from the finding is not escaped");
  assert.ok(text.includes("evil.test"), "the finding text is preserved (only escaped)");
  const findingSections = (r.data.sections ?? []).filter((s) => s.actions?.some((a) => a.path.includes("/decision")));
  assert.ok(findingSections.length >= 3, JSON.stringify(r.data.sections));
  for (const s of findingSections) {
    const decisions = s.actions.map((a) => a.body?.decision).sort();
    assert.deepEqual(decisions, ["defer", "fix", "reject", "verify"], JSON.stringify(s.actions));
    for (const a of s.actions) assert.match(a.path, /^\/findings\/\d+\/decision$/);
  }
  assert.ok(r.data.actions?.some((a) => a.path === "/runs" && a.body?.type === "skill" && a.body?.name === "stale-notes"), "review start button");

  const a = await tab({ cookie: alice.cookie });
  assert.equal(a.status, 200);
  assert.ok(!(a.data.actions ?? []).length && (a.data.sections ?? []).every((s) => !(s.actions ?? []).length), "contributor sees actions");
});

test("auto_on_publish: a new version starts a run by itself", async () => {
  const patch = await api(base, "PATCH", "/api/v1/admin/plugins/review-assistant", { config: { auto_on_publish: true } }, { cookie: admin.cookie });
  assert.equal(patch.status, 200, JSON.stringify(patch.data));
  await publishSkill("0.2.0");
  const run = await until(async () => {
    const r = await api(base, "GET", `${EXT}/artifacts/skill/stale-notes/runs`, undefined, { cookie: rita.cookie });
    return r.data.items.find((x) => x.version === "0.2.0" && x.status === "done");
  });
  assert.ok(run, "no run appeared for 0.2.0");
});

test("command judge: merges in its own way; when the judge fails — built-in merging and a mark", async () => {
  writeReviewers({ reviewers: baseReviewers().filter((r) => r.id !== "slow"), judge: { command: [process.execPath, JUDGE], timeout_s: 20 } });
  const { run } = await runReview({ cookie: rita.cookie }, { type: "skill", name: "stale-notes", version: "0.1.0" });
  assert.equal(run.status, "done");
  assert.equal(run.judge.status, "ok", JSON.stringify(run.judge));
  assert.ok(run.findings.length >= 2 && run.findings.every((f) => f.summary.startsWith("JUDGE:")), JSON.stringify(run.findings));
  assert.equal(run.findings.filter((f) => f.category === "freshness").length, 1);

  writeReviewers({ reviewers: baseReviewers().filter((r) => r.id !== "slow"), judge: { command: [process.execPath, JUDGE, "--fail"], timeout_s: 20 } });
  const fb = (await runReview({ cookie: rita.cookie }, { type: "skill", name: "stale-notes", version: "0.1.0" })).run;
  assert.equal(fb.status, "done");
  assert.equal(fb.judge.status, "failed");
  assert.match(fb.judge.error, /judge unavailable/);
  assert.ok(fb.findings.some((f) => f.category === "freshness" && f.agreed === 3), "no built-in merging when the judge fails");

  writeReviewers({ reviewers: [] });
  const none = await api(base, "POST", `${EXT}/runs`, { type: "skill", name: "stale-notes" }, { cookie: rita.cookie });
  assert.equal(none.status, 503, JSON.stringify(none.data));
});

test("platform contract (actions fixture): user in a tab, sections with actions, POST of an action, addEvidence without duplicates", async () => {
  const tab = (auth) => api(base, "GET", "/api/v1/plugins/ui/tabs/actions/todo/skill/stale-notes", undefined, auth);
  const anon = await tab();
  assert.equal(anon.status, 200);
  assert.match(anon.data.markdown, /viewer: anonymous/);
  assert.ok(anon.data.sections.every((s) => s.actions.length === 0));
  const al = await tab({ cookie: alice.cookie });
  assert.match(al.data.markdown, /viewer: alice \(contributor\)/);
  const ri = await tab({ cookie: rita.cookie });
  assert.deepEqual(ri.data.sections[0].actions, [{ id: "t1-tick", label: "Tick T1", path: "/tick/t1", body: { step: 1 } }]);
  assert.equal(ri.data.sections[1].actions[1].confirm, "Add ten?");

  assert.equal((await api(base, "POST", "/api/v1/ext/actions/tick/t1", { step: 1 }, { cookie: alice.cookie })).status, 403);
  const t = await api(base, "POST", "/api/v1/ext/actions/tick/t1", { step: 1 }, { cookie: rita.cookie });
  assert.equal(t.status, 200);
  assert.equal(t.data.n, 1);
  assert.match((await tab({ cookie: rita.cookie })).data.sections[0].markdown, /ticked 1 times/);

  for (let i = 0; i < 2; i++) {
    const e = await api(base, "POST", "/api/v1/ext/actions/evidence/skill/stale-notes/0.1.0", { kind: "test", url: "https://ci.example/run/1" }, { cookie: rita.cookie });
    assert.equal(e.status, 200, JSON.stringify(e.data));
  }
  const ver = await api(base, "GET", "/api/v1/artifacts/skill/stale-notes/versions/0.1.0");
  assert.equal(ver.data.evidence.filter((e) => e.url === "https://ci.example/run/1").length, 1);
});
