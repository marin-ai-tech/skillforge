// cli-profiles: several sign-ins to one or more registries live side by side as named CLI profiles.
// A profile is chosen by --profile, SKILLFORGE_PROFILE or a project binding (.skillforge/profile, searched upwards),
// otherwise the default profile. An explicitly chosen profile gives its own address and tokens; SKILLFORGE_TOKEN does
// not override it. Several profiles for one address without a choice is a refusal, not the first one.
// The oracle is the wire: two fake registries A and B record every request with its Authorization header, so the test
// sees which token went where, not what the CLI says it did. The config is written in the format before the change.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");

const T = {
  admin: "sf_admin_on_a_0001",
  station: "sf_station_on_a_0002",
  stationMcp: "sf_station_mcp_on_a_0003",
  other: "sf_other_on_b_0004",
  env: "sf_from_env_0005",
  third: "sf_third_flag_0006",
};
const USERS_A = { [T.admin]: "admin-user", [T.station]: "station-user", [T.env]: "env-user", [T.third]: "third-user" };
const USERS_B = { [T.other]: "other-user" };
const MCP_A = new Set([T.stationMcp]);

function fakeRegistry(users, mcpTokens) {
  const seen = [];
  const all = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const auth = req.headers.authorization;
      const token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
      seen.push({ method: req.method, path: req.url, auth });
      all.push({ method: req.method, path: req.url, auth });
      const json = (status, data) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(data));
      };
      if (req.method === "GET" && req.url === "/api/v1/me") {
        return users[token] ? json(200, { user: { username: users[token] } }) : json(401, { error: "unauthorized" });
      }
      if (req.method === "GET" && req.url === "/api/v1/install-info") return json(200, { signing: null });
      if (req.method === "DELETE" && req.url?.startsWith("/api/v1/me/tokens/")) {
        res.writeHead(204);
        return res.end();
      }
      if (req.method === "POST" && req.url === "/mcp") {
        if (!mcpTokens.has(token)) return json(403, { error: "mcp_not_allowed" });
        const id = JSON.parse(body || "{}").id ?? null;
        return json(200, { jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake", version: "1" } } });
      }
      return json(404, { error: "not_found" });
    });
  });
  return { server, seen, all };
}

let A;
let B;
let work;
const transcript = [];

before(async () => {
  A = fakeRegistry(USERS_A, MCP_A);
  B = fakeRegistry(USERS_B, new Set());
  await new Promise((r) => A.server.listen(0, "127.0.0.1", r));
  await new Promise((r) => B.server.listen(0, "127.0.0.1", r));
  A.url = `http://127.0.0.1:${A.server.address().port}`;
  B.url = `http://127.0.0.1:${B.server.address().port}`;
  work = mkdtempSync(join(tmpdir(), "skillforge-cli-profiles-"));
});

after(async () => {
  await new Promise((r) => A?.server.close(r));
  await new Promise((r) => B?.server.close(r));
  if (work) rmSync(work, { recursive: true, force: true });
});

beforeEach(() => {
  A.seen.length = 0;
  B.seen.length = 0;
});

let n = 0;
/** A fresh home with a config in the pre-change format: admin (default) and station on A, other on B. */
function home({ defaultProfile = "admin" } = {}) {
  const dir = join(work, `h${++n}`);
  const cfgDir = join(dir, ".skillforge");
  mkdirSync(cfgDir, { recursive: true });
  const config = join(cfgDir, "config.json");
  writeFileSync(
    config,
    JSON.stringify(
      {
        registries: {
          admin: { url: A.url, token: T.admin },
          station: { url: A.url, token: T.station, token_id: "tok-station-id", mcp_token: T.stationMcp },
          other: { url: B.url, token: T.other },
        },
        default: defaultProfile,
      },
      null,
      2,
    ),
  );
  const plain = join(dir, "work");
  mkdirSync(plain, { recursive: true });
  return { dir, config, plain };
}

function bind(dir, content) {
  mkdirSync(join(dir, ".skillforge"), { recursive: true });
  writeFileSync(join(dir, ".skillforge", "profile"), content);
}

