#!/usr/bin/env node
// P0 MVP simulation without a browser.
// Walks the manual test-case actors (admin, rev1, dev1, viewer1, team alpha) over the HTTP API and the
// built CLI (packages/cli/dist). Two modes:
//   - default (no SIMULATE_BASE_URL): starts its own server — the built packages/server/dist/index.js or the
//     file named by SIMULATE_SERVER_ENTRY — on a free local port (E2E_PORT pins the port) and a temporary
//     data directory with a generated admin password, seeds the demo actors over the API, runs the steps and
//     always stops the server and removes the directory;
//   - external stand: SIMULATE_BASE_URL + SIMULATE_ADMIN_PASSWORD (rev1/dev1/viewer1 use SEED_DEMO_PASSWORD,
//     default as in seed:demo); no server is started.
// Every step checks a concrete status and response shape; negative role checks expect 403 after a
// successful login. The first line is `simulate-mvp against <base>`, the last `summary: N/M passed`.
// Exit code: 0 only when every step passed; failed steps are listed with their TC-* id.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_ENTRY = process.env.SIMULATE_SERVER_ENTRY
  ? resolve(process.env.SIMULATE_SERVER_ENTRY)
  : join(ROOT, "packages", "server", "dist", "index.js");
const CLI_ENTRY = join(ROOT, "packages", "cli", "dist", "index.js");
const SERVER_GUARD = join(ROOT, "scripts", "lib", "server-guard.mjs");
const EXTERNAL_BASE = (process.env.SIMULATE_BASE_URL ?? "").replace(/\/+$/, "");
const OWN_SERVER = EXTERNAL_BASE === "";
// Own-server mode: a free port unless E2E_PORT pins one (never the local stand port).
const FIXED_PORT = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : null;
const START_TIMEOUT_MS = Number(process.env.SKILLFORGE_TEST_START_TIMEOUT_MS) || 30000;
const REQUEST_TIMEOUT_MS = 15000;
const CLI_TIMEOUT_MS = 60000;

const secret = () => randomBytes(18).toString("base64url");
const ADMIN_PW = OWN_SERVER ? secret() : (process.env.SIMULATE_ADMIN_PASSWORD ?? "");
const DEMO_PW = OWN_SERVER ? `demo-${secret()}` : (process.env.SEED_DEMO_PASSWORD ?? "demo-pass-1");

const ACTORS = {
  admin: { username: "admin", role: "admin", password: ADMIN_PW },
  rev1: { username: "rev1", role: "reviewer", password: DEMO_PW },
  dev1: { username: "dev1", role: "contributor", password: DEMO_PW },
  viewer1: { username: "viewer1", role: "viewer", password: DEMO_PW },
};
const TEAM = "alpha";
const CANDIDATE = `sim-mvp-${Date.now().toString(36)}-${randomBytes(2).toString("hex")}`;
const CANDIDATE_MD =
  `---\nname: ${CANDIDATE}\ndescription: Candidate skill published by simulate-mvp. ` +
  "Use when checking the P0 publish, promote and install flow. Do not use in production.\n---\n\n" +
  `# ${CANDIDATE}\n\nSimulation body.\n`;

let BASE = EXTERNAL_BASE;
const results = [];
const cookies = {};
const state = { packId: null, token: null, tokenId: null, workDir: null };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.on("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

/** Environment without inherited SKILLFORGE_* settings, so child processes see only what we pass. */
function cleanEnv(extra) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("SKILLFORGE_")) env[k] = v;
  return Object.assign(env, extra);
}

async function call(actor, method, path, body) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (actor && cookies[actor]) headers.cookie = cookies[actor];
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const setCookie = res.headers.getSetCookie?.().join("; ") ?? res.headers.get("set-cookie") ?? "";
  let json = null;
  if ((res.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      json = await res.json();
    } catch {
      json = null;
    }
  } else {
    await res.arrayBuffer().catch(() => null);
  }
  return { status: res.status, json, setCookie };
}

async function step(tc, title, fn) {
  try {
    const note = await fn();
    results.push({ tc, title, ok: true, note: note ?? "" });
  } catch (err) {
    results.push({ tc, title, ok: false, note: String(err?.message ?? err) });
  }
}

function check(cond, message) {
  if (!cond) throw new Error(message);
}

const brief = (json) => {
  const s = JSON.stringify(json);
  return s === undefined ? "no JSON body" : s.length > 160 ? `${s.slice(0, 160)}…` : s;
};

