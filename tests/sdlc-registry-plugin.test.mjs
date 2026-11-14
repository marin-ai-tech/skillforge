// sdlc-registry-plugin: the built-in plugin answers sdlc's team-registry tools on /mcp. The expected answers are built
// here by the rules of the field-test adapter (sdlc 0.32.0), not by the plugin. Negative cases: the plugin is off until
// an admin turns it on; an agent without the sdlc-role tag is not a role; a binary file refuses the skill; an event
// without a known outcome reports nothing; an agent token does not see report_outcome.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

let srv;
let dataDir;
const who = {};
const tokens = {};
const env = () => ({ SKILLFORGE_PLUGINS_DIR: join(dataDir, "no-plugins"), SKILLFORGE_BUNDLED_PLUGINS_DIR: join(ROOT, "plugins") });
const call = (method, path, body, user = who.admin) => api(srv.base, method, path, body, { cookie: user.cookie });
const sha = (text) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
const b64 = (s) => Buffer.from(s).toString("base64");

const ROLE_BODY = "You design the change and record decisions.\n";
const ROLE = `---\nname: architect\ndescription: Designs the change.\ntitle: Architect\nstages: [spec, plan]\nskills: [plan-mode]\ntags: [sdlc-role]\n---\n${ROLE_BODY}`;
const HELPER = `---\nname: helper\ndescription: A helper agent that is not an sdlc role.\n---\nHelp.\n`;
const SKILL = `---\nname: plan-mode\ndescription: Plan before code. Use when a change is planned.\n---\n\n# Plan mode\n\nWrite the plan first.\n`;
const CHECKLIST = "- read the code\n- write the plan\n";
const RULE_BODY = "\nWrite the failing test first.\n";
const RULE = `---\nname: red-test-first\ndescription: A failing test before the fix.\ntags: [testing]\npaths:\n  - "src/**"\n---\n${RULE_BODY}`;

