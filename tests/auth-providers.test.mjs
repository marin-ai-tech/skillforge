// Acceptance tests for OIDC login (Authorization Code + PKCE) with the test provider `tests/lib/mock-oidc.mjs`:
// attacks on the login flow, user provisioning and roles, local mode, configuration checks at startup.
// Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, api, login, createUser, loadDir, toB64, FIXTURES, ADMIN_PASSWORD } from "./lib/client.mjs";
import { startMockOidc } from "./lib/mock-oidc.mjs";
import { join } from "node:path";
import { request as httpRequest } from "node:http";

const PUBLIC_URL = "http://skillforge.test";
let idp;
let srv;
let base;
let admin;

const providersEnv = (issuer, extra = {}) =>
  JSON.stringify([
    {
      id: "test-idp",
      label: "Test IdP",
      issuer,
      client_id: "skillforge-test",
      client_secret: "test-secret",
      role_claim: "groups",
      role_map: { "skillforge-admins": "admin", "skillforge-reviewers": "reviewer" },
      ...extra,
    },
  ]);

const cookieOf = (res, name) => new RegExp(`${name}=([^;]+)`).exec(res.headers.get("set-cookie") ?? "")?.[1];

/** Full login through the IdP. Returns intermediate responses; `tamper` alters steps for attacks. */
async function ssoLogin({ next = "/me", provider = "test-idp", tamper = {} } = {}) {
  const start = await fetch(`${base}/api/v1/auth/oidc/${provider}/start?next=${encodeURIComponent(next)}`, { redirect: "manual" });
  if (start.status !== 302) return { start };
  const authUrl = new URL(start.headers.get("location"));
  const oidcCookie = cookieOf(start, "sf_oidc");
  const authorize = await fetch(authUrl, { redirect: "manual" });
  const back = new URL(authorize.headers.get("location"));
  if (tamper.state) back.searchParams.set("state", tamper.state);
  // The return address points at PUBLIC_URL; the test delivers it to the real server port.
  const callbackUrl = `${base}${back.pathname}${back.search}`;
  const headers = tamper.dropCookie ? {} : { cookie: `sf_oidc=${oidcCookie}` };
  const callback = await fetch(callbackUrl, { redirect: "manual", headers });
  return {
    start,
    authUrl,
    oidcCookie,
    callbackUrl,
    callback,
    location: callback.headers.get("location") ?? "",
    session: cookieOf(callback, "sf_session"),
    replay: () => fetch(callbackUrl, { redirect: "manual", headers }),
  };
}

/** GET with an explicit Host header (fetch does not allow overriding it). */
function getWithHost(baseUrl, path, host) {
  const u = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: u.hostname, port: u.port, path, method: "GET", headers: { host } }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end();
  });
}

async function me(session) {
  return api(base, "GET", "/api/v1/me", undefined, { cookie: `sf_session=${session}` });
}