/** Exactly one expected status, otherwise the step fails (401/404 never pass for something else). */
function expectStatus(r, expected, what) {
  check(
    r.status === expected,
    `${what}: expected HTTP ${expected}, got ${r.status} ${brief(r.json)}`,
  );
  return `HTTP ${r.status}`;
}

function requireLogin(actor, what) {
  check(cookies[actor], `${what}: precondition failed — ${actor} is not logged in`);
}

/** Negative role check: the actor must be logged in, and the answer must be 403 forbidden. */
function expectForbidden(actor, r, what) {
  requireLogin(actor, what);
  expectStatus(r, 403, what);
  check(r.json?.error === "forbidden", `${what}: expected error "forbidden", got ${brief(r.json)}`);
  return "HTTP 403 forbidden";
}

async function login(actor) {
  const a = ACTORS[actor];
  check(a.password, "no password provided (set SIMULATE_ADMIN_PASSWORD / SEED_DEMO_PASSWORD)");
  const r = await call(null, "POST", "/api/v1/auth/login", {
    username: a.username,
    password: a.password,
  });
  expectStatus(r, 200, `login ${a.username}`);
  check(
    r.json?.user?.username === a.username,
    `login ${a.username}: response has no user ${a.username}: ${brief(r.json)}`,
  );
  check(
    r.json.user.role === a.role,
    `login ${a.username}: expected role ${a.role}, got ${r.json.user.role}`,
  );
  const m = /sf_session=([^;]+)/.exec(r.setCookie);
  check(m, `login ${a.username}: no sf_session cookie`);
  cookies[actor] = `sf_session=${m[1]}`;
  return `HTTP 200, role ${a.role}`;
}

async function marketplaceNames(actor) {
  const r = await call(actor, "GET", "/marketplace.json");
  expectStatus(r, 200, "marketplace.json");
  check(Array.isArray(r.json?.plugins), `marketplace.json: no plugins array: ${brief(r.json)}`);
  return r.json.plugins.map((p) => p?.name);
}

async function artifactStatus(actor, name) {
  const r = await call(actor, "GET", `/api/v1/artifacts/skill/${encodeURIComponent(name)}`);
  expectStatus(r, 200, `artifact skill/${name}`);
  const status = r.json?.status ?? r.json?.artifact?.status;
  check(typeof status === "string", `artifact skill/${name}: no status: ${brief(r.json)}`);
  return status;
}

/** Runs the built CLI as dev1 (token from /me/tokens) in the temporary project directory. */
function runCli(args) {
  return new Promise((resolveRun) => {
    const env = cleanEnv({
      SKILLFORGE_CONFIG: join(state.workDir, "cli-config.json"),
      SKILLFORGE_URL: BASE,
      SKILLFORGE_TOKEN: state.token,
      NO_COLOR: "1",
    });
    const child = spawn(process.execPath, [CLI_ENTRY, ...args], {
      cwd: state.workDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), CLI_TIMEOUT_MS);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolveRun({ code, stdout, stderr });
    });
  });
}

function requireCli(what) {
  check(existsSync(CLI_ENTRY), `${what}: built CLI not found: ${CLI_ENTRY} — run npm run build`);
  check(state.token, `${what}: precondition failed — no dev1 API token`);
}

// ---------------------------------------------------------------------------------------------
// Own server lifecycle

