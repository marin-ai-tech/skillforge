import { test } from "node:test";
import assert from "node:assert/strict";
import { withApp, loginCookie } from "./helpers.ts";

/**
 * Routes (method + path) from Fastify itself: `printRoutes({ commonPrefix: false })` prints a tree where a child line
 * continues its parent's path. A new route is covered without editing this test (mcp-token-write-deny, #107).
 */
function routesFromTree(tree: string): Array<{ method: string; path: string }> {
  const out: Array<{ method: string; path: string }> = [];
  const stack: string[] = [];
  for (const line of tree.split("\n")) {
    const m = /^(.*?)[├└]── (\S+)(?: \(([^)]*)\))?$/.exec(line);
    if (!m) continue;
    const depth = m[1]!.length / 4;
    const path = (depth > 0 ? (stack[depth - 1] ?? "") : "") + m[2]!;
    stack[depth] = path;
    stack.length = depth + 1;
    for (const method of (m[3] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      out.push({ method, path });
    }
  }
  return out;
}

/** The only /api/* routes an MCP token may call (mcp-token-read-scope, #118). */
const ALLOWED = new Set([
  "GET /api/v1/me",
  "HEAD /api/v1/me",
  "GET /api/v1/health",
  "HEAD /api/v1/health",
]);

test("MCP token: every /api/* route from the Fastify registry except /me and /health answers 403 mcp_token_forbidden", async () => {
  await withApp(async (app) => {
    const cookie = await loginCookie(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/me/tokens",
      headers: { cookie },
      payload: { name: "agent", mcp: true },
    });
    assert.equal(created.statusCode, 201, created.body);
    const token = (created.json() as { token: string }).token;

    await app.ready();
    const routes = routesFromTree(app.printRoutes({ commonPrefix: false })).filter((r) =>
      r.path.startsWith("/api/"),
    );
    const denied = routes.filter((r) => !ALLOWED.has(`${r.method} ${r.path}`));
    assert.ok(denied.length > 60, `too few routes: ${denied.length}`);
    for (const must of [
      "POST /api/v1/artifacts/:type/:name/transitions",
      "GET /api/v1/artifacts",
    ]) {
      assert.ok(
        denied.some((r) => `${r.method} ${r.path}` === must),
        `no route ${must}`,
      );
    }

    const auth = { authorization: `Bearer ${token}` };
    const open: string[] = [];
    for (const r of denied) {
      const url = r.path.replace(/:[^/]+/g, "x").replace(/\*/g, "x");
      const read = r.method === "GET" || r.method === "HEAD";
      const res = await app.inject({
        method: r.method as "POST",
        url,
        headers: read ? auth : { ...auth, "content-type": "application/json" },
        ...(read ? {} : { payload: "{}" }),
      });
      const coded = r.method === "HEAD" || res.body.includes("mcp_token_forbidden");
      if (res.statusCode !== 403 || !coded) open.push(`${r.method} ${r.path} → ${res.statusCode}`);
    }
    assert.deepEqual(open, []);

    for (const path of ["/api/v1/me", "/api/v1/health"]) {
      const res = await app.inject({ method: "GET", url: path, headers: auth });
      assert.equal(res.statusCode, 200, `${path}: ${res.statusCode}`);
    }
  });
});
