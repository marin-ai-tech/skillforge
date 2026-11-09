import { test } from "node:test";
import assert from "node:assert/strict";
import {
  _resetRateLimitForTests,
  clearLoginFailures,
  isRateLimited,
  recordFailedLogin,
} from "../src/auth/ratelimit.ts";

test("11th attempt is rate limited", () => {
  _resetRateLimitForTests();
  const user = "carl-test";
  for (let i = 0; i < 10; i++) recordFailedLogin(user);
  assert.equal(isRateLimited(user), true);
  clearLoginFailures(user);
  assert.equal(isRateLimited(user), false);
});