async function startOwnServer() {
  const root = mkdtempSync(join(tmpdir(), "skillforge-simulate-"));
  const dataDir = join(root, "data");
  mkdirSync(dataDir, { recursive: true });
  const port = FIXED_PORT ?? (await freePort());
  BASE = `http://127.0.0.1:${port}`;
  console.log(`simulate-mvp against ${BASE}`);
  const srv = { root, dataDir, child: null, exited: null, log: "", up: false, error: null };
  if (!existsSync(SERVER_ENTRY)) {
    srv.error = `server entry not found: ${SERVER_ENTRY} — run npm run build`;
    return srv;
  }
  // The server runs under scripts/lib/server-guard.mjs, which stops it when our stdin pipe closes — including when this
  // script is terminated abruptly and its exit handlers never run.
  srv.child = spawn(process.execPath, [SERVER_GUARD, SERVER_ENTRY], {
    cwd: ROOT,
    env: cleanEnv({
      SKILLFORGE_PORT: String(port),
      SKILLFORGE_HOST: "127.0.0.1",
      SKILLFORGE_DATA_DIR: dataDir,
      SKILLFORGE_ADMIN_PASSWORD: ADMIN_PW,
    }),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const keep = (d) => {
    srv.log = (srv.log + d).slice(-8000);
  };
  srv.child.stdout.on("data", keep);
  srv.child.stderr.on("data", keep);
  srv.exited = new Promise((r) => srv.child.on("exit", (code) => r(code)));
  // Never leave our server behind: Ctrl+C / termination and the final exit kill only our own child.
  const child = srv.child;
  process.on("exit", () => {
    if (child.exitCode === null && child.signalCode === null) child.stdin.end();
  });
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.once(sig, () => {
      child.stdin.end();
      setTimeout(() => {
        try {
          rmSync(root, { recursive: true, force: true });
        } catch {
          /* left in the temp dir */
        }
        process.exit(130);
      }, 500);
    });
  }
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline && srv.child.exitCode === null) {
    try {
      const r = await call(null, "GET", "/api/v1/health");
      if (r.status === 200 && r.json?.status === "ok") {
        if (typeof r.json.data_dir === "string" && resolve(r.json.data_dir) !== resolve(dataDir)) {
          srv.error = `port ${port} answers with a foreign data dir; free it or unset E2E_PORT`;
          return srv;
        }
        srv.up = true;
        return srv;
      }
    } catch {
      /* not up yet */
    }
    await sleep(150);
  }
  srv.error =
    srv.child.exitCode !== null
      ? `server exited with code ${srv.child.exitCode} before answering /api/v1/health`
      : `server did not answer /api/v1/health within ${START_TIMEOUT_MS} ms`;
  return srv;
}

async function stopOwnServer(srv) {
  if (srv.child && srv.child.exitCode === null && srv.child.signalCode === null) {
    // Ending the guard's stdin stops the server and then the guard itself.
    srv.child.stdin.end();
    const code = await Promise.race([srv.exited, sleep(10000).then(() => "timeout")]);
    if (code === "timeout") {
      srv.child.kill("SIGKILL");
      await Promise.race([srv.exited, sleep(5000)]);
    }
  }
  // Windows: SQLite files can stay locked for a moment after the process exits (EPERM/EBUSY).
  for (let i = 0; i < 20; i++) {
    try {
      rmSync(srv.root, { recursive: true, force: true });
      return;
    } catch {
      await sleep(250);
    }
  }
  console.error(`simulate-mvp: could not remove temporary directory ${srv.root}`);
}

// ---------------------------------------------------------------------------------------------
// Steps

async function seedDemo() {
  // Demo data for the temporary data dir (actors and team as in scripts/seed-demo.ts), over the API.
  await step(
    "TC-A03",
    "admin creates rev1 (reviewer), dev1 (contributor), viewer1 (viewer)",
    async () => {
      requireLogin("admin", "seed users");
      for (const actor of ["rev1", "dev1", "viewer1"]) {
        const a = ACTORS[actor];
        const r = await call("admin", "POST", "/api/v1/admin/users", {
          username: a.username,
          password: a.password,
          role: a.role,
          display_name: a.username,
        });
        expectStatus(r, 201, `create user ${a.username}`);
        check(
          r.json?.username === a.username || r.json?.user?.username === a.username,
          `create user ${a.username}: ${brief(r.json)}`,
        );
      }
      return "3 users created";
    },
  );
  await step("TC-T02", `admin creates team ${TEAM} (lead dev1, member viewer1)`, async () => {
    requireLogin("admin", "seed team");
    const t = await call("admin", "POST", "/api/v1/teams", { name: TEAM, lead: "dev1" });
    expectStatus(t, 201, `create team ${TEAM}`);
    const m = await call("admin", "POST", `/api/v1/teams/${TEAM}/members`, {
      username: "viewer1",
      role: "member",
    });
    check(
      [200, 201].includes(m.status),
      `add viewer1 to ${TEAM}: HTTP ${m.status} ${brief(m.json)}`,
    );
    return `team ${TEAM} created`;
  });
}

