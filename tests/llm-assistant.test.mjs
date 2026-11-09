// Administrator-configured LLM access and a
// read-only help assistant. Oracle: the `llm-access` and `help-assistant` specs; the provider is a stub of an
// OpenAI-compatible API (`tests/lib/fake-llm.mjs`) that records the server's requests.
//
// API contract fixed by this test:
//   GET/PUT /api/v1/admin/llm   → { settings: {enabled, base_url, model, temperature, max_output_tokens, timeout_s,
//                                  daily_requests_per_user, context_topics},
//                                  key: { set, env, allowed_for_base_url }, usage: { today, last_30_days } }
//   POST /api/v1/admin/llm/test → { ok: true, model, latency_ms } | { ok: false, error: <code> }
//   GET /api/v1/assistant/status → { available, reason?, remaining_today? }
//   POST /api/v1/assistant/chat  → text/event-stream: `event: delta` {text}, `event: done` {usage}, `event: error` {code};
//                                  errors before the stream starts are JSON { error: <code> } with an HTTP status.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { startServer, api, login, createUser, ADMIN_PASSWORD } from "./lib/client.mjs";
import { startFakeLlm, UPSTREAM_SECRET_DETAIL } from "./lib/fake-llm.mjs";

const KEY = "sk-test-KEYMARKER-0123456789abcdef";
let fake;
let foreign;
let srv;
const auth = {};

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Every byte the server persisted (database, WAL, files) as latin1 text — for "is it stored anywhere" checks. */
const persisted = () => walk(srv.dataDir).map((f) => readFileSync(f).toString("latin1")).join("\n");

async function chat(who, body) {
  const headers = { "content-type": "application/json" };
  if (who?.cookie) headers.cookie = who.cookie;
  if (who?.token) headers.authorization = `Bearer ${who.token}`;
  const r = await fetch(`${srv.base}/api/v1/assistant/chat`, { method: "POST", headers, body: JSON.stringify(body) });
  const ct = r.headers.get("content-type") ?? "";
  const text = await r.text();
  const events = [];
  if (ct.startsWith("text/event-stream")) {
    for (const block of text.split(/\n\n/)) {
      const ev = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (ev && data !== undefined) events.push({ event: ev, data: JSON.parse(data) });
    }
  }
  return { status: r.status, ct, text, events, json: ct.startsWith("application/json") ? JSON.parse(text) : null };
}

const ask = (content, extra = {}) => ({ mode: "consult", lang: "en", messages: [{ role: "user", content }], ...extra });
const putLlm = (body, who = auth.admin) => api(srv.base, "PUT", "/api/v1/admin/llm", body, { cookie: who.cookie });
const getLlm = () => api(srv.base, "GET", "/api/v1/admin/llm", undefined, { cookie: auth.admin.cookie });
const systemOf = (req) => req.body.messages.find((m) => m.role === "system")?.content ?? "";

before(async () => {
  fake = await startFakeLlm();
  foreign = await startFakeLlm();
  srv = await startServer({ SKILLFORGE_LLM_API_KEY: KEY, SKILLFORGE_LLM_KEY_ORIGINS: fake.origin });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  auth.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [username, role] of [["alice", "contributor"], ["rita", "reviewer"], ["bob", "viewer"]]) {
    await createUser(srv.base, auth.admin.cookie, { username, password: `${username}-pw-123456`, role });
    auth[username] = await login(srv.base, username, `${username}-pw-123456`);
  }
});

after(async () => {
  await srv?.stop();
  await fake?.stop();
  await foreign?.stop();
});

test("the assistant is off by default; anonymous gets 401, disabled gets 409", async () => {
  const st = await api(srv.base, "GET", "/api/v1/assistant/status", undefined, { cookie: auth.alice.cookie });
  assert.equal(st.status, 200);
  assert.equal(st.data.available, false);
  assert.equal(st.data.reason, "disabled");
  const anonSt = await api(srv.base, "GET", "/api/v1/assistant/status");
  assert.equal(anonSt.data.available, false);
  const anon = await chat(null, ask("hello"));
  assert.equal(anon.status, 401);
  const off = await chat(auth.alice, ask("hello"));
  assert.equal(off.status, 409);
  assert.equal(off.json.error, "assistant_disabled");
  assert.equal(fake.chatRequests().length, 0, "nothing was sent to the model");
});