function cli(args, { config, cwd, env = {}, input } = {}) {
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("SKILLFORGE_")));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env: { ...base, NO_COLOR: "1", SKILLFORGE_CONFIG: config, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    const kill = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.on("close", (status) => {
      clearTimeout(kill);
      transcript.push(stdout, stderr);
      resolve({ status, stdout, stderr });
    });
    child.stdin.end(input ?? "");
  });
}

const authsTo = (reg, path) => reg.seen.filter((s) => path === undefined || s.path === path).map((s) => s.auth);
const bearer = (t) => `Bearer ${t}`;
const noRequests = () => {
  assert.deepEqual(A.seen, [], "a refused selection still sent requests to A");
  assert.deepEqual(B.seen, [], "a refused selection still sent requests to B");
};

test("no choice: the default profile of a pre-change config", async () => {
  const h = home();
  const r = await cli(["whoami"], { config: h.config, cwd: h.plain });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /admin-user/);
  assert.deepEqual(authsTo(A, "/api/v1/me"), [bearer(T.admin)]);
  assert.deepEqual(B.seen, []);
});

test("--profile and SKILLFORGE_PROFILE choose a profile of the same address", async () => {
  const h = home();
  const flag = await cli(["whoami", "--profile", "station"], { config: h.config, cwd: h.plain });
  assert.equal(flag.status, 0, flag.stderr);
  assert.match(flag.stdout, /station-user/);
  const env = await cli(["whoami"], { config: h.config, cwd: h.plain, env: { SKILLFORGE_PROFILE: "station" } });
  assert.equal(env.status, 0, env.stderr);
  assert.match(env.stdout, /station-user/);
  assert.deepEqual(authsTo(A, "/api/v1/me"), [bearer(T.station), bearer(T.station)]);
});

test("project binding from a subdirectory; the flag is stronger than the binding", async () => {
  const h = home();
  const proj = join(h.dir, "proj");
  const deep = join(proj, "src", "deep");
  mkdirSync(deep, { recursive: true });
  bind(proj, "station\n");
  const bound = await cli(["whoami"], { config: h.config, cwd: deep });
  assert.equal(bound.status, 0, bound.stderr);
  assert.match(bound.stdout, /station-user/);
  const flag = await cli(["whoami", "--profile", "other"], { config: h.config, cwd: deep });
  assert.equal(flag.status, 0, flag.stderr);
  assert.match(flag.stdout, /other-user/);
  assert.deepEqual(authsTo(A, "/api/v1/me"), [bearer(T.station)]);
  assert.deepEqual(authsTo(B, "/api/v1/me"), [bearer(T.other)]);
});

test("negative: the profile file in the CLI config directory is not a binding", async () => {
  const h = home();
  writeFileSync(join(h.dir, ".skillforge", "profile"), "station\n");
  const r = await cli(["whoami"], { config: h.config, cwd: h.plain });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /admin-user/);
  assert.deepEqual(authsTo(A, "/api/v1/me"), [bearer(T.admin)]);
});

test("an explicit profile is stronger than SKILLFORGE_TOKEN; --token is stronger than the profile", async () => {
  const h = home();
  const env = { SKILLFORGE_TOKEN: T.env };
  const profile = await cli(["whoami", "--profile", "station"], { config: h.config, cwd: h.plain, env });
  assert.equal(profile.status, 0, profile.stderr);
  assert.match(profile.stdout, /station-user/);
  assert.match(profile.stderr, /SKILLFORGE_TOKEN/);
  const flag = await cli(["whoami", "--profile", "station", "--token", T.third], { config: h.config, cwd: h.plain, env });
  assert.equal(flag.status, 0, flag.stderr);
  assert.match(flag.stdout, /third-user/);
  // without an explicit profile the variable keeps its old priority
  const plain = await cli(["whoami"], { config: h.config, cwd: h.plain, env });
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, /env-user/);
  assert.deepEqual(authsTo(A, "/api/v1/me"), [bearer(T.station), bearer(T.third), bearer(T.env)]);
});