async function publishSteps() {
  await step("TC-P01", `dev1 publishes candidate skill/${CANDIDATE}`, async () => {
    requireLogin("dev1", "publish");
    const r = await call("dev1", "POST", "/api/v1/artifacts", {
      type: "skill",
      files: [
        {
          path: `${CANDIDATE}/SKILL.md`,
          content_base64: Buffer.from(CANDIDATE_MD, "utf8").toString("base64"),
        },
      ],
    });
    expectStatus(r, 201, "publish");
    const status = await artifactStatus("dev1", CANDIDATE);
    check(status === "candidate", `published artifact is ${status}, expected candidate`);
    return "HTTP 201, status candidate";
  });

  await step("TC-L02", "candidate is not listed in marketplace.json", async () => {
    requireLogin("viewer1", "marketplace");
    const names = await marketplaceNames("viewer1");
    check(!names.includes(CANDIDATE), `candidate ${CANDIDATE} is listed in marketplace.json`);
    return `${names.length} plugins, candidate absent`;
  });

  await step("TC-L01", "dev1 (contributor) cannot batch promote (403)", async () => {
    const r = await call("dev1", "POST", "/api/v1/lifecycle/batch-transitions", {
      items: [{ type: "skill", name: CANDIDATE, to: "active" }],
    });
    return expectForbidden("dev1", r, "dev1 batch-transitions");
  });

  await step("TC-L01", "rev1 batch promotes the candidate from the lifecycle board", async () => {
    requireLogin("rev1", "batch promote");
    const board = await call("rev1", "GET", "/api/v1/lifecycle/board");
    expectStatus(board, 200, "lifecycle board");
    check(
      Array.isArray(board.json?.review),
      `lifecycle board: no review list: ${brief(board.json)}`,
    );
    check(
      board.json.review.some((a) => a?.type === "skill" && a?.name === CANDIDATE),
      `lifecycle board: candidate ${CANDIDATE} is not in review`,
    );
    const r = await call("rev1", "POST", "/api/v1/lifecycle/batch-transitions", {
      items: [{ type: "skill", name: CANDIDATE, to: "active" }],
      reason: "simulate-mvp",
    });
    expectStatus(r, 200, "batch-transitions");
    const res = r.json?.results;
    check(
      Array.isArray(res) && res.length === 1 && res[0]?.name === CANDIDATE && res[0]?.ok === true,
      `batch result not ok: ${brief(r.json)}`,
    );
    const status = await artifactStatus("rev1", CANDIDATE);
    check(status === "active", `after promote the artifact is ${status}, expected active`);
    return `promoted skill/${CANDIDATE} -> active`;
  });

  await step("TC-L02", "promoted skill is listed in marketplace.json", async () => {
    requireLogin("viewer1", "marketplace");
    const names = await marketplaceNames("viewer1");
    check(names.includes(CANDIDATE), `active ${CANDIDATE} is missing from marketplace.json`);
    return `${names.length} plugins`;
  });
}

