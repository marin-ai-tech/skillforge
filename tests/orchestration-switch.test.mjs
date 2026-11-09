// The orchestration loop (workflows/routines/hooks-runtime) is off by default:
// API → 403 feature_disabled, the scheduler does not start, health reports the flag,
// SKILLFORGE_ORCHESTRATION_ENABLED=true restores the previous behavior.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, api, login, createUser, toB64 } from "./lib/client.mjs";

const skillMd = (name) => `---\nname: ${name}\ndescription: Orchestration switch test\n---\n\n# ${name}\n`;

async function publishSkill(base, cookie, name = "orch-flag") {
  const r = await api(base, "POST", "/api/v1/artifacts", {
    type: "skill",
    version: "0.1.0",
    files: toB64([{ path: `${name}/SKILL.md`, content: skillMd(name) }]),
  }, { cookie });
  assert.equal(r.status, 201, JSON.stringify(r.data));
}

test("the orchestration loop is off by default: API 403 feature_disabled, health=false", async () => {
  const srv = await startServer({}, { prefix: "skillforge-orch-off-" });
  assert.ok(srv.up, JSON.stringify({ stdout: srv.stdout, stderr: srv.stderr }));
  try {
    const admin = await login(srv.base, "admin", "test-admin-pw");
    await publishSkill(srv.base, admin.cookie);
    const rita = await createUser(srv.base, admin.cookie, {
      username: "rita",
      password: "rita-pw-123",
      role: "contributor",
    });
    const rc = (await login(srv.base, "rita", "rita-pw-123")).cookie;
    assert.equal(rita.username, "rita");

    const health = await api(srv.base, "GET", "/api/v1/health");
    assert.equal(health.data.orchestration_enabled, false);

    const wf = await api(
      srv.base,
      "GET",
      "/api/v1/artifacts/skill/orch-flag/workflows",
      undefined,
      { cookie: rc },
    );
    assert.equal(wf.status, 403, JSON.stringify(wf.data));
    assert.equal(wf.data.error, "feature_disabled");

    const wfPut = await api(
      srv.base,
      "PUT",
      "/api/v1/artifacts/skill/orch-flag/workflows/pipe",
      { definition: { version: 1, steps: [] } },
      { cookie: admin.cookie },
    );
    assert.equal(wfPut.status, 403);
    assert.equal(wfPut.data.error, "feature_disabled");

    const rt = await api(
      srv.base,
      "GET",
      "/api/v1/artifacts/skill/orch-flag/routines",
      undefined,
      { cookie: rc },
    );
    assert.equal(rt.status, 403);
    assert.equal(rt.data.error, "feature_disabled");

    // hooks-runtime is off even for admin
    const hooks = await api(
      srv.base,
      "GET",
      "/api/v1/hooks/subscriptions",
      undefined,
      { cookie: admin.cookie },
    );
    assert.equal(hooks.status, 403);
    assert.equal(hooks.data.error, "feature_disabled");

    const evaluate = await api(
      srv.base,
      "POST",
      "/api/v1/hooks/evaluate",
      { type: "skill", name: "orch-flag", event: "publish" },
      { cookie: admin.cookie },
    );
    assert.equal(evaluate.status, 403);
    assert.equal(evaluate.data.error, "feature_disabled");
  } finally {
    await srv.stop();
  }
});

test("SKILLFORGE_ORCHESTRATION_ENABLED=true: the loop works, health=true", async () => {
  const srv = await startServer(
    { SKILLFORGE_ORCHESTRATION_ENABLED: "true" },
    { prefix: "skillforge-orch-on-" },
  );
  assert.ok(srv.up, JSON.stringify({ stdout: srv.stdout, stderr: srv.stderr }));
  try {
    const admin = await login(srv.base, "admin", "test-admin-pw");
    await publishSkill(srv.base, admin.cookie);

    const health = await api(srv.base, "GET", "/api/v1/health");
    assert.equal(health.data.orchestration_enabled, true);

    const wf = await api(
      srv.base,
      "PUT",
      "/api/v1/artifacts/skill/orch-flag/workflows/pipe",
      {
        definition: {
          version: 1,
          name: "pipe",
          steps: [{ id: "one", kind: "command", argv: [process.execPath, "-e", "console.log('x')"] }],
        },
      },
      { cookie: admin.cookie },
    );
    assert.equal(wf.status, 200, JSON.stringify(wf.data));

    const hooks = await api(
      srv.base,
      "GET",
      "/api/v1/hooks/subscriptions",
      undefined,
      { cookie: admin.cookie },
    );
    assert.equal(hooks.status, 200, JSON.stringify(hooks.data));
  } finally {
    await srv.stop();
  }
});