test("several profiles of one address without a choice: refusal with the list; default among them is the choice", async () => {
  const h = home({ defaultProfile: "other" });
  const r = await cli(["whoami"], { config: h.config, cwd: h.plain, env: { SKILLFORGE_URL: A.url } });
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stderr, /profile_ambiguous/);
  assert.match(r.stderr, /admin/);
  assert.match(r.stderr, /station/);
  noRequests();

  const h2 = home({ defaultProfile: "admin" });
  const ok = await cli(["whoami"], { config: h2.config, cwd: h2.plain, env: { SKILLFORGE_URL: A.url } });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /admin-user/);
  assert.deepEqual(authsTo(A, "/api/v1/me"), [bearer(T.admin)]);
});

test("an unknown profile: refusal that names the profiles and the login command", async () => {
  const h = home();
  const r = await cli(["whoami", "--profile", "ghost"], { config: h.config, cwd: h.plain });
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stderr, /profile_not_found/);
  assert.match(r.stderr, /ghost/);
  assert.match(r.stderr, /admin/);
  assert.match(r.stderr, /login --profile ghost/);
  noRequests();
});

test("a profile and a --url of another address: refusal, no request to either", async () => {
  const h = home();
  const r = await cli(["whoami", "--profile", "other", "--url", A.url], { config: h.config, cwd: h.plain });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /profile_url_conflict/);
  assert.ok(r.stderr.includes(A.url) && r.stderr.includes(B.url), r.stderr);
  noRequests();
});

