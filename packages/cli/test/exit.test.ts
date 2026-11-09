import { test } from "node:test";
import assert from "node:assert/strict";
import { EXIT, exitFromHttpStatus } from "../src/exit.ts";

test("exitFromHttpStatus mapping", () => {
  assert.equal(exitFromHttpStatus(401), EXIT.UNAUTHORIZED);
  assert.equal(exitFromHttpStatus(403), EXIT.UNAUTHORIZED);
  assert.equal(exitFromHttpStatus(404), EXIT.NOT_FOUND);
  assert.equal(exitFromHttpStatus(409), EXIT.CONFLICT);
  assert.equal(exitFromHttpStatus(400), EXIT.VALIDATION);
  assert.equal(exitFromHttpStatus(422), EXIT.VALIDATION);
  assert.equal(exitFromHttpStatus(200), EXIT.OK);
});
