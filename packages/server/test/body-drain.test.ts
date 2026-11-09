import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect } from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import { OVERSIZED_BODY_DRAIN_MAX_BYTES, registerOversizedBodyDrain } from "../src/body-drain.ts";

// For a body larger than bodyLimit the server answers 413 only after it has read the declared body,
// otherwise closing the socket with unread data gives the client ECONNRESET instead of 413.
const LIMIT = 1024;
let app: FastifyInstance;
let port: number;

before(async () => {
  app = Fastify({ logger: false });
  registerOversizedBodyDrain(app);
  app.post("/small", { bodyLimit: LIMIT }, async () => ({ ok: true }));
  await app.listen({ host: "127.0.0.1", port: 0 });
  port = (app.server.address() as { port: number }).port;
});

after(async () => {
  await app.close();
});

type Outcome = {
  status: string;
  respondedAt: number;
  restWrittenAt: number | null;
  error: string | null;
};

/** Sends the headers and the first 512 bytes of the body, the rest after pauseMs; records when the response arrived. */
function postInTwoParts(declared: number, pauseMs: number): Promise<Outcome> {
  return new Promise((resolve) => {
    const s = connect(port, "127.0.0.1");
    const t0 = Date.now();
    const out: Outcome = { status: "", respondedAt: -1, restWrittenAt: null, error: null };
    s.on("connect", () => {
      s.write(
        `POST /small HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: ${declared}\r\n\r\n` +
          "a".repeat(512),
      );
      setTimeout(() => {
        if (s.destroyed) return;
        s.write("a".repeat(declared - 512), () => {
          out.restWrittenAt = Date.now() - t0;
        });
      }, pauseMs);
    });
    s.on("data", (d) => {
      if (out.respondedAt < 0) {
        out.respondedAt = Date.now() - t0;
        out.status = d.toString().split("\r\n")[0] ?? "";
      }
    });
    s.on("error", (e: NodeJS.ErrnoException) => {
      out.error = e.code ?? e.message;
    });
    s.on("close", () => resolve(out));
  });
}

test("body larger than bodyLimit: 413 arrives after the declared body is read, without a connection reset", async () => {
  const r = await postInTwoParts(64 * 1024, 300);
  assert.match(r.status, /^HTTP\/1\.1 413 /);
  assert.equal(r.error, null);
  assert.ok(
    r.restWrittenAt !== null,
    "the rest of the body was written before the connection closed",
  );
  assert.ok(r.respondedAt >= 300, `413 sent before the body was received: ${r.respondedAt} ms`);
});

test("body above the drain limit: 413 immediately, as before", async () => {
  const r = await postInTwoParts(OVERSIZED_BODY_DRAIN_MAX_BYTES + 1, 1000);
  assert.match(r.status, /^HTTP\/1\.1 413 /);
  assert.ok(r.respondedAt < 1000, `response waited for the body: ${r.respondedAt} ms`);
});

test("body within bodyLimit is handled as usual", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/small`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ a: 1 }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});
