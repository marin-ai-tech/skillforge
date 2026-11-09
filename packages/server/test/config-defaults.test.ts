import { test } from "node:test";
import assert from "node:assert/strict";
import { withApp, loginCookie } from "./helpers.ts";

// fix-config-ldap-default (#116, #119): a partial config (tests, older buildApp callers) gets every field it needs
// from CONFIG_DEFAULTS; a missing list default used to crash provider routes with 500.

test("partial configuration: provider list and LDAP login with an unknown id without 500", async () => {
  await withApp(async (app) => {
    const providers = await app.inject({ method: "GET", url: "/api/v1/auth/providers" });
    assert.equal(providers.statusCode, 200, providers.body);
    const ldap = await app.inject({
      method: "POST",
      url: "/api/v1/auth/ldap/x/login",
      payload: { username: "a", password: "b" },
    });
    assert.equal(ldap.statusCode, 404, ldap.body);
  });
});

/** GET routes without path parameters, from Fastify's own route tree (same parser idea as mcp-token-routes). */
function plainGetRoutes(tree: string): string[] {
  const out: string[] = [];
  const stack: string[] = [];
  for (const line of tree.split("\n")) {
    const m = /^(.*?)[├└]── (\S+)(?: \(([^)]*)\))?$/.exec(line);
    if (!m) continue;
    const depth = m[1]!.length / 4;
    const path = (depth > 0 ? (stack[depth - 1] ?? "") : "") + m[2]!;
    stack[depth] = path;
    stack.length = depth + 1;
    const methods = (m[3] ?? "").split(",").map((s) => s.trim());
    if (methods.includes("GET") && path.startsWith("/api/") && !/[:*]/.test(path)) out.push(path);
  }
  return out;
}

test("partial configuration: no parameterless GET /api/* responds 500 (the field-without-a-default class)", async () => {
  await withApp(async (app) => {
    const cookie = await loginCookie(app);
    await app.ready();
    const paths = plainGetRoutes(app.printRoutes({ commonPrefix: false }));
    assert.ok(paths.length > 30, `too few routes: ${paths.length}`);
    const broken: string[] = [];
    for (const url of paths) {
      const res = await app.inject({ method: "GET", url, headers: { cookie } });
      if (res.statusCode >= 500)
        broken.push(`${url} → ${res.statusCode} ${res.body.slice(0, 120)}`);
    }
    assert.deepEqual(broken, []);
  });
});
