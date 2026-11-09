// Plugin access to the LLM. The contract is set by fixtures:
// `llm-probe` declares the `llm` capability, `llm-noperm` does not.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { startServer, api, login, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";
import { startFakeLlm } from "./lib/fake-llm.mjs";

const KEY = "sk-test-KEYMARKER-plugin-0123456789";
let fake;
let srv;
let admin;

before(async () => {
  fake = await startFakeLlm({ reply: "probe answer" });
  srv = await startServer(
    {
      SKILLFORGE_LLM_API_KEY: KEY,
      SKILLFORGE_LLM_KEY_ORIGINS: fake.origin,
      SKILLFORGE_PLUGINS_DIR: join(ROOT, "tests", "fixtures", "plugins-llm"),
      SKILLFORGE_BUNDLED_PLUGINS_DIR: "",
    },
    { prefix: "skillforge-plugllm-" },
  );
  assert.ok(srv.up, srv.stderr);
  admin = await login(srv.base, "admin", ADMIN_PASSWORD);
});

after(async () => {
  await srv?.stop();
  await fake?.stop();
});

const call = (method, path, body) => api(srv.base, method, path, body, { cookie: admin.cookie });

test("plugin with the llm capability: status and call without a key; usage is recorded against the purpose", async () => {
  const off = await call("GET", "/api/v1/ext/llm-probe/status");
  assert.equal(off.data.active, false);

  await call("PUT", "/api/v1/admin/llm", { base_url: fake.url, model: "m1", validation_enabled: true });
  const on = await call("GET", "/api/v1/ext/llm-probe/status");
  assert.equal(on.data.active, true);
  assert.equal(on.data.model, "m1");
  assert.ok(Number.isInteger(on.data.remaining_today) || on.data.remaining_today === null);

  const r = await call("POST", "/api/v1/ext/llm-probe/complete", { purpose: "skill_validation" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.text, "probe answer");
  assert.equal(r.data.model, "m1");
  assert.equal(fake.chatRequests().at(-1).headers.authorization, `Bearer ${KEY}`);

  const dump = (await call("GET", "/api/v1/ext/llm-probe/dump")).data;
  assert.ok(!JSON.stringify(dump).includes(KEY), "the plugin sees the key");
  assert.deepEqual(dump.keys.sort(), ["complete", "registerConsumer", "status"]);

  const usage = (await call("GET", "/api/v1/admin/llm")).data.usage;
  assert.equal(usage.tasks.skill_validation.today.requests, 1);
  assert.equal((await call("GET", "/api/v1/admin/llm")).data.validation.consumer_ready, true);
});

test("an unknown purpose is rejected, the model is not called", async () => {
  const n = fake.chatRequests().length;
  const r = await call("POST", "/api/v1/ext/llm-probe/complete", { purpose: "anything_else" });
  assert.equal(r.status, 500);
  assert.match(r.data.message ?? "", /unknown_purpose/);
  assert.equal(fake.chatRequests().length, n);
});

test("a plugin without the llm capability cannot call the model", async () => {
  const n = fake.chatRequests().length;
  const r = await call("POST", "/api/v1/ext/llm-noperm/complete", {});
  assert.equal(r.status, 500);
  assert.match(r.data.message ?? "", /capability "llm"/);
  assert.equal(fake.chatRequests().length, n);
});
