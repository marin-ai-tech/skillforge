// Acceptance tests for signing in with a corporate account via LDAP against the test server `tests/lib/mock-ldap.mjs`: user lookup by a service account,
// bind of the found DN, roles by groups, protection against LDAP injection and against an "unauthenticated bind" with an empty password,
// an unreachable server, configuration checks. Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { startServer, api, login, ADMIN_PASSWORD } from "./lib/client.mjs";
import { startMockLdap } from "./lib/mock-ldap.mjs";

const GROUPS = "ou=groups,dc=example,dc=com";
const DIRECTORY = [
  { dn: "cn=svc,dc=example,dc=com", password: "svc-pw", attrs: { cn: ["svc"] } },
  { dn: "uid=erin,ou=people,dc=example,dc=com", password: "erin-pw", attrs: { uid: ["erin"], cn: ["Erin Reyes"], mail: ["erin@example.com"], memberOf: [`cn=skillforge-reviewers,${GROUPS}`] } },
  { dn: "uid=hal,ou=people,dc=example,dc=com", password: "hal-pw", attrs: { uid: ["hal"], cn: ["Hal Emmerich"], mail: ["hal@example.com"], memberOf: [`cn=skillforge-reviewers,${GROUPS}`, `cn=skillforge-admins,${GROUPS}`] } },
  { dn: "uid=ivy,ou=people,dc=example,dc=com", password: "ivy-pw", attrs: { uid: ["ivy"], cn: ["Ivy Valentine"], mail: ["ivy@example.com"] } },
  { dn: "uid=admin,ou=people,dc=example,dc=com", password: "ldap-admin-pw", attrs: { uid: ["admin"], cn: ["Directory Admin"], mail: ["da@example.com"] } },
];

let ldap;
let deadPort;
let srv;
let base;

const provider = (overrides = {}) => ({
  id: "corp",
  label: "Corporate account",
  url: ldap.url,
  bind_dn: "cn=svc,dc=example,dc=com",
  bind_password: "svc-pw",
  user_base: "ou=people,dc=example,dc=com",
  user_filter: "(uid={username})",
  username_attribute: "uid",
  display_name_attribute: "cn",
  email_attribute: "mail",
  group_attribute: "memberOf",
  role_map: { [`cn=skillforge-reviewers,${GROUPS}`]: "reviewer", [`cn=skillforge-admins,${GROUPS}`]: "admin" },
  default_role: "viewer",
  timeout_ms: 2000,
  ...overrides,
});

async function freeClosedPort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

async function ldapLogin(username, password, id = "corp") {
  const r = await api(base, "POST", `/api/v1/auth/ldap/${id}/login`, { username, password });
  const m = /sf_session=([^;]+)/.exec(r.headers.get("set-cookie") ?? "");
  return { ...r, session: m?.[1] };
}
const me = (session) => api(base, "GET", "/api/v1/me", undefined, { cookie: `sf_session=${session}` });

before(async () => {
  ldap = await startMockLdap(DIRECTORY);
  deadPort = await freeClosedPort();
  srv = await startServer(
    {
      SKILLFORGE_LDAP: JSON.stringify([
        provider(),
        provider({ id: "dead", label: "Dead LDAP", url: `ldap://127.0.0.1:${deadPort}` }),
        // A filter matching many entries: the server answers sizeLimitExceeded.
        provider({ id: "wide", label: "Wide LDAP", user_filter: "(|(uid={username})(mail=*@example.com))" }),
      ]),
    },
    { prefix: "skillforge-ldap-" },
  );
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
});

after(async () => {
  if (srv?.up) await srv.stop();
  if (ldap) await ldap.stop();
});

test("the LDAP provider is listed, without secrets and addresses", async () => {
  const r = await api(base, "GET", "/api/v1/auth/providers");
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.data.providers.filter((p) => p.type === "ldap"),
    [
      { id: "corp", label: "Corporate account", type: "ldap" },
      { id: "dead", label: "Dead LDAP", type: "ldap" },
      { id: "wide", label: "Wide LDAP", type: "ldap" },
    ],
  );
  const raw = JSON.stringify(r.data);
  for (const secret of ["svc-pw", "cn=svc", "127.0.0.1"]) assert.ok(!raw.includes(secret), `the response contains «${secret}»`);
});

test("sign-in: lookup by a service account, bind of the found DN, user creation with a role from groups", async () => {
  const r = await ldapLogin("erin", "erin-pw");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.session, "session issued");
  const u = await me(r.session);
  assert.equal(u.data.user.username, "erin");
  assert.equal(u.data.user.display_name, "Erin Reyes");
  assert.equal(u.data.user.role, "reviewer");
  assert.ok(ldap.binds.some((b) => b.dn === "uid=erin,ou=people,dc=example,dc=com" && !b.empty), "bind performed with the DN from the search");
  const again = await ldapLogin("ERIN", "erin-pw");
  assert.equal(again.status, 200);
  assert.equal((await me(again.session)).data.user.id, u.data.user.id, "same user by DN");
  const admin = await login(base, "admin", ADMIN_PASSWORD);
  const users = await api(base, "GET", "/api/v1/admin/users", undefined, { cookie: admin.cookie });
  assert.equal(users.data.items.find((x) => x.username === "erin").source, "ldap:corp");
  const pw = await api(base, "POST", "/api/v1/auth/login", { username: "erin", password: "erin-pw" });
  assert.equal(pw.status, 401, "an LDAP account cannot sign in through the SkillForge password form");
});

