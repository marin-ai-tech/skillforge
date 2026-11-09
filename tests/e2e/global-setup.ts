// Starts the built server on E2E_PORT with a temporary data directory and seeds the registry with fixtures.
// The state (pid, dataDir) is written to .e2e-state.json for global-teardown.
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { BASE, FIXTURES, PORT, ROOT, STATE_FILE } from "./state.ts";
import { ADMIN_PASSWORD, USERS } from "./auth-helpers.ts";
import { startMockOidc } from "../lib/mock-oidc.mjs";
import { startMockLdap } from "../lib/mock-ldap.mjs";
import { startFakeLlm } from "../lib/fake-llm.mjs";

/** `data_dir` from health as our admin, or null when the server does not accept our admin password. */
async function adminDataDir(): Promise<string | null> {
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: ADMIN_PASSWORD }),
  });
  const cookie = /sf_session=[^;]+/.exec(login.headers.get("set-cookie") ?? "")?.[0];
  if (login.status !== 200 || !cookie) return null;
  const h = (await (await fetch(`${BASE}/api/v1/health`, { headers: { cookie } })).json()) as {
    data_dir?: string;
  };
  return typeof h.data_dir === "string" ? h.data_dir : null;
}

const SERVER = join(ROOT, "packages", "server", "dist", "index.js");
const WEB_INDEX = join(ROOT, "packages", "web", "dist", "index.html");

type FileEntry = { path: string; content: Buffer };

function loadDir(dir: string): FileEntry[] {
  const out: FileEntry[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push({ path: relative(dir, p).replace(/\\/g, "/"), content: readFileSync(p) });
    }
  };
  walk(dir);
  return out;
}

const b64 = (files: FileEntry[]) =>
  files.map((f) => ({ path: f.path, content_base64: f.content.toString("base64") }));

async function login(username: string, password: string): Promise<string> {
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (r.status !== 200) throw new Error(`seed login ${username} failed (${r.status}): ${await r.text()}`);
  const m = /sf_session=([^;]+)/.exec(r.headers.get("set-cookie") ?? "");
  if (!m) throw new Error("seed login: no sf_session cookie");
  return `sf_session=${m[1]}`;
}

async function createUser(adminCookie: string, u: { username: string; password: string; role: string }) {
  const r = await fetch(`${BASE}/api/v1/admin/users`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: adminCookie },
    body: JSON.stringify(u),
  });
  if (r.status !== 201) throw new Error(`seed create user ${u.username} failed (${r.status}): ${await r.text()}`);
}

