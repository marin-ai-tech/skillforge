import type { FastifyInstance } from "fastify";
import type { Readable } from "node:stream";

/** A body larger than this is not drained: the connection is closed at once, as before. */
export const OVERSIZED_BODY_DRAIN_MAX_BYTES = 8 * 1024 * 1024;
/** How long to wait for the rest of the body before answering 413 and closing the connection as before. */
export const OVERSIZED_BODY_DRAIN_MAX_MS = 5000;

/**
 * Fastify answers `413` from the `Content-Length` header without reading the body, and closes the connection
 * (`connection: close`, fastify/lib/content-type-parser.js, rawBody). The client is still sending the body at that point:
 * closing a socket with unread data causes an RST, and a client that has not managed to read the answer gets
 * `ECONNRESET` instead of `413`. The hook reads and discards the declared body (within the limits above);
 * after that Fastify sends the same `413` and the connection closes normally. Limits, status and response body do not change.
 */
export function registerOversizedBodyDrain(app: FastifyInstance): void {
  app.addHook("preParsing", async (request, _reply, payload) => {
    const declared = Number(request.headers["content-length"]);
    const limit = request.routeOptions.bodyLimit;
    if (
      !Number.isFinite(declared) ||
      declared <= limit ||
      declared > OVERSIZED_BODY_DRAIN_MAX_BYTES
    ) {
      return payload;
    }
    await discardBody(payload, OVERSIZED_BODY_DRAIN_MAX_MS);
    return payload;
  });
}

function discardBody(stream: Readable, maxMs: number): Promise<void> {
  return new Promise((resolve) => {
    const ignore = (): void => {};
    const finish = (): void => {
      clearTimeout(timer);
      stream.off("data", ignore);
      stream.off("end", finish);
      stream.off("error", finish);
      stream.off("close", finish);
      resolve();
    };
    const timer = setTimeout(finish, maxMs);
    stream.on("data", ignore);
    stream.once("end", finish);
    stream.once("error", finish);
    stream.once("close", finish);
    stream.resume();
  });
}