before(async () => {
  idp = await startMockOidc();
  srv = await startServer({ SKILLFORGE_OIDC_PROVIDERS: providersEnv(idp.issuer), SKILLFORGE_PUBLIC_URL: PUBLIC_URL }, { prefix: "skillforge-sso-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
});

after(async () => {
  if (srv?.up) await srv.stop();
  if (idp) await idp.stop();
});

test("provider list: public, without secrets", async () => {
  const r = await api(base, "GET", "/api/v1/auth/providers");
  assert.equal(r.status, 200);
  assert.equal(r.data.mode, "password");
  assert.equal(r.data.password, true);
  assert.deepEqual(r.data.providers, [{ id: "test-idp", label: "Test IdP", type: "oidc" }]);
  assert.ok(!JSON.stringify(r.data).includes("test-secret"), "client secret is not exposed");
});

test("IdP login: PKCE, state, nonce; the user is created with a role from groups; repeat login — same user", async () => {
  const s = await ssoLogin();
  assert.equal(s.start.status, 302);
  assert.equal(`${s.authUrl.origin}${s.authUrl.pathname}`, `${idp.issuer}/authorize`);
  const p = s.authUrl.searchParams;
  assert.equal(p.get("response_type"), "code");
  assert.equal(p.get("client_id"), "skillforge-test");
  assert.equal(p.get("redirect_uri"), `${PUBLIC_URL}/api/v1/auth/oidc/test-idp/callback`);
  assert.match(p.get("scope") ?? "", /\bopenid\b/);
  assert.equal(p.get("code_challenge_method"), "S256");
  assert.ok((p.get("code_challenge") ?? "").length >= 43);
  assert.ok((p.get("state") ?? "").length >= 32, "state is at least 32 characters");
  assert.ok((p.get("nonce") ?? "").length >= 32, "nonce is at least 32 characters");
  assert.ok(s.oidcCookie, "state is bound to the browser by the sf_oidc cookie");
  assert.match(s.start.headers.get("set-cookie") ?? "", /HttpOnly/i);

  assert.equal(s.callback.status, 302, `callback: ${s.callback.status}`);
  assert.equal(s.location, "/me");
  assert.ok(s.session, "session issued after login");
  const u = await me(s.session);
  assert.equal(u.status, 200);
  assert.equal(u.data.user.username, "dana");
  assert.equal(u.data.user.display_name, "Dana Scully");
  assert.equal(u.data.user.role, "reviewer");

  const again = await ssoLogin();
  const u2 = await me(again.session);
  assert.equal(u2.data.user.id, u.data.user.id, "provider identity finds the same user");

  const users = await api(base, "GET", "/api/v1/admin/users", undefined, { cookie: admin.cookie });
  const dana = users.data.items.find((x) => x.username === "dana");
  assert.equal(dana.source, "oidc:test-idp");
  assert.equal(users.data.items.find((x) => x.username === "admin").source, "password");
  const pw = await api(base, "POST", "/api/v1/auth/login", { username: "dana", password: "anything" });
  assert.equal(pw.status, 401, "SSO account has no password");
});

test("role is synced with groups on every login; without a match — default role", async () => {
  idp.user = { ...idp.user, groups: ["skillforge-admins"] };
  let s = await ssoLogin();
  assert.equal((await me(s.session)).data.user.role, "admin");
  idp.user = { ...idp.user, groups: ["unrelated"] };
  s = await ssoLogin();
  assert.equal((await me(s.session)).data.user.role, "viewer");
  idp.user = { ...idp.user, groups: ["skillforge-reviewers"] };
});

test("token attacks: foreign aud, foreign iss, expired, foreign nonce, alg none, foreign key — login rejected", async () => {
  try {
    for (const mode of ["wrong_aud", "wrong_iss", "expired", "bad_nonce", "alg_none", "foreign_key", "alg_mismatch"]) {
      idp.mode = mode;
      const s = await ssoLogin();
      assert.equal(s.callback.status, 302, `${mode}: ${s.callback.status}`);
      assert.equal(s.location, "/login?error=sso_invalid_token", `${mode}: ${s.location}`);
      assert.equal(s.session, undefined, `${mode}: no session issued`);
    }
    idp.mode = "deny";
    const denied = await ssoLogin();
    assert.equal(denied.location, "/login?error=sso_denied");
    assert.equal(denied.session, undefined);
  } finally {
    idp.mode = "ok";
  }
});

test("ES256: a valid token is accepted (signature r||s, EC P-256 key)", async () => {
  try {
    idp.mode = "es256";
    const s = await ssoLogin();
    assert.equal(s.location, "/me", `ES256: ${s.location}`);
    assert.ok(s.session, "ES256 token accepted");
    assert.equal((await me(s.session)).data.user.username, "dana");
  } finally {
    idp.mode = "ok";
  }
});

test("flow attacks: no cookie, tampered state, callback replay — sso_state; unknown provider — 404", async () => {
  const noCookie = await ssoLogin({ tamper: { dropCookie: true } });
  assert.equal(noCookie.location, "/login?error=sso_state");
  assert.equal(noCookie.session, undefined);
  const forged = await ssoLogin({ tamper: { state: "A".repeat(43) } });
  assert.equal(forged.location, "/login?error=sso_state");
  const ok = await ssoLogin();
  assert.ok(ok.session);
  const replay = await ok.replay();
  assert.equal(replay.headers.get("location"), "/login?error=sso_state", "state is single-use");
  assert.equal(cookieOf(replay, "sf_session"), undefined);
  const unknown = await fetch(`${base}/api/v1/auth/oidc/nope/start`, { redirect: "manual" });
  assert.equal(unknown.status, 404);
});

test("open redirect is impossible: next is relative only", async () => {
  for (const [next, expected] of [
    ["//evil.example/x", "/"],
    ["https://evil.example/", "/"],
    ["/\\evil.example", "/"],
    ["/\t/evil.example", "/"],
    ["/\n/evil.example", "/"],
    ["/ok\r\nSet-Cookie: x=1", "/"],
    ["/artifacts?q=pdf", "/artifacts?q=pdf"],
  ]) {
    const s = await ssoLogin({ next });
    assert.equal(s.location, expected, `next=${next}`);
  }
});

test("a disabled user cannot log in; a username matching a password account does not link the accounts", async () => {
  const users = await api(base, "GET", "/api/v1/admin/users", undefined, { cookie: admin.cookie });
  const dana = users.data.items.find((x) => x.username === "dana");
  const off = await api(base, "PATCH", `/api/v1/admin/users/${dana.id}`, { disabled: true }, { cookie: admin.cookie });
  assert.equal(off.status, 200);
  const s = await ssoLogin();
  assert.equal(s.location, "/login?error=sso_account_disabled");
  assert.equal(s.session, undefined);
  await api(base, "PATCH", `/api/v1/admin/users/${dana.id}`, { disabled: false }, { cookie: admin.cookie });

  await createUser(base, admin.cookie, { username: "fox", password: "fox-pw-123", role: "contributor" });
  const saved = idp.user;
  try {
    idp.user = { sub: "idp-user-fox", email: "fox@example.com", email_verified: true, name: "Fox Mulder", preferred_username: "fox", groups: [] };
    const f = await ssoLogin();
    const fu = (await me(f.session)).data.user;
    assert.equal(fu.username, "fox-2", "name is taken — suffix, not account takeover");
    const pwFox = await login(base, "fox", "fox-pw-123");
    assert.notEqual(pwFox.user.id, fu.id);
  } finally {
    idp.user = saved;
  }
});

test("local mode: no login as admin local, loopback Host only, password login disabled", async () => {
  const local = await startServer({ SKILLFORGE_AUTH_MODE: "local" }, { prefix: "skillforge-local-" });
  assert.ok(local.up, local.stderr);
  try {
    const m = await api(local.base, "GET", "/api/v1/me");
    assert.equal(m.status, 200, JSON.stringify(m.data));
    assert.equal(m.data.user.username, "local");
    assert.equal(m.data.user.role, "admin");
    const pub = await api(local.base, "POST", "/api/v1/artifacts", { type: "skill", files: toB64(loadDir(join(FIXTURES, "skill-standard"))) });
    assert.equal(pub.status, 201, JSON.stringify(pub.data));
    assert.equal(pub.data.version.published_by, "local");
    const port = new URL(local.base).port;
    for (const host of ["evil.example", `evil.example:${port}`, `192.168.1.10:${port}`]) {
      const status = await getWithHost(local.base, "/api/v1/me", host);
      assert.equal(status, 421, `Host ${host}: ${status}`);
    }
    assert.equal(await getWithHost(local.base, "/api/v1/me", `localhost:${port}`), 200);
    const pw = await api(local.base, "POST", "/api/v1/auth/login", { username: "admin", password: ADMIN_PASSWORD });
    assert.equal(pw.status, 409);
    assert.equal(pw.data.error, "local_mode");
    const probe = (name) => [{ path: "SKILL.md", content_base64: Buffer.from(`---
name: ${name}
description: CSRF probe ${name} for local mode checks. Use when testing.
---

Body.
`).toString("base64") }];
    const csrf = await api(local.base, "POST", "/api/v1/artifacts", { type: "skill", files: probe("csrf-probe") }, {}, { origin: "https://evil.example" });
    assert.equal(csrf.status, 403, `foreign Origin in local mode: ${csrf.status} ${JSON.stringify(csrf.data)}`);
    assert.equal(csrf.data.error, "cross_origin");
    const same = await api(local.base, "POST", "/api/v1/artifacts", { type: "skill", files: probe("same-origin-probe") }, {}, { origin: local.base });
    assert.equal(same.status, 201, `own Origin: ${same.status} ${JSON.stringify(same.data)}`);
    const prov = await api(local.base, "GET", "/api/v1/auth/providers");
    assert.equal(prov.data.mode, "local");
  } finally {
    await local.stop();
  }
});

test("configuration errors stop startup naming the variable; the Google preset appears in the list", async () => {
  const cases = [
    [{ SKILLFORGE_AUTH_MODE: "local", SKILLFORGE_HOST: "0.0.0.0" }, "SKILLFORGE_AUTH_MODE"],
    [{ SKILLFORGE_OIDC_PROVIDERS: providersEnv(idp.issuer) }, "SKILLFORGE_PUBLIC_URL"],
    [{ SKILLFORGE_OIDC_PROVIDERS: "{not json", SKILLFORGE_PUBLIC_URL: PUBLIC_URL }, "SKILLFORGE_OIDC_PROVIDERS"],
    [{ SKILLFORGE_OIDC_PROVIDERS: providersEnv(idp.issuer, { id: "Bad Id" }), SKILLFORGE_PUBLIC_URL: PUBLIC_URL }, "SKILLFORGE_OIDC_PROVIDERS"],
  ];
  for (const [env, variable] of cases) {
    const s = await startServer(env, { prefix: "skillforge-badcfg-" });
    if (s.up) await s.stop();
    assert.equal(s.up, false, `${JSON.stringify(env)}: server must not start`);
    assert.notEqual(s.exitCode, 0);
    assert.ok(s.stderr.includes(variable), `${variable} is not named in the error: ${s.stderr}`);
  }
  const https = await startServer({ SKILLFORGE_OIDC_PROVIDERS: providersEnv(idp.issuer), SKILLFORGE_PUBLIC_URL: "https://skillforge.example" }, { prefix: "skillforge-https-" });
  assert.ok(https.up, https.stderr);
  try {
    const st = await fetch(`${https.base}/api/v1/auth/oidc/test-idp/start`, { redirect: "manual" });
    assert.match(st.headers.get("set-cookie") ?? "", /;\s*Secure/i, "with https SKILLFORGE_PUBLIC_URL the cookie is marked Secure");
  } finally {
    await https.stop();
  }
  const g = await startServer(
    { SKILLFORGE_GOOGLE_CLIENT_ID: "g-client.apps.googleusercontent.com", SKILLFORGE_GOOGLE_CLIENT_SECRET: "g-secret", SKILLFORGE_PUBLIC_URL: PUBLIC_URL },
    { prefix: "skillforge-google-" },
  );
  assert.ok(g.up, g.stderr);
  try {
    const r = await api(g.base, "GET", "/api/v1/auth/providers");
    assert.deepEqual(r.data.providers, [{ id: "google", label: "Google", type: "oidc" }]);
    assert.ok(!JSON.stringify(r.data).includes("g-secret"));
  } finally {
    await g.stop();
  }
});