async function roleSteps() {
  await step("TC-A04", "viewer1 cannot install a starter pack (403)", async () => {
    const r = await call(
      "viewer1",
      "POST",
      `/api/v1/admin/starter-packs/${encodeURIComponent(state.packId ?? "codealive")}/install`,
      {},
    );
    return expectForbidden("viewer1", r, "viewer1 starter-pack install");
  });

  await step("TC-T02", `team ${TEAM} visible to dev1 (lead) and viewer1 (member)`, async () => {
    requireLogin("dev1", "team");
    requireLogin("viewer1", "team");
    const r1 = await call("dev1", "GET", `/api/v1/teams/${TEAM}`);
    const r2 = await call("viewer1", "GET", `/api/v1/teams/${TEAM}`);
    expectStatus(r1, 200, "team as dev1");
    expectStatus(r2, 200, "team as viewer1");
    check(
      r1.json?.name === TEAM && r1.json?.is_member === true,
      `dev1 not in team: ${brief(r1.json)}`,
    );
    check(r2.json?.is_member === true, `viewer1 is not a member: ${brief(r2.json)}`);
    const members = r2.json?.members;
    check(Array.isArray(members), `members not visible to a team member: ${brief(r2.json)}`);
    const lead = members.find((m) => m?.username === "dev1");
    check(lead?.role === "lead", `dev1 is not the lead of ${TEAM}: ${brief(members)}`);
    check(
      members.some((m) => m?.username === "viewer1"),
      `viewer1 missing from ${TEAM}`,
    );
    return `members: ${members.length}`;
  });

  await step("TC-T05", "dev1 (owner) is notified about the status change", async () => {
    requireLogin("dev1", "notifications");
    const r = await call("dev1", "GET", "/api/v1/me/notifications");
    expectStatus(r, 200, "notifications");
    check(Array.isArray(r.json?.items), `notifications: no items: ${brief(r.json)}`);
    check(
      typeof r.json.unread_count === "number",
      `notifications: no unread_count: ${brief(r.json)}`,
    );
    check(
      r.json.items.some((n) => n?.kind === "status_change" && n?.artifact?.name === CANDIDATE),
      `no status_change notification for ${CANDIDATE}`,
    );
    return `${r.json.items.length} notifications, unread ${r.json.unread_count}`;
  });

  await step("TC-E02", "admin metrics overview", async () => {
    requireLogin("admin", "metrics");
    const r = await call("admin", "GET", "/api/v1/metrics/overview");
    expectStatus(r, 200, "metrics overview");
    check(Array.isArray(r.json?.items), `metrics: no items: ${brief(r.json)}`);
    const total = r.json?.totals?.artifacts;
    check(typeof total === "number" && total >= 1, `metrics: totals.artifacts = ${total}`);
    return `totals.artifacts ${total}`;
  });

  await step("TC-E03", `rev1 lists eval runs of skill/${CANDIDATE}`, async () => {
    requireLogin("rev1", "evals");
    const r = await call("rev1", "GET", `/api/v1/artifacts/skill/${CANDIDATE}/evals/runs`);
    expectStatus(r, 200, "eval runs");
    check(Array.isArray(r.json?.items), `eval runs: no items: ${brief(r.json)}`);
    return `HTTP 200, ${r.json.items.length} runs`;
  });

  await step("TC-A04", "viewer1 cannot purge an artifact (403), artifact stays", async () => {
    const r = await call("viewer1", "POST", `/api/v1/artifacts/skill/${CANDIDATE}/purge`, {
      reason: "simulate-mvp",
    });
    const note = expectForbidden("viewer1", r, "viewer1 purge");
    const status = await artifactStatus("viewer1", CANDIDATE);
    check(status === "active", `after a forbidden purge the artifact is ${status}`);
    return note;
  });
}

async function cliSteps() {
  await step("TC-E0A0-02", "CLI skillforge whoami --json (dev1 token)", async () => {
    requireLogin("dev1", "token");
    const t = await call("dev1", "POST", "/api/v1/me/tokens", { name: "simulate-mvp" });
    expectStatus(t, 201, "create dev1 token");
    check(typeof t.json?.token === "string" && t.json.token, "no token in the /me/tokens answer");
    state.token = t.json.token;
    state.tokenId = t.json.id ?? t.json.token_id ?? null;
    requireCli("whoami");
    const r = await runCli(["whoami", "--json"]);
    check(r.code === 0, `skillforge whoami: exit ${r.code} ${r.stderr.trim()}`);
    let user;
    try {
      user = JSON.parse(r.stdout).user;
    } catch {
      throw new Error(`skillforge whoami --json: stdout is not JSON: ${r.stdout.slice(0, 160)}`);
    }
    check(user?.username === "dev1", `skillforge whoami: user ${user?.username}`);
    return "exit 0, dev1";
  });

  const into = () => join(state.workDir, "project", ".claude");
  const skillFile = () => join(into(), "skills", CANDIDATE, "SKILL.md");
  await step(
    "TC-E0A0-04",
    `CLI skillforge install skill/${CANDIDATE} into a temp project`,
    async () => {
      requireCli("install");
      const r = await runCli(["install", `skill/${CANDIDATE}`, "--into", into()]);
      check(r.code === 0, `skillforge install: exit ${r.code} ${(r.stderr || r.stdout).trim()}`);
      check(existsSync(skillFile()), `skillforge install: ${skillFile()} not created`);
      const got = readFileSync(skillFile(), "utf8").replace(/\r\n/g, "\n");
      check(
        got === CANDIDATE_MD,
        "skillforge install: SKILL.md differs from the published version",
      );
      const lockPath = join(into(), ".skillforge-lock.json");
      check(existsSync(lockPath), "skillforge install: no .skillforge-lock.json");
      const lock = JSON.parse(readFileSync(lockPath, "utf8"));
      const entry = lock.artifacts?.[`skill/${CANDIDATE}`];
      check(/^[0-9a-f]{64}$/.test(entry?.digest ?? ""), `lock entry missing: ${brief(lock)}`);
      return `exit 0, SKILL.md + lock ${entry.version}`;
    },
  );

  await step("TC-E0A0-05", "CLI repeated install is idempotent (up to date)", async () => {
    requireCli("install again");
    check(existsSync(skillFile()), "precondition failed — the first install did not happen");
    const r = await runCli(["install", `skill/${CANDIDATE}`, "--into", into()]);
    check(r.code === 0, `skillforge install (again): exit ${r.code} ${r.stderr.trim()}`);
    check(/up to date/i.test(r.stdout), `skillforge install (again): ${r.stdout.trim()}`);
    return "exit 0, up to date";
  });
}