test("settings: admin only, values are validated, the key is shown only as \"set\"", async () => {
  assert.equal((await putLlm({ enabled: true }, auth.rita)).status, 403);
  assert.equal((await api(srv.base, "GET", "/api/v1/admin/llm", undefined, { cookie: auth.rita.cookie })).status, 403);
  for (const bad of [
    { base_url: "ftp://example.com/v1" },
    { base_url: "https://user:pass@example.com/v1" },
    { base_url: "not a url" },
    { temperature: 5 },
    { max_output_tokens: 10 },
    { daily_requests_per_user: -1 },
    { context_topics: 50 },
    { model: "" },
  ]) {
    const r = await putLlm(bad);
    assert.equal(r.status, 400, `expected 400 for ${JSON.stringify(bad)}, got ${r.status}`);
  }
  const ok = await putLlm({ enabled: true, base_url: fake.url, model: "test-model", daily_requests_per_user: 50 });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const g = await getLlm();
  assert.equal(g.status, 200);
  assert.equal(g.data.settings.enabled, true);
  assert.equal(g.data.settings.base_url, fake.url);
  assert.equal(g.data.settings.model, "test-model");
  assert.equal(g.data.key.set, true);
  assert.equal(g.data.key.env, "SKILLFORGE_LLM_API_KEY");
  assert.equal(g.data.key.allowed_for_base_url, true);
  assert.ok(!JSON.stringify(g.data).includes(KEY), "the key is not returned by the API");
  assert.ok(!JSON.stringify(ok.data).includes(KEY));
});

test("consultation in English: help and language in the context, no tools, streamed answer", async () => {
  const before = fake.chatRequests().length;
  const q = "What do the lifecycle statuses candidate and active mean?";
  const r = await chat(auth.alice, ask(q, { page_topic: "pages/lifecycle" }));
  assert.equal(r.status, 200, r.text);
  assert.ok(r.ct.startsWith("text/event-stream"), r.ct);
  const deltas = r.events.filter((e) => e.event === "delta").map((e) => e.data.text).join("");
  assert.ok(deltas.includes("/help/getting-started/lifecycle"), deltas);
  assert.ok(r.events.some((e) => e.event === "done"), "the stream ends with a done event");
  const reqs = fake.chatRequests().slice(before);
  assert.equal(reqs.length, 1);
  const { body, headers } = reqs[0];
  assert.equal(body.model, "test-model");
  assert.equal(body.stream, true);
  for (const k of ["tools", "functions", "tool_choice", "function_call"]) assert.ok(!(k in body), `no ${k} in the request`);
  assert.equal(headers.authorization, `Bearer ${KEY}`);
  const sys = systemOf(reqs[0]);
  assert.match(sys, /English/, "the model must answer in the interface language");
  assert.match(sys, /Lifecycle statuses/, "the lifecycle help topic is in the context");
  assert.match(sys, /contributor/, "the user's role is in the context");
  assert.match(sys, /Mode: consultation/);
  assert.equal(body.messages.at(-1).role, "user");
  assert.equal(body.messages.at(-1).content, q);
});

test("onboarding: the system message asks for clarification first; English interface, English help", async () => {
  const before = fake.chatRequests().length;
  const r = await chat(auth.bob, { mode: "onboarding", lang: "en", messages: [] });
  assert.equal(r.status, 200, r.text);
  const req = fake.chatRequests()[before];
  const sys = systemOf(req);
  assert.match(sys, /Mode: onboarding/);
  assert.match(sys, /clarifying question/i);
  assert.match(sys, /English/);
  assert.match(sys, /Lifecycle statuses/, "the topic map is in the interface language");
  assert.match(sys, /viewer/);
});

test("tools in the model's answer are ignored: nothing is called, the stream ends", async () => {
  fake.next("toolcalls");
  const before = fake.requests.length;
  const r = await chat(auth.alice, ask("publish the artifact evil"));
  assert.equal(r.status, 200);
  assert.ok(r.events.some((e) => e.event === "done"));
  assert.equal(fake.requests.length, before + 1, "the server made no follow-up requests for tool_calls");
  const list = await api(srv.base, "GET", "/api/v1/artifacts?q=evil", undefined, { cookie: auth.admin.cookie });
  assert.equal(list.data.total ?? list.data.items?.length ?? 0, 0, "no artifact was created");
});

