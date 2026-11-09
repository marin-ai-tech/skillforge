// Test kit defects: seed:demo guards, simulate-mvp on a seeded stand, batch-transitions, doctor, Q_TOOLS_UNBOUNDED.
// Requires `npm run build`.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import {
  ROOT,
  startServer,
  api as rawApi,
  login,
  createUser,
  toB64,
  ADMIN_PASSWORD,
} from "./lib/client.mjs";
import { parseArtifact, assessQuality } from "../packages/core/dist/index.js";

const servers = [];
const tmpdirs = [];
after(async () => {
  for (const s of servers) {
    try {
      await s.stop?.();
    } catch {
      /* Windows EPERM during cleanup — leave the temp directory */
    }
  }
  await new Promise((r) => setTimeout(r, 1200));
  for (const d of tmpdirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* the temp directory stays in %TEMP% */
    }
  }
});

const tmp = (prefix) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpdirs.push(d);
  return d;
};

const run = (args, env = {}, timeout = 90000) =>
  spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout,
  });

const GOOD_DESC =
  "Demo artifact for test-kit checks. Use when the tester runs the kit. Do not use in production.";
const skillMd = (name) =>
  `---\nname: ${name}\ndescription: ${GOOD_DESC}\n---\n\n# ${name}\n\nBody.\n\n## Example\n\n\`\`\`bash\nrun it\n\`\`\`\n`;

