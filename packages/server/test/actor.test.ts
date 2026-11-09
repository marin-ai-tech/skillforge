import { test } from "node:test";
import assert from "node:assert/strict";
import { actorFromRequest } from "../src/actor.ts";
import type { FastifyRequest } from "fastify";

function req(user: { username: string } | null): FastifyRequest {
  return { user, headers: { "x-skillforge-actor": "mallory" } } as FastifyRequest;
}

test("actorFromRequest: uses request.user.username and ignores header", () => {
  assert.equal(actorFromRequest(req({ username: "alice" })), "alice");
  assert.equal(actorFromRequest(req(null)), "anonymous");
  assert.equal(actorFromRequest(req({ username: "admin" })), "admin");
});