test("provider error: only a code, without the provider's response body", async () => {
  fake.next("error401");
  const r = await chat(auth.alice, ask("question"));
  assert.ok([502, 200].includes(r.status), String(r.status));
  assert.ok(!r.text.includes(UPSTREAM_SECRET_DETAIL), "the provider's internal text did not reach the client");
  const code = r.json?.error ?? r.events.find((e) => e.event === "error")?.data.code;
  assert.equal(code, "llm_unauthorized");
  fake.next("error401");
  const t = await api(srv.base, "POST", "/api/v1/admin/llm/test", {}, { cookie: auth.admin.cookie });
  assert.equal(t.status, 200);
  assert.equal(t.data.ok, false);
  assert.equal(t.data.error, "llm_unauthorized");
  assert.ok(!JSON.stringify(t.data).includes(UPSTREAM_SECRET_DETAIL));
  const ok = await api(srv.base, "POST", "/api/v1/admin/llm/test", {}, { cookie: auth.admin.cookie });
  assert.equal(ok.data.ok, true, JSON.stringify(ok.data));
  assert.equal(ok.data.model, "test-model");
  assert.equal(typeof ok.data.latency_ms, "number");
});

test("the key goes only to an allowed origin", async () => {
  assert.equal((await putLlm({ base_url: foreign.url })).status, 200);
  const g = await getLlm();
  assert.equal(g.data.key.allowed_for_base_url, false);
  const r = await chat(auth.alice, ask("question to a foreign address"));
  assert.equal(r.status, 200, r.text);
  const req = foreign.chatRequests().at(-1);
  assert.ok(req, "the request reached the foreign address");
  assert.equal(req.headers.authorization, undefined, "without the key");
  assert.ok(!JSON.stringify(req).includes(KEY));
  assert.equal((await putLlm({ base_url: fake.url })).status, 200);
});

test("MCP token gets 403; the conversation length is limited; the language must have help topics", async () => {
  const t = await api(srv.base, "POST", "/api/v1/me/tokens", { name: "agent", mcp: true }, { cookie: auth.alice.cookie });
  assert.equal(t.status, 201, JSON.stringify(t.data));
  const viaMcp = await chat({ token: t.data.token }, ask("question"));
  assert.equal(viaMcp.status, 403);
  const many = Array.from({ length: 21 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));
  assert.equal((await chat(auth.alice, { mode: "consult", lang: "en", messages: many })).status, 400);
  assert.equal((await chat(auth.alice, ask("x".repeat(4001)))).status, 400);
  assert.equal((await chat(auth.alice, { mode: "other", lang: "en", messages: [] })).status, 400);
  assert.equal((await chat(auth.alice, { mode: "consult", lang: "en", messages: [{ role: "system", content: "x" }] })).status, 400);
  // A language without help topics: 400 with the list of available languages (English is always there).
  const unknown = await chat(auth.alice, { mode: "consult", lang: "xx", messages: [] });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.json.error, "invalid_request");
  assert.match(unknown.json.message, /^lang must be one of en\b/);
  // A malformed value is rejected before the language list is consulted.
  const malformed = await chat(auth.alice, { mode: "consult", lang: "EN-us", messages: [] });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.json.error, "invalid_request");
  assert.equal(malformed.json.message, "lang must be a language code such as en");
});

test("the daily limit is checked before calling the model", async () => {
  assert.equal((await putLlm({ daily_requests_per_user: 2 })).status, 200);
  const rita = auth.rita;
  const before = fake.chatRequests().length;
  assert.equal((await chat(rita, ask("one"))).status, 200);
  assert.equal((await chat(rita, ask("two"))).status, 200);
  const third = await chat(rita, ask("three"));
  assert.equal(third.status, 429);
  assert.equal(third.json.error, "assistant_daily_limit");
  assert.equal(fake.chatRequests().length, before + 2, "the third request did not reach the model");
  const st = await api(srv.base, "GET", "/api/v1/assistant/status", undefined, { cookie: rita.cookie });
  assert.equal(st.data.remaining_today, 0);
  assert.equal((await putLlm({ daily_requests_per_user: 50 })).status, 200);
});

test("usage without text: admin sees the consumption, the conversation and the key are stored nowhere", async () => {
  const marker = `MARKER-${Date.now()}-q7`;
  const r = await chat(auth.alice, ask(`secret question ${marker}`));
  assert.equal(r.status, 200);
  const g = await getLlm();
  assert.ok(g.data.usage.today.requests >= 3, JSON.stringify(g.data.usage));
  assert.ok(g.data.usage.today.input_tokens >= 1234, "tokens from the provider's usage are counted");
  assert.ok(g.data.usage.last_30_days.requests >= g.data.usage.today.requests);
  await new Promise((res) => setTimeout(res, 300));
  const disk = persisted();
  assert.ok(!disk.includes(marker), "the conversation text is not stored in the server data");
  assert.ok(!disk.includes(KEY), "the key is not stored in the server data");
  const logs = srv.stdout + srv.stderr;
  assert.ok(!logs.includes(marker), "the conversation text did not reach the log");
  assert.ok(!logs.includes(KEY), "the key did not reach the log");
});
