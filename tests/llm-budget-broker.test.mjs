// llm-budget-broker: every model call goes through the Agent Space budget broker on a Unix socket; the budget
// grant is a bearer secret that reaches only the broker header. The broker is tests/lib/fake-llm.mjs listening on a
// socket; the provider address points at a real provider origin that this test never reaches. Unix sockets: not on
// Windows (the server of Agent Space is Linux).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { startServer, api, login, createUser, ADMIN_PASSWORD } from "./lib/client.mjs";
import { startFakeLlm } from "./lib/fake-llm.mjs";

const WIN = process.platform === "win32";
const KEY = "sk-test-KEYMARKER-broker-0123456789";
const GRANT = `as_sf_${"G".repeat(20)}rantMarker${"x".repeat(13)}`;
const PROVIDER = "https://api.deepseek.com/v1";
let work;
let broker;
let srv;
let plain;
const auth = {};

const call = (s, method, path, body, who) => api(s.base, method, path, body, who ? { cookie: who.cookie } : {});

async function chat(s, who, extra = {}) {
  const r = await fetch(`${s.base}/api/v1/assistant/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: who.cookie },
    body: JSON.stringify({ mode: "consult", lang: "en", messages: [{ role: "user", content: "What is a candidate?" }], ...extra }),
  });
  return { status: r.status, text: await r.text() };
}

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

before(async () => {
  if (WIN) return;
  work = mkdtempSync(join(tmpdir(), "skillforge-broker-"));
  broker = await startFakeLlm({ socket: join(work, "broker.sock") });
  srv = await startServer(
    {
      SKILLFORGE_BUDGET_SOCKET: join(work, "broker.sock"),
      SKILLFORGE_LLM_API_KEY: KEY,
      SKILLFORGE_LLM_KEY_ORIGINS: "https://api.deepseek.com",
    },
    { prefix: "skillforge-broker-srv-" },
  );
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  auth.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  await createUser(srv.base, auth.admin.cookie, { username: "alice", password: "alice-pw-123456", role: "contributor" });
  auth.alice = await login(srv.base, "alice", "alice-pw-123456");
  const put = await call(srv, "PUT", "/api/v1/admin/llm", { enabled: true, base_url: PROVIDER, model: "deepseek-chat" }, auth.admin);
  assert.equal(put.status, 200, JSON.stringify(put.data));
});

after(async () => {
  await srv?.stop();
  await plain?.stop();
  await broker?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("the broker is reported: key managed by the broker, the assistant offers the grant field", { skip: WIN && "Unix sockets" }, async () => {
  const admin = await call(srv, "GET", "/api/v1/admin/llm", undefined, auth.admin);
  assert.equal(admin.data.key.managed, true);
  const status = await call(srv, "GET", "/api/v1/assistant/status", undefined, auth.alice);
  assert.equal(status.data.available, true);
  assert.equal(status.data.budget_grant, true);
});

test("a chat goes to the broker with the provider and the grant, never with the key", { skip: WIN && "Unix sockets" }, async () => {
  const before = broker.chatRequests().length;
  const r = await chat(srv, auth.alice, { budget_grant: GRANT });
  assert.equal(r.status, 200, r.text);
  assert.match(r.text, /event: done/);
  const reqs = broker.chatRequests().slice(before);
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0].path, "/v1/chat/completions");
  assert.equal(reqs[0].headers["x-agent-space-provider"], "deepseek");
  assert.equal(reqs[0].headers["x-agent-space-grant"], GRANT);
  assert.equal(reqs[0].headers.authorization, undefined);
  assert.ok(!JSON.stringify(reqs[0]).includes(KEY), "the provider key reached the broker");
  assert.ok(!JSON.stringify(reqs[0].body).includes(GRANT), "the grant got into the model request body");
});

test("a chat without a grant goes to the broker without the grant header", { skip: WIN && "Unix sockets" }, async () => {
  const before = broker.chatRequests().length;
  const r = await chat(srv, auth.alice);
  assert.equal(r.status, 200, r.text);
  const [req] = broker.chatRequests().slice(before);
  assert.equal(req.headers["x-agent-space-grant"], undefined);
  assert.equal(req.headers["x-agent-space-provider"], "deepseek");
});

test("a malformed grant is refused before the model", { skip: WIN && "Unix sockets" }, async () => {
  const before = broker.chatRequests().length;
  for (const bad of ["abc", `as_sf_${"x".repeat(42)}`, `as_sf_${"x".repeat(43)}.extra`, 42]) {
    const r = await chat(srv, auth.alice, { budget_grant: bad });
    assert.equal(r.status, 400, `${bad}: ${r.text}`);
  }
  assert.equal(broker.chatRequests().length, before);
});

test("an address outside the provider table is refused without any request", { skip: WIN && "Unix sockets" }, async () => {
  const before = broker.chatRequests().length;
  assert.equal((await call(srv, "PUT", "/api/v1/admin/llm", { base_url: "https://example.com/v1" }, auth.admin)).status, 200);
  const t = await call(srv, "POST", "/api/v1/admin/llm/test", {}, auth.admin);
  assert.equal(t.data.ok, false);
  assert.equal(t.data.error, "llm_upstream_error");
  assert.equal(broker.chatRequests().length, before);
  for (const [url, provider] of [
    ["https://api.openai.com/v1", "openai"],
    ["https://generativelanguage.googleapis.com/v1beta/openai", "gemini"],
    ["https://api.deepseek.com", "deepseek"],
  ]) {
    assert.equal((await call(srv, "PUT", "/api/v1/admin/llm", { base_url: url }, auth.admin)).status, 200);
    const n = broker.chatRequests().length;
    assert.equal((await call(srv, "POST", "/api/v1/admin/llm/test", {}, auth.admin)).data.ok, true, url);
    assert.equal(broker.chatRequests()[n].headers["x-agent-space-provider"], provider, url);
  }
  assert.equal((await call(srv, "PUT", "/api/v1/admin/llm", { base_url: PROVIDER }, auth.admin)).status, 200);
});

test("the grant leaves no trace: database, API answers and server log", { skip: WIN && "Unix sockets" }, async () => {
  const db = new DatabaseSync(join(srv.dataDir, "skillforge.db"), { readOnly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
  for (const t of tables) {
    const rows = JSON.stringify(db.prepare(`SELECT * FROM "${t}"`).all());
    assert.ok(!rows.includes(GRANT), `table ${t} holds the grant`);
  }
  db.close();
  for (const f of walk(srv.dataDir).filter((p) => !p.endsWith(".db") && !p.endsWith("-wal") && !p.endsWith("-shm"))) {
    assert.ok(!readFileSync(f, "utf8").includes(GRANT), `${f} holds the grant`);
  }
  assert.ok(!srv.stdout.includes(GRANT) && !srv.stderr.includes(GRANT), "the server log holds the grant");
  const admin = await call(srv, "GET", "/api/v1/admin/llm", undefined, auth.admin);
  assert.ok(!JSON.stringify(admin.data).includes(GRANT));
});

test("a closed broker socket is an upstream error, with no direct provider call", { skip: WIN && "Unix sockets" }, async () => {
  await broker.stop();
  const r = await chat(srv, auth.alice, { budget_grant: GRANT });
  assert.equal(r.status, 502, r.text);
  assert.match(r.text, /llm_upstream_error/);
});

test("without a broker a grant is refused and the field is not offered", { skip: WIN && "Unix sockets" }, async () => {
  const provider = await startFakeLlm();
  plain = await startServer({ SKILLFORGE_LLM_API_KEY: KEY, SKILLFORGE_LLM_KEY_ORIGINS: provider.origin }, { prefix: "skillforge-broker-plain-" });
  try {
    assert.ok(plain.up, plain.stderr);
    const admin = await login(plain.base, "admin", ADMIN_PASSWORD);
    await call(plain, "PUT", "/api/v1/admin/llm", { enabled: true, base_url: provider.url, model: "m1" }, admin);
    assert.equal((await call(plain, "GET", "/api/v1/admin/llm", undefined, admin)).data.key.managed, false);
    assert.notEqual((await call(plain, "GET", "/api/v1/assistant/status", undefined, admin)).data.budget_grant, true);
    const before = provider.chatRequests().length;
    const r = await chat(plain, admin, { budget_grant: GRANT });
    assert.equal(r.status, 400, r.text);
    assert.match(r.text, /budget_grant_unsupported/);
    assert.equal(provider.chatRequests().length, before);
    const ok = await chat(plain, admin);
    assert.equal(ok.status, 200, ok.text);
    assert.equal(provider.chatRequests().at(-1).headers.authorization, `Bearer ${KEY}`);
  } finally {
    await provider.stop();
  }
});

test("a relative socket path stops the start, naming the variable", { skip: WIN && "Unix sockets" }, async () => {
  for (const bad of ["relative/broker.sock", "./broker.sock"]) {
    const s = await startServer({ SKILLFORGE_BUDGET_SOCKET: bad }, { prefix: "skillforge-broker-bad-" });
    if (s.up) await s.stop();
    assert.equal(s.up, false, `started with ${JSON.stringify(bad)}`);
    assert.match(s.stderr + s.stdout, /SKILLFORGE_BUDGET_SOCKET/);
  }
});
