import { test } from "node:test";
import assert from "node:assert/strict";
import { withApp, TEST_ADMIN_PASSWORD } from "./helpers.ts";

async function medianMs(samples: number[]): Promise<number> {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

test("login unknown user timing comparable to wrong password", async () => {
  await withApp(async (app) => {
    const rounds = 4;
    const wrong: number[] = [];
    const unknown: number[] = [];

    // Warm up scrypt / module paths
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "admin", password: "warmup-wrong" },
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "no-such-user-xyz", password: "warmup-wrong" },
    });

    for (let i = 0; i < rounds; i++) {
      const t0 = performance.now();
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { username: "admin", password: `wrong-pw-${i}` },
      });
      wrong.push(performance.now() - t0);
      assert.equal(res.statusCode, 401);
      assert.equal(res.json().error, "invalid_credentials");
    }

    for (let i = 0; i < rounds; i++) {
      const t0 = performance.now();
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { username: `missing-user-${i}`, password: `any-pw-${i}` },
      });
      unknown.push(performance.now() - t0);
      assert.equal(res.statusCode, 401);
      assert.equal(res.json().error, "invalid_credentials");
    }

    const medWrong = await medianMs(wrong);
    const medUnknown = await medianMs(unknown);
    // Both paths run scrypt; allow generous slack for CI jitter but require unknown not to be
    // dramatically faster (would indicate missing dummy verify).
    assert.ok(
      medUnknown >= medWrong * 0.4,
      `unknown login too fast vs wrong password: unknown=${medUnknown.toFixed(1)}ms wrong=${medWrong.toFixed(1)}ms`,
    );
    assert.ok(
      medUnknown <= medWrong * 3.5,
      `unknown login too slow vs wrong password: unknown=${medUnknown.toFixed(1)}ms wrong=${medWrong.toFixed(1)}ms`,
    );

    // Sanity: correct password still works
    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "admin", password: TEST_ADMIN_PASSWORD },
    });
    assert.equal(ok.statusCode, 200);
  });
});