async function mk(env = {}) {
  const srv = await startServer(env, { prefix: "skillforge-tk-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  servers.push(srv);
  const U = {};
  U.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [
    ["alice", "contributor"],
    ["rita", "reviewer"],
    ["vera", "viewer"],
  ]) {
    await createUser(srv.base, U.admin.cookie, {
      username: u,
      password: `${u}-pw-123`,
      role,
    });
    U[u] = await login(srv.base, u, `${u}-pw-123`);
  }
  const api = (m, p, b, who = "alice", auth = undefined) =>
    rawApi(srv.base, m, p, b, auth ?? (who === "anon" ? {} : { cookie: U[who].cookie }));
  return { srv, api, U };
}

const mcpToken = async (api, who) => {
  const tok = await api("POST", "/api/v1/me/tokens", { name: `tk-${who}`, mcp: true }, who);
  assert.equal(tok.status, 201, JSON.stringify(tok.data));
  const token = tok.data.token ?? tok.data.api_token ?? tok.data.value;
  assert.ok(token, JSON.stringify(tok.data));
  return token;
};

test("seed:demo on an empty data-dir → refusal pointing to local:start, admin is not created", () => {
  const dir = tmp("skillforge-tk-seed-");
  const r = run(["--experimental-strip-types", "scripts/seed-demo.ts"], {
    SKILLFORGE_DATA_DIR: dir,
  });
  assert.notEqual(r.status, 0, `expected a refusal: ${r.stdout}\n${r.stderr}`);
  assert.match(`${r.stdout}\n${r.stderr}`, /local:start/i);
  const conn = new DatabaseSync(join(dir, "skillforge.db"));
  try {
    const n = conn.prepare("SELECT COUNT(*) AS n FROM users").get().n;
    assert.equal(Number(n), 0, "seed must not create users on an empty data-dir");
  } finally {
    conn.close();
  }
});

test("seed:demo refuses when NODE_ENV=production", () => {
  const dir = tmp("skillforge-tk-prod-");
  const r = run(["--experimental-strip-types", "scripts/seed-demo.ts"], {
    SKILLFORGE_DATA_DIR: dir,
    NODE_ENV: "production",
  });
  assert.notEqual(r.status, 0, `expected a refusal: ${r.stdout}\n${r.stderr}`);
  assert.match(`${r.stdout}\n${r.stderr}`, /production/i);
});

test("simulate-mvp is green on a seeded stand (login, team, batch, prohibitions)", async () => {
  const { srv, api, U } = await mk();
  // The stand is as after seed:demo — rev1/dev1/viewer1 + team alpha + a candidate.
  for (const [u, role] of [
    ["rev1", "reviewer"],
    ["dev1", "contributor"],
    ["viewer1", "viewer"],
  ]) {
    await createUser(srv.base, U.admin.cookie, {
      username: u,
      password: "demo-pass-1",
      role,
    });
  }
  const team = await api(
    "POST",
    "/api/v1/teams",
    { name: "alpha", lead: "dev1" },
    "admin",
  );
  assert.equal(team.status, 201, JSON.stringify(team.data));
  const member = await api(
    "POST",
    "/api/v1/teams/alpha/members",
    { username: "viewer1", role: "member" },
    "admin",
  );
  assert.ok([200, 201].includes(member.status), JSON.stringify(member.data));
  const pub = await api("POST", "/api/v1/artifacts", {
    type: "skill",
    files: toB64([{ path: "tk-cand/SKILL.md", content: skillMd("tk-cand") }]),
  });
  assert.equal(pub.status, 201, JSON.stringify(pub.data));

  const r = run(["scripts/simulate-mvp.mjs"], {
    SIMULATE_BASE_URL: srv.base,
    SIMULATE_ADMIN_PASSWORD: ADMIN_PASSWORD,
    SEED_DEMO_PASSWORD: "demo-pass-1",
  });
  assert.equal(r.status, 0, `simulate-mvp failed: ${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /summary: \d+\/\d+ passed/);
});

test("batch-transitions — limit 100, MCP ban, successful promote", async () => {
  const { api } = await mk();

  const items = Array.from({ length: 101 }, (_, i) => ({
    type: "skill",
    name: `nope-${i}`,
    to: "active",
  }));
  const tooBig = await api("POST", "/api/v1/lifecycle/batch-transitions", { items }, "rita");
  assert.equal(tooBig.status, 400, JSON.stringify(tooBig.data));

  const token = await mcpToken(api, "rita");
  const mcp = await api(
    "POST",
    "/api/v1/lifecycle/batch-transitions",
    { items: [{ type: "skill", name: "x", to: "active" }] },
    undefined,
    { token },
  );
  assert.equal(mcp.status, 403, JSON.stringify(mcp.data));
  assert.equal(mcp.data.error, "mcp_token_forbidden");

  const pub = await api("POST", "/api/v1/artifacts", {
    type: "skill",
    files: toB64([{ path: "tk-cand/SKILL.md", content: skillMd("tk-cand") }]),
  });
  assert.equal(pub.status, 201, JSON.stringify(pub.data));
  const ok = await api(
    "POST",
    "/api/v1/lifecycle/batch-transitions",
    { items: [{ type: "skill", name: "tk-cand", to: "active" }] },
    "rita",
  );
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.results?.[0]?.ok, true, JSON.stringify(ok.data));
});

test("skillforge doctor — env-only configuration → exit 0; without a registry → exit 3", async () => {
  const { srv } = await mk();
  const cfg = join(tmp("skillforge-tk-cfg-"), "config.json");

  const ok = run(["packages/cli/dist/index.js", "doctor"], {
    SKILLFORGE_CONFIG: cfg,
    SKILLFORGE_URL: srv.base,
  });
  assert.equal(ok.status, 0, `env-only doctor: ${ok.stdout}\n${ok.stderr}`);

  const missing = run(["packages/cli/dist/index.js", "doctor"], {
    SKILLFORGE_CONFIG: cfg,
    SKILLFORGE_URL: "",
  });
  assert.equal(missing.status, 3, `no-registry doctor: ${missing.stdout}\n${missing.stderr}`);
});

test("Q_TOOLS_UNBOUNDED catches Bash(rm -rf:*), Bash(sudo …:*), Bash(rm *)", () => {
  const fm = (tools) =>
    `---\nname: demo\ndescription: ${GOOD_DESC}\nmodel: sonnet\ntools: ${tools}\n---\n\nBody.\n`;
  for (const tools of ["Bash(rm -rf:*)", "Bash(sudo apt-get:*)", "Bash(rm *)"]) {
    const r = parseArtifact({
      type: "agent",
      files: [{ path: "demo.md", content: fm(tools) }],
    });
    assert.ok(r.ok, JSON.stringify(r.errors));
    const q = assessQuality(r.artifact);
    assert.ok(
      q.checks.some((c) => c.code === "Q_TOOLS_UNBOUNDED"),
      `expected Q_TOOLS_UNBOUNDED for ${tools}: ${JSON.stringify(q.checks)}`,
    );
  }
});
