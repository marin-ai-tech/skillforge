// news-delivery: the MCP tool `list_news` for agent and integration tokens. News about artifacts the token sees over
// MCP — the owner's rights and the token's `mcp_tags` consent; a retired artifact still gives its status change with the
// replacement, so the agent learns what to use instead. Another team's artifact is not news for the token; posts follow
// the audience of the token's owner. Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, api, login, createUser, ADMIN_PASSWORD } from "./lib/client.mjs";

let srv;
let base;
let admin;
let alice;
let mia;
const b64 = (s) => Buffer.from(s).toString("base64");
const skillMd = (name, tag, v) => `---\nname: ${name}\ndescription: Skill ${name} for list_news checks. Use when ${tag} work is asked.\ntags: [${tag}]\n---\n\n# ${name}\n\nVersion ${v}.\n`;

async function publish(name, tag, version, extra = {}) {
  const r = await api(base, "POST", "/api/v1/artifacts", { type: "skill", version, files: [{ path: `${name}/SKILL.md`, content_base64: b64(skillMd(name, tag, version)) }], ...extra }, { cookie: admin.cookie });
  assert.equal(r.status, 201, `${name}@${version}: ${JSON.stringify(r.data)}`);
}
async function move(name, to) {
  const r = await api(base, "POST", `/api/v1/artifacts/skill/${name}/transitions`, { to, reason: "list_news test" }, { cookie: admin.cookie });
  assert.equal(r.status, 200, `${name} → ${to}: ${JSON.stringify(r.data)}`);
}
async function token(user, body) {
  const r = await api(base, "POST", "/api/v1/me/tokens", body, { cookie: user.cookie });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.token;
}
let nextId = 1;
async function rpc(tok, method, params) {
  const r = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${tok}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  const text = await r.text();
  assert.equal(r.status, 200, text);
  return JSON.parse(text);
}
async function listNews(tok, args = {}) {
  const r = await rpc(tok, "tools/call", { name: "list_news", arguments: args });
  assert.equal(r.error, undefined, JSON.stringify(r.error));
  assert.notEqual(r.result.isError, true, JSON.stringify(r.result));
  assert.deepEqual(JSON.parse(r.result.content[0].text), r.result.structuredContent);
  return r.result.structuredContent.items;
}
const names = (items) => items.filter((i) => i.artifact).map((i) => `${i.kind}:${i.artifact.name}`);

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-mcp-news-" });
  assert.ok(srv.up, srv.stderr);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  for (const u of ["alice", "mia"]) await createUser(base, admin.cookie, { username: u, password: `${u}-pw-123456`, role: "contributor" });
  alice = await login(base, "alice", "alice-pw-123456");
  mia = await login(base, "mia", "mia-pw-123456");
  assert.equal((await api(base, "POST", "/api/v1/teams", { name: "payments", lead: "mia" }, { cookie: admin.cookie })).status, 201);

  for (const [name, tag] of [["pay-notes", "payments"], ["search-notes", "search"]]) {
    await publish(name, tag, "1.0.0");
    await move(name, "active");
    await publish(name, tag, "1.1.0");
  }
  await publish("ledger", "payments", "1.0.0", { visibility: "team", owner_team: "payments" });
  await move("ledger", "active");
  await publish("pay-old", "payments", "1.0.0");
  await move("pay-old", "active");
  const rep = await api(base, "PUT", "/api/v1/artifacts/skill/pay-old/replacement", { replaced_by: "skill/pay-notes" }, { cookie: admin.cookie });
  assert.equal(rep.status, 200, JSON.stringify(rep.data));
  await move("pay-old", "retired");
  await publish("pay-candidate", "payments", "1.0.0");
  const p = await api(base, "POST", "/api/v1/news/posts", { title: "Payments freeze", body: "No releases on Friday.", team: "payments" }, { cookie: admin.cookie });
  assert.equal(p.status, 201, JSON.stringify(p.data));
});

after(async () => {
  if (srv?.up) await srv.stop();
});

test("tools/list offers list_news to an agent token", async () => {
  const tok = await token(alice, { name: "agent", mcp: true });
  const list = await rpc(tok, "tools/list", {});
  const tool = list.result.tools.find((t) => t.name === "list_news");
  assert.ok(tool, "list_news is not offered");
  for (const arg of ["since", "kinds", "limit"]) assert.ok(arg in tool.inputSchema.properties, `list_news has no ${arg}`);
});

test("the token's mcp_tags consent: only news about artifacts with its tags", async () => {
  const tok = await token(alice, { name: "agent-payments", mcp: true, mcp_tags: ["payments"] });
  const got = names(await listNews(tok, { kinds: ["new_version"] }));
  assert.deepEqual(got, ["new_version:pay-notes"]);
});

test("a retired artifact gives its status change with the replacement; another team's artifact and a candidate give nothing", async () => {
  const tok = await token(alice, { name: "agent-all", mcp: true });
  const items = await listNews(tok);
  const retired = items.find((i) => i.kind === "status_change" && i.artifact?.name === "pay-old");
  assert.ok(retired, `no status change of pay-old: ${JSON.stringify(names(items))}`);
  assert.equal(retired.to, "retired");
  assert.deepEqual(retired.replacement, { type: "skill", name: "pay-notes" });
  assert.equal(typeof retired.url, "string");
  assert.ok(!names(items).some((n) => n.endsWith(":ledger")), "another team's artifact is news for alice's token");
  assert.ok(!names(items).some((n) => n.endsWith(":pay-candidate")), "a candidate is news");
  assert.ok(!items.some((i) => i.post?.title === "Payments freeze"), "a post for another team reaches alice's token");
});

test("posts follow the audience of the token's owner; since and limit bound the answer", async () => {
  const tok = await token(mia, { name: "agent-mia", mcp: true });
  const items = await listNews(tok);
  const freeze = items.find((i) => i.post?.title === "Payments freeze");
  assert.ok(freeze, "mia's team post is missing");
  assert.equal(freeze.post.body, "No releases on Friday.");
  assert.ok(names(items).includes("new_artifact:ledger"), "mia's team artifact is missing");
  assert.equal((await listNews(tok, { limit: 2 })).length, 2);
  assert.deepEqual(await listNews(tok, { since: new Date(Date.now() + 60_000).toISOString() }), []);
});
