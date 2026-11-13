// llm-budget-broker: the LLM client talks to the Agent Space budget broker over a Unix socket and never falls back to
// the provider; the provider table and the socket setting are parsed in one place.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { streamChat } from "../src/llm/client.ts";
import { brokerProvider, isBudgetGrant } from "../src/llm/broker.ts";
import { DEFAULT_LLM_SETTINGS } from "../src/llm/settings.ts";
import { ConfigError, parseBudgetSocket } from "../src/config.ts";
import type { AppConfig } from "../src/config.ts";

const GRANT = `as_sf_${"x".repeat(43)}`;

test("the provider table: three origins, nothing else", () => {
  assert.equal(brokerProvider("https://api.deepseek.com"), "deepseek");
  assert.equal(brokerProvider("https://api.deepseek.com/v1"), "deepseek");
  assert.equal(brokerProvider("https://api.deepseek.com/v1/"), "deepseek");
  assert.equal(brokerProvider("https://api.openai.com/v1"), "openai");
  assert.equal(brokerProvider("https://generativelanguage.googleapis.com/v1beta/openai"), "gemini");
  for (const bad of [
    "https://api.openai.com",
    "http://api.deepseek.com/v1",
    "https://user:pw@api.deepseek.com/v1",
    "https://api.deepseek.com/v1?x=1",
    "https://api.deepseek.com/v1#a",
    "https://example.com/v1",
    "not a url",
  ]) {
    assert.equal(brokerProvider(bad), null, bad);
  }
});

test("the grant format", () => {
  assert.equal(isBudgetGrant(GRANT), true);
  for (const bad of [
    "",
    "as_sf_",
    `as_sf_${"x".repeat(42)}`,
    `as_sf_${"x".repeat(44)}`,
    `${GRANT}.id`,
    `as_sf_${"!".repeat(43)}`,
    42,
  ]) {
    assert.equal(isBudgetGrant(bad), false, String(bad));
  }
});

test("SKILLFORGE_BUDGET_SOCKET: empty is off, an absolute path is kept, anything else stops the start", () => {
  assert.equal(parseBudgetSocket(undefined), null);
  assert.equal(parseBudgetSocket(""), null);
  assert.equal(
    parseBudgetSocket("/run/agent-space-budget/model.sock"),
    "/run/agent-space-budget/model.sock",
  );
  for (const bad of ["relative.sock", "./a.sock", "/tmp/a\u0000b"]) {
    assert.throws(
      () => parseBudgetSocket(bad),
      (e: unknown) => e instanceof ConfigError && /SKILLFORGE_BUDGET_SOCKET/.test(String(e)),
    );
  }
});

test(
  "LLM calls go to the budget socket with the provider and the grant, and never fall back",
  { skip: process.platform === "win32" },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "sf-budget-test-"));
    const socket = join(dir, "broker.sock");
    const originalFetch = globalThis.fetch;
    const seen: Array<Record<string, unknown>> = [];
    const server = createServer((req, res) => {
      seen.push({ url: req.url, ...req.headers });
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: {"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\ndata: [DONE]\n\n',
      );
    });
    try {
      await new Promise<void>((resolve) => server.listen(socket, resolve));
      globalThis.fetch = (async () => {
        throw new Error("provider fallback");
      }) as typeof fetch;
      const settings = {
        ...DEFAULT_LLM_SETTINGS,
        enabled: true,
        base_url: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
      };
      const config = {
        llmApiKey: "must-not-leave-process",
        llmKeyOrigins: ["https://api.deepseek.com"],
        budgetSocket: socket,
      } as AppConfig;
      let text = "";
      const call = (grant?: string) =>
        streamChat({
          config,
          settings,
          messages: [{ role: "user", content: "hi" }],
          budgetGrant: grant,
          onDelta: (chunk) => {
            text += chunk;
          },
        });
      assert.deepEqual(await call(GRANT), { input_tokens: 3, output_tokens: 2 });
      assert.equal(text, "ok");
      assert.equal(seen.length, 1);
      assert.equal(seen[0]!.url, "/v1/chat/completions");
      assert.equal(seen[0]!["x-agent-space-provider"], "deepseek");
      assert.equal(seen[0]!["x-agent-space-grant"], GRANT);
      assert.equal(seen[0]!.authorization, undefined);

      // The background form `<grant>.<grant id>` passes through unchanged.
      await call(`${GRANT}.3f1c2a9e-1b2c-4d5e-8f90-123456789abc`);
      assert.equal(
        seen[1]!["x-agent-space-grant"],
        `${GRANT}.3f1c2a9e-1b2c-4d5e-8f90-123456789abc`,
      );

      await assert.rejects(
        streamChat({
          config,
          settings: { ...settings, base_url: "https://example.com/v1" },
          messages: [],
          onDelta: () => undefined,
        }),
        /llm_upstream_error/,
      );
      assert.equal(seen.length, 2, "an address outside the table reached the broker");

      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await assert.rejects(call(GRANT), /llm_upstream_error/);
    } finally {
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      globalThis.fetch = originalFetch;
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("a grant without a broker is refused before any request", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error("must not be called");
  }) as typeof fetch;
  try {
    await assert.rejects(
      streamChat({
        config: { llmApiKey: null, llmKeyOrigins: [], budgetSocket: null } as unknown as AppConfig,
        settings: {
          ...DEFAULT_LLM_SETTINGS,
          enabled: true,
          base_url: "https://api.deepseek.com/v1",
          model: "m",
        },
        messages: [{ role: "user", content: "hi" }],
        budgetGrant: GRANT,
        onDelta: () => undefined,
      }),
      /llm_upstream_error/,
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