test("a broken binding: refusal with the file path, content not printed, no requests", async () => {
  for (const content of ["station\nadmin\n", "a b/c\n", ""]) {
    const h = home();
    const proj = join(h.dir, "proj");
    mkdirSync(proj, { recursive: true });
    bind(proj, content);
    const r = await cli(["whoami"], { config: h.config, cwd: proj });
    assert.equal(r.status, 1, `${JSON.stringify(content)}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /profile_binding_invalid/);
    assert.match(r.stderr, /\.skillforge[\\/]profile/);
    assert.ok(!r.stderr.includes("a b/c"), "the binding content is printed");
    noRequests();
  }
});

test("the bridge in a bound project sends the profile's MCP token, not admin's, not its regular one, not the env", async () => {
  const h = home();
  const proj = join(h.dir, "proj");
  const sub = join(proj, "sub");
  mkdirSync(sub, { recursive: true });
  bind(proj, "station\n");
  const init = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } })}\n`;
  const r = await cli(["mcp"], { config: h.config, cwd: sub, env: { SKILLFORGE_TOKEN: T.env }, input: init });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 1, r.stdout);
  assert.equal(JSON.parse(lines[0]).id, 1);
  assert.ok(JSON.parse(lines[0]).result, lines[0]);
  assert.deepEqual(authsTo(A, "/mcp"), [bearer(T.stationMcp)]);
  assert.deepEqual(B.seen, []);
});

test("login into an explicit profile keeps the default; login without a profile moves it", async () => {
  const h = home();
  const r = await cli(["login", "--profile", "station2", "--url", A.url, "--token", T.station], { config: h.config, cwd: h.plain });
  assert.equal(r.status, 0, r.stderr);
  let cfg = JSON.parse(readFileSync(h.config, "utf8"));
  assert.equal(cfg.registries.station2?.token, T.station);
  assert.equal(cfg.default, "admin");

  const proj = join(h.dir, "proj");
  mkdirSync(proj, { recursive: true });
  bind(proj, "station3\n");
  const bound = await cli(["login", "--url", A.url, "--token", T.station], { config: h.config, cwd: proj });
  assert.equal(bound.status, 0, bound.stderr);
  cfg = JSON.parse(readFileSync(h.config, "utf8"));
  assert.equal(cfg.registries.station3?.token, T.station);
  assert.equal(cfg.default, "admin");

  const plain = await cli(["login", "--url", B.url, "--token", T.other], { config: h.config, cwd: h.plain });
  assert.equal(plain.status, 0, plain.stderr);
  cfg = JSON.parse(readFileSync(h.config, "utf8"));
  assert.notEqual(cfg.default, "admin");
  assert.equal(cfg.registries[cfg.default]?.url, B.url);

  const both = await cli(["login", "--profile", "x", "--name", "y", "--url", A.url, "--token", T.station], { config: h.config, cwd: h.plain });
  assert.equal(both.status, 1, both.stdout + both.stderr);
});

test("logout --profile removes that profile and revokes its token on its own address", async () => {
  const h = home();
  const r = await cli(["logout", "--profile", "station"], { config: h.config, cwd: h.plain });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(
    A.seen.filter((s) => s.method === "DELETE").map((s) => [s.path, s.auth]),
    [["/api/v1/me/tokens/tok-station-id", bearer(T.station)]],
  );
  const cfg = JSON.parse(readFileSync(h.config, "utf8"));
  assert.equal(cfg.registries.station, undefined);
  assert.equal(cfg.registries.admin?.token, T.admin);
  assert.equal(cfg.default, "admin");
  assert.deepEqual(B.seen, []);
});

test("profile list --json: profiles, flags, the active one with its source; no tokens", async () => {
  const h = home();
  const proj = join(h.dir, "proj");
  mkdirSync(proj, { recursive: true });
  bind(proj, "station\n");
  const r = await cli(["profile", "list", "--json"], { config: h.config, cwd: proj });
  assert.equal(r.status, 0, r.stderr);
  const data = JSON.parse(r.stdout);
  const byName = Object.fromEntries(data.profiles.map((p) => [p.name, p]));
  assert.deepEqual(Object.keys(byName).sort(), ["admin", "other", "station"]);
  assert.equal(byName.station.url, A.url);
  assert.equal(byName.station.token, true);
  assert.equal(byName.station.mcp_token, true);
  assert.equal(byName.admin.mcp_token, false);
  assert.equal(byName.admin.default, true);
  assert.equal(data.active?.name, "station");
  assert.equal(data.active?.source, "project");
  assert.match(data.active?.binding_path ?? "", /\.skillforge[\\/]profile$/);
  noRequests();
});

test("attacks on the binding: 2 MiB, an address instead of a name, a symlink to another file", async () => {
  const cases = [
    ["big", "station\n" + "x".repeat(2 * 1024 * 1024)],
    ["address", `${B.url}\n`],
    ["parent", "../admin\n"],
  ];
  for (const [label, content] of cases) {
    const h = home();
    const proj = join(h.dir, `proj-${label}`);
    mkdirSync(proj, { recursive: true });
    bind(proj, content);
    const r = await cli(["whoami"], { config: h.config, cwd: proj });
    assert.equal(r.status, 1, `${label}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /profile_binding_invalid/, label);
    assert.ok(!r.stderr.includes(B.url) && r.stderr.length < 2000, `${label}: the content leaks into stderr`);
    noRequests();
  }
  if (process.platform !== "win32") {
    const h = home();
    const proj = join(h.dir, "proj-link");
    mkdirSync(join(proj, ".skillforge"), { recursive: true });
    const secret = join(h.dir, "secret.txt");
    writeFileSync(secret, `${T.admin}\n`);
    symlinkSync(secret, join(proj, ".skillforge", "profile"));
    const r = await cli(["whoami"], { config: h.config, cwd: proj });
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.ok(!(r.stdout + r.stderr).includes(T.admin), "a symlinked binding printed the target's content");
    noRequests();
  }
});

test("negative: human profile list and doctor print no tokens", async () => {
  const h = home();
  const list = await cli(["profile", "list"], { config: h.config, cwd: h.plain });
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /admin/);
  assert.match(list.stdout, /station/);
  await cli(["doctor", "--json"], { config: h.config, cwd: h.plain });
  await cli(["doctor", "--json", "--profile", "station"], { config: h.config, cwd: h.plain });
  // the transcript check below covers both outputs
});

test("negative over the whole run: no token went to the wrong place or into any output", () => {
  assert.ok(A.all.length > 10, "the run sent too few requests to judge");
  for (const s of B.all) assert.ok(s.auth === undefined || s.auth === bearer(T.other), `B got ${s.auth}`);
  for (const s of A.all) assert.notEqual(s.auth, bearer(T.other), "A got B's token");
  for (const s of A.all.filter((x) => x.path?.startsWith("/api/"))) assert.notEqual(s.auth, bearer(T.stationMcp), "MCP token on /api");
  const all = transcript.join("\n");
  for (const [name, token] of Object.entries(T)) assert.ok(!all.includes(token), `token ${name} printed`);
});