async function rpc(token, method, params) {
  const r = await fetch(`${srv.base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return r.json();
}
const tool = async (name, args = {}, token = tokens.integration) => {
  const r = await rpc(token, "tools/call", { name, arguments: args });
  assert.equal(r.error, undefined, JSON.stringify(r));
  return r.result;
};
async function publish(type, files, extra = {}) {
  const r = await call("POST", "/api/v1/artifacts", { type, files: files.map(([path, text]) => ({ path, content_base64: typeof text === "string" ? b64(text) : text.toString("base64") })), ...extra }, who.alice);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const name = r.data.artifact.name;
  assert.equal((await call("POST", `/api/v1/artifacts/${type}/${name}/transitions`, { to: "active", reason: "fixture" })).status, 200);
  return r.data.version.version;
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "skillforge-sdlc-registry-"));
  srv = await startServer(env(), { dataDir });
  assert.ok(srv.up, srv.stderr);
  who.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  await createUser(srv.base, who.admin.cookie, { username: "alice", password: "alice-pw-123", role: "contributor" });
  who.alice = await login(srv.base, "alice", "alice-pw-123");
});

after(async () => {
  if (srv?.up) await srv.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

test("the built-in plugin is off by default; on after an admin turns it on and the server restarts", async () => {
  const items = (await call("GET", "/api/v1/admin/plugins")).data.items;
  const plugin = items.find((p) => p.name === "sdlc-registry");
  assert.ok(plugin, items.map((p) => p.name).join(", "));
  assert.equal(plugin.status, "disabled");
  assert.equal(items.find((p) => p.name === "review-assistant")?.status, "loaded");
  assert.equal((await call("PATCH", "/api/v1/admin/plugins/sdlc-registry", { enabled: true })).status, 200);
  await srv.stop();
  srv = await startServer(env(), { dataDir });
  assert.ok(srv.up, srv.stderr);
  who.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  who.alice = await login(srv.base, "alice", "alice-pw-123");
  const after = (await call("GET", "/api/v1/admin/plugins")).data.items.find((p) => p.name === "sdlc-registry");
  assert.equal(after.status, "loaded", JSON.stringify(after));
  for (const [name, body] of [["agent", { name: "agent", mcp: true }], ["integration", { name: "sdlc", mcp: true, integration: true }]]) {
    const r = await call("POST", "/api/v1/me/tokens", body, who.alice);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    tokens[name] = r.data.token;
  }
});

test("roles: only agents tagged sdlc-role; fields, body, checksum and marker by the adapter's rules", async () => {
  const version = await publish("agent", [["agents/architect.md", ROLE]]);
  await publish("agent", [["agents/helper.md", HELPER]]);
  const list = (await tool("list_roles")).structuredContent;
  assert.deepEqual(list, { roles: [{ id: "architect", version }] });
  const role = (await tool("get_role", { id: "architect" })).structuredContent;
  assert.deepEqual(role, {
    id: "architect",
    version,
    title: "Architect",
    description: "Designs the change.",
    stages: ["spec", "plan"],
    tools: [],
    readonly: true,
    skills: ["plan-mode"],
    body: ROLE_BODY,
    checksum: sha(ROLE_BODY),
    marker: { key: "skillforge-source", value: `agent/architect@${version}` },
  });
  assert.equal((await tool("get_role", { id: "helper" })).isError, true);
});

test("skills: all files in one answer, paths inside the skill, the sdlc checksum; a binary file refuses the skill", async () => {
  const version = await publish("skill", [["plan-mode/SKILL.md", SKILL], ["plan-mode/references/checklist.md", CHECKLIST]]);
  const skill = (await tool("get_skill", { id: "plan-mode" })).structuredContent;
  const files = [{ path: "SKILL.md", content: SKILL }, { path: "references/checklist.md", content: CHECKLIST }];
  assert.deepEqual(skill, {
    id: "plan-mode",
    version,
    title: "Plan before code. Use when a change is planned.",
    files,
    // the adapter's rule: files sorted by path with localeCompare(…, "en"), then `<path>\n<content>\n` each
    checksum: sha([...files].sort((a, b) => a.path.localeCompare(b.path, "en")).map((f) => `${f.path}\n${f.content}\n`).join("")),
  });
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
  await publish("skill", [["pictures/SKILL.md", SKILL.replaceAll("plan-mode", "pictures")], ["pictures/assets/cover.png", png]]);
  const refused = await tool("get_skill", { id: "pictures" });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /cover\.png/);
});

test("lists are not cut at 50; rules come with tags, paths and checksum", async () => {
  for (let i = 0; i < 53; i++) {
    const name = `bulk-${String(i).padStart(2, "0")}`;
    await publish("skill", [[`${name}/SKILL.md`, SKILL.replaceAll("plan-mode", name)]]);
  }
  const skills = (await tool("list_skills")).structuredContent.skills;
  assert.ok(skills.length >= 55, `${skills.length} skills`);
  const version = await publish("rule", [["rules/red-test-first.md", RULE]]);
  const rules = (await tool("list_rules")).structuredContent.rules;
  assert.deepEqual(rules, [{ id: "red-test-first", version, tags: ["testing"], paths: ["src/**"], checksum: sha(RULE_BODY) }]);
  const rule = (await tool("get_rule", { id: "red-test-first" })).structuredContent;
  assert.equal(rule.body, RULE_BODY);
  assert.deepEqual(rule.paths, ["src/**"]);
});

test("report_outcome: assigned usage for the stage's role skills, safe to repeat; no outcome, no report; hidden from an agent token", async () => {
  const agentList = (await rpc(tokens.agent, "tools/list", {})).result.tools.map((t) => t.name);
  assert.ok(agentList.includes("get_skill") && !agentList.includes("report_outcome"), agentList.join(", "));
  const ev = { event: { id: "e1", event: "gate.spec.approved" } };
  const first = (await tool("report_outcome", ev)).structuredContent;
  assert.deepEqual(first.reported.map((r) => [r.skill, r.helped]), [["plan-mode", 1]]);
  await tool("report_outcome", ev);
  const usage = (await call("GET", "/api/v1/artifacts/skill/plan-mode/usage")).data;
  const assigned = usage.by_source.find((x) => x.basis === "assigned");
  assert.equal(assigned?.uses, 1, JSON.stringify(usage));
  assert.equal(usage.total.uses, 0, "assigned reports stay out of the counters");
  const none = (await tool("report_outcome", { event: { id: "e2", event: "gate.spec.opened" } })).structuredContent;
  assert.deepEqual(none.reported, []);
});