test("role: the highest of the matched groups; without groups, the default role", async () => {
  const hal = await ldapLogin("hal", "hal-pw");
  assert.equal((await me(hal.session)).data.user.role, "admin");
  const ivy = await ldapLogin("ivy", "ivy-pw");
  assert.equal((await me(ivy.session)).data.user.role, "viewer");
});

test("wrong password, unknown user and EMPTY password: the same 401, with no bind with an empty password", async () => {
  const bindsBefore = ldap.binds.length;
  for (const [u, p] of [
    ["erin", "wrong"],
    ["nobody", "whatever"],
    ["erin", ""],
    ["", ""],
  ]) {
    const r = await ldapLogin(u, p);
    assert.equal(r.status, 401, `${u}/${p ? "***" : "<empty>"}: ${r.status}`);
    assert.deepEqual(r.data, { error: "invalid_credentials" });
    assert.equal(r.session, undefined);
  }
  const emptyBinds = ldap.binds.slice(bindsBefore).filter((b) => b.empty);
  assert.deepEqual(emptyBinds, [], "an empty password is rejected BEFORE bind (the server would accept an unauthenticated bind)");
});

test("LDAP injection in the username is escaped", async () => {
  for (const u of ["*", "erin)(uid=*", "e*"]) {
    const r = await ldapLogin(u, "erin-pw");
    assert.equal(r.status, 401, `${u}: ${r.status}`);
  }
  const recent = ldap.filters.slice(-3);
  assert.ok(recent.includes("(uid=\\2a)"), JSON.stringify(recent));
  assert.ok(recent.includes("(uid=erin\\29\\28uid=\\2a)"), JSON.stringify(recent));
  assert.ok(recent.includes("(uid=e\\2a)"), JSON.stringify(recent));
});

test("unreachable LDAP server: 503 within the timeout; a SkillForge account with the same name is not linked", async () => {
  const t0 = Date.now();
  const r = await ldapLogin("erin", "erin-pw", "dead");
  assert.equal(r.status, 503, JSON.stringify(r.data));
  assert.equal(r.data.error, "ldap_unavailable");
  assert.ok(Date.now() - t0 < 10000, "response is no longer than the timeout plus a margin");
  const unknown = await api(base, "POST", "/api/v1/auth/ldap/nope/login", { username: "erin", password: "x" });
  assert.equal(unknown.status, 404);

  const d = await ldapLogin("admin", "ldap-admin-pw");
  assert.equal(d.status, 200);
  const du = (await me(d.session)).data.user;
  assert.equal(du.username, "admin-2", "the LDAP user admin does not take over the built-in admin");
  assert.notEqual(du.role, "admin");
  const local = await login(base, "admin", ADMIN_PASSWORD);
  assert.notEqual(local.user.id, du.id);
});

test("filter matched many entries (sizeLimitExceeded): 401 invalid_credentials, not 503", async () => {
  const r = await ldapLogin("erin", "erin-pw", "wide");
  assert.equal(r.status, 401, `${r.status} ${JSON.stringify(r.data)}`);
  assert.deepEqual(r.data, { error: "invalid_credentials" });
});

test("disabled user: 403 account_disabled", async () => {
  const admin = await login(base, "admin", ADMIN_PASSWORD);
  const users = await api(base, "GET", "/api/v1/admin/users", undefined, { cookie: admin.cookie });
  const ivy = users.data.items.find((x) => x.username === "ivy");
  await api(base, "PATCH", `/api/v1/admin/users/${ivy.id}`, { disabled: true }, { cookie: admin.cookie });
  const r = await ldapLogin("ivy", "ivy-pw");
  assert.equal(r.status, 403);
  assert.equal(r.data.error, "account_disabled");
  assert.equal(r.session, undefined);
});

test("LDAP configuration errors stop startup and name the variable", async () => {
  for (const value of ["{not json", JSON.stringify([provider({ user_filter: "(uid=admin)" })]), JSON.stringify([provider({ id: "Bad Id" })]), JSON.stringify([provider({ url: "http://127.0.0.1:1" })])]) {
    const s = await startServer({ SKILLFORGE_LDAP: value }, { prefix: "skillforge-ldap-bad-" });
    if (s.up) await s.stop();
    assert.equal(s.up, false, `${value.slice(0, 60)}: the server must not start`);
    assert.ok(s.stderr.includes("SKILLFORGE_LDAP"), s.stderr);
  }
});
