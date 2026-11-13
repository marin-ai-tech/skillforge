// Stub of an OpenAI-compatible API for the LLM help assistant tests.
// Records every request (path, headers, body) and answers according to a scenario:
//   "stream"    — an SSE stream of `chat.completion.chunk` with the reply text and the final usage (default);
//   "error401"  — 401 with an internal text in the body (it must not reach the SkillForge client);
//   "toolcalls" — a stream with `delta.tool_calls` (the server must not execute anything);
//   "hang"      — headers are sent, the response never ends (timeout check).
// A scenario is set for the single next request (`next`) or as the default (`scenario`).
// With `socket` the stub listens on that Unix socket path instead of TCP: it then plays the Agent Space budget broker
// (llm-budget-broker), which takes `POST /v1/chat/completions` there.
import http from "node:http";

export const UPSTREAM_SECRET_DETAIL = "upstream-internal-detail-7f3a";
export const DEFAULT_REPLY =
  "Statuses are described in the topic [Lifecycle statuses](/help/getting-started/lifecycle). More: [external site](https://example.com/phish).";

function sse(res, obj) {
  res.write(`data: ${typeof obj === "string" ? obj : JSON.stringify(obj)}\n\n`);
}

function chunk(delta, extra = {}) {
  return { id: "chatcmpl-fake", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }], ...extra };
}

function streamReply(res, text) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  // Split into a few pieces so the client sees several deltas.
  const parts = text.match(/.{1,24}/gsu) ?? [text];
  for (const p of parts) sse(res, chunk({ content: p }));
  sse(res, {
    id: "chatcmpl-fake",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 1234, completion_tokens: 56, total_tokens: 1290 },
  });
  sse(res, "[DONE]");
  res.end();
}

/** Starts the fake on 127.0.0.1 (or on `socket`); returns { url (…/v1), origin, requests, next(scenario), stop() }. */
export async function startFakeLlm({ reply = DEFAULT_REPLY, scenario = "stream", socket } = {}) {
  const requests = [];
  const queue = [];
  let currentReply = reply;
  const hanging = new Set();
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      let body = null;
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
      requests.push({ method: req.method, path: req.url, headers: { ...req.headers }, body });
      const mode = queue.shift() ?? scenario;
      if (!req.url.endsWith("/chat/completions")) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "not found" } }));
        return;
      }
      if (mode === "error401") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: `invalid api key; ${UPSTREAM_SECRET_DETAIL}`, type: "auth" } }));
        return;
      }
      if (mode === "error403") {
        // The Agent Space broker refuses a grant whose task claim is not confirmed (its external port: 403).
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "sdlc_claim_unconfirmed" } }));
        return;
      }
      if (mode === "toolcalls") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        sse(res, chunk({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "publish_artifact", arguments: "{\"name\":\"evil\"}" } }] }));
        sse(res, { id: "chatcmpl-fake", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
        sse(res, "[DONE]");
        res.end();
        return;
      }
      if (mode === "hang") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        sse(res, chunk({ content: "…" }));
        hanging.add(res);
        return;
      }
      streamReply(res, currentReply);
    });
  });
  if (socket) await new Promise((r) => server.listen(socket, r));
  else await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = socket ? `unix:${socket}` : `http://127.0.0.1:${server.address().port}`;
  return {
    url: `${origin}/v1`,
    origin,
    requests,
    /** Reply text for every next request (llm-skill-validation). */
    setReply(text) {
      currentReply = text;
    },
    /** Scenario for the next request only. */
    next(mode) {
      queue.push(mode);
    },
    chatRequests() {
      return requests.filter((r) => r.path.endsWith("/chat/completions"));
    },
    async stop() {
      for (const res of hanging) res.destroy();
      server.closeAllConnections?.();
      if (server.listening) await new Promise((r) => server.close(() => r()));
    },
  };
}