async function runSteps() {
  await step("TC-S01", "server health", async () => {
    const r = await call(null, "GET", "/api/v1/health");
    expectStatus(r, 200, "health");
    check(r.json?.status === "ok", `health: ${brief(r.json)}`);
    return `version ${r.json.version ?? "?"}`;
  });

  await step("TC-D01", "marketplace.json is a Claude Code marketplace", async () => {
    const r = await call(null, "GET", "/marketplace.json");
    expectStatus(r, 200, "marketplace.json");
    check(
      typeof r.json?.name === "string" && r.json.name,
      `marketplace.json: no name: ${brief(r.json)}`,
    );
    check(Array.isArray(r.json.plugins), `marketplace.json: no plugins array: ${brief(r.json)}`);
    return `${r.json.plugins.length} plugins`;
  });

  await step("TC-A01", "login admin", () => login("admin"));
  if (OWN_SERVER) await seedDemo();
  for (const actor of ["rev1", "dev1", "viewer1"]) {
    await step("TC-A01", `login ${actor}`, () => login(actor));
  }

  await step("first-run", "admin lists starter packs", async () => {
    requireLogin("admin", "starter-packs");
    const r = await call("admin", "GET", "/api/v1/admin/starter-packs");
    expectStatus(r, 200, "starter-packs");
    const items = r.json?.items;
    check(Array.isArray(items) && items.length > 0, `starter-packs: no items: ${brief(r.json)}`);
    check(
      typeof items[0].id === "string" && items[0].artifacts > 0,
      `starter-packs: ${brief(items[0])}`,
    );
    state.packId = items[0].id;
    return `first pack: ${state.packId} (${items[0].artifacts} artifacts)`;
  });
  await step("first-run", "admin installs the starter pack", async () => {
    requireLogin("admin", "install");
    check(state.packId, "precondition failed — no starter pack listed");
    const r = await call(
      "admin",
      "POST",
      `/api/v1/admin/starter-packs/${encodeURIComponent(state.packId)}/install`,
      {},
    );
    expectStatus(r, 200, "starter-pack install");
    const res = r.json?.results;
    check(
      Array.isArray(res) && res.length > 0,
      `starter-pack install: no results: ${brief(r.json)}`,
    );
    return `${res.length} results`;
  });

  await publishSteps();
  await roleSteps();
  await cliSteps();
}

async function revokeToken() {
  if (!state.tokenId || !cookies.dev1) return;
  const path = `/api/v1/me/tokens/${encodeURIComponent(state.tokenId)}`;
  await call("dev1", "DELETE", path).catch(() => null);
}

async function main() {
  let srv = null;
  try {
    if (OWN_SERVER) {
      srv = await startOwnServer();
      state.workDir = join(srv.root, "work");
      mkdirSync(state.workDir, { recursive: true });
      if (srv.up) await runSteps();
      else {
        results.push({ tc: "TC-S01", title: "start own server", ok: false, note: srv.error });
        if (srv.log) console.error(srv.log.trim());
      }
    } else {
      console.log(`simulate-mvp against ${BASE}`);
      state.workDir = mkdtempSync(join(tmpdir(), "skillforge-simulate-cli-"));
      try {
        await runSteps();
      } finally {
        await revokeToken();
      }
    }
  } finally {
    if (srv) await stopOwnServer(srv);
    else if (state.workDir) rmSync(state.workDir, { recursive: true, force: true, maxRetries: 5 });
  }

  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.tc}  ${r.title}  ${r.note}`);
  if (failed.length) console.log(`failed: ${[...new Set(failed.map((r) => r.tc))].join(", ")}`);
  console.log(`summary: ${results.length - failed.length}/${results.length} passed`);
  return failed.length ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