async function publish(body: Record<string, unknown>, cookie: string) {
  const r = await fetch(`${BASE}/api/v1/artifacts`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  if (r.status !== 201) {
    throw new Error(`seed publish failed (${r.status}): ${await r.text()}`);
  }
  return r.json();
}

export default async function globalSetup() {
  // Test OIDC provider: sign in with the "Test IdP" button on the stand; user dana, group reviewers.
  const idp = await startMockOidc();
  // Stub of an OpenAI-compatible API: the key from the environment is allowed only for its origin.
  const llm = await startFakeLlm();
  // Test LDAP: the "Corporate account" sign-in method, user erin (reviewers).
  const ldap = await startMockLdap([
    { dn: "cn=svc,dc=example,dc=com", password: "svc-pw", attrs: { cn: ["svc"] } },
    {
      dn: "uid=erin,ou=people,dc=example,dc=com",
      password: "erin-pw",
      attrs: { uid: ["erin"], cn: ["Erin Reyes"], mail: ["erin@example.com"], memberOf: ["cn=skillforge-reviewers,ou=groups,dc=example,dc=com"] },
    },
  ]);
  if (!existsSync(SERVER) || !existsSync(WEB_INDEX)) {
    throw new Error(`a build is required: npm run build (missing ${SERVER} or ${WEB_INDEX})`);
  }
  const dataDir = mkdtempSync(join(tmpdir(), "skillforge-e2e-"));
  // Plugin stand: only the valid hello plugin from the fixtures.
  const pluginsDir = join(dataDir, "plugins");
  cpSync(join(ROOT, "tests", "fixtures", "plugins", "hello"), join(pluginsDir, "hello"), { recursive: true });
  // Review assistant stand: the plugin from the repository (when present) + a reviewers file with mock reviewers.
  const reviewPlugin = join(ROOT, "plugins", "review-assistant");
  if (existsSync(reviewPlugin)) cpSync(reviewPlugin, join(pluginsDir, "review-assistant"), { recursive: true });
  const MOCK_REVIEWER = join(ROOT, "tests", "fixtures", "review", "mock-reviewer.mjs");
  const reviewersFile = join(dataDir, "reviewers.json");
  writeFileSync(
    reviewersFile,
    JSON.stringify({
      reviewers: [
        { id: "strict", command: [process.execPath, MOCK_REVIEWER, "--persona", "strict", "--input", "json"], timeout_s: 20 },
        { id: "lenient", command: [process.execPath, MOCK_REVIEWER, "--persona", "lenient", "--input", "prompt", "--wrap", "claude"], timeout_s: 20 },
      ],
    }),
  );
  // Agents stand: the server agents root with a runner/.claude folder (pdf-tools 0.1.0).
  const agentRoots = join(dataDir, "agent-roots");
  cpSync(join(FIXTURES, "skill-standard", "pdf-tools"), join(agentRoots, "runner", ".claude", "skills", "pdf-tools"), { recursive: true });
  // release-dist: a stand-in CLI package so the home page shows the install command (the real one comes from a release).
  const downloadsDir = join(dataDir, "downloads");
  mkdirSync(downloadsDir, { recursive: true });
  writeFileSync(join(downloadsDir, "skillforge-cli.tgz"), "e2e stand-in");
  const child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      SKILLFORGE_PORT: String(PORT),
      SKILLFORGE_HOST: "127.0.0.1",
      SKILLFORGE_DATA_DIR: dataDir,
      SKILLFORGE_ADMIN_PASSWORD: ADMIN_PASSWORD,
      SKILLFORGE_AGING_DAYS: "0",
      SKILLFORGE_PLUGINS_DIR: pluginsDir,
      SKILLFORGE_REVIEWERS_FILE: reviewersFile,
      SKILLFORGE_AGENT_ROOTS: agentRoots,
      SKILLFORGE_PUBLIC_URL: BASE,
      SKILLFORGE_LLM_API_KEY: "sk-e2e-llm-key-0123456789",
      SKILLFORGE_DOWNLOADS_DIR: downloadsDir,
      SKILLFORGE_LLM_KEY_ORIGINS: llm.origin,
      SKILLFORGE_LDAP: JSON.stringify([
        {
          id: "corp",
          label: "Corporate account",
          url: ldap.url,
          bind_dn: "cn=svc,dc=example,dc=com",
          bind_password: "svc-pw",
          user_base: "ou=people,dc=example,dc=com",
          user_filter: "(uid={username})",
          group_attribute: "memberOf",
          role_map: { "cn=skillforge-reviewers,ou=groups,dc=example,dc=com": "reviewer" },
        },
      ]),
      SKILLFORGE_OIDC_PROVIDERS: JSON.stringify([
        {
          id: "test-idp",
          label: "Test IdP",
          issuer: idp.issuer,
          client_id: idp.clientId,
          client_secret: idp.clientSecret,
          role_claim: "groups",
          role_map: { "skillforge-reviewers": "reviewer", "skillforge-admins": "admin" },
        },
      ]),
    },
    stdio: ["ignore", "ignore", "pipe"],
    detached: false,
  });
  let stderr = "";
  child.stderr?.on("data", (d) => (stderr += d));
  child.unref();

  // As in tests/lib/client.mjs: headroom for load from parallel runs.
  const deadline = Date.now() + (Number(process.env.SKILLFORGE_TEST_START_TIMEOUT_MS) || 30_000);
  let up = false;
  let foreign: string | null = null;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/v1/health`);
      if (r.status === 200) {
        // health-data-dir: the data path is shown to admins only, so sign in as our admin; a foreign server
        // rejects the password and is reported as foreign.
        const dir = await adminDataDir();
        if (dir === null || resolve(dir) !== resolve(dataDir)) {
          foreign = dir ?? "?";
          break;
        }
        up = true;
        break;
      }
    } catch {
      /* retry */
    }
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (foreign !== null) {
    if (child.exitCode === null) child.kill();
    throw new Error(`port ${PORT} is taken by another SkillForge server (data_dir=${foreign}); stop it or set E2E_PORT`);
  }
  if (!up) {
    throw new Error(`e2e server did not start on port ${PORT} (busy? set E2E_PORT): ${stderr}`);
  }
  writeFileSync(STATE_FILE, JSON.stringify({ pid: child.pid, dataDir, llmUrl: llm.url }), "utf8");

  // Users: admin (seed), alice (contributor), bob (viewer). Seeding: 2 skills, 1 command, 1 agent, 1 hook.
  const admin = await login(USERS.admin.username, USERS.admin.password);
  await createUser(admin, USERS.alice);
  await createUser(admin, USERS.bob);
  await createUser(admin, USERS.rita);
  const alice = await login(USERS.alice.username, USERS.alice.password);

  const skill = loadDir(join(FIXTURES, "skill-standard")); // pdf-tools/SKILL.md, references/REFERENCE.md
  await publish({ type: "skill", files: b64(skill) }, admin);
  const v2 = skill.map((f) =>
    f.path.endsWith("SKILL.md")
      ? { path: f.path, content: Buffer.from(f.content.toString("utf8") + "\n4. Merge with `scripts/merge.py`.\n") }
      : f,
  );
  await publish({ type: "skill", version: "0.2.0", changelog: "Add merge step", files: b64(v2) }, admin);
  await publish({ type: "command", files: b64(loadDir(join(FIXTURES, "command-propose"))) }, admin);
  await publish(
    { type: "agent", provenance: { source: "reckon", ref: "run-42" }, model_compat: ["opus-5"], files: b64(loadDir(join(FIXTURES, "agent-executor"))) },
    alice,
  );
  await publish({ type: "hook", name: "destructive-guard", files: b64(loadDir(join(FIXTURES, "hook-guard"))) }, alice);
  await publish({
    type: "skill",
    files: b64([
      {
        path: "SKILL.md",
        content: Buffer.from(
          "---\nname: linker\ndescription: Links internal docs to the code they describe. Use when asked to cross-reference documentation.\ntags: [docs, linking]\n---\n\n# Linker\n\nFind the doc, find the symbol, add the link.\n",
        ),
      },
    ]),
  }, admin);

  // Lifecycle: hook/destructive-guard → active (reviewer rita); the rest stay candidate.
  const rita = await login(USERS.rita.username, USERS.rita.password);
  const t = await fetch(`${BASE}/api/v1/artifacts/hook/destructive-guard/transitions`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: rita },
    body: JSON.stringify({ to: "active", reason: "seed" }),
  });
  if (t.status !== 200) throw new Error(`seed transition failed (${t.status}): ${await t.text()}`);
  return async () => {
    await idp.stop();
    await ldap.stop();
    await llm.stop();
  };
}
