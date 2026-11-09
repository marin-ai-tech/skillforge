import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { buildSafeEnv, killProcessTree, spawnIsolated } from "../src/process-runner.ts";

const ATTACK_KEY = "SKILLFORGE_ATTACK_SECRET";
const ATTACK_VALUE = "sf-attack-secret-value-do-not-leak";

test("buildSafeEnv copies allowlisted PATH and scrubs SKILLFORGE_* even in extraNames", () => {
  const prev = process.env[ATTACK_KEY];
  process.env[ATTACK_KEY] = ATTACK_VALUE;
  try {
    assert.ok(process.env.PATH, "parent PATH must be set for this assertion");
    const env = buildSafeEnv([ATTACK_KEY, "PATH"]);
    assert.equal(env.PATH, process.env.PATH);
    assert.equal(env[ATTACK_KEY], undefined);
    assert.equal(
      Object.keys(env).some((k) => k.startsWith("SKILLFORGE_")),
      false,
    );
  } finally {
    if (prev === undefined) delete process.env[ATTACK_KEY];
    else process.env[ATTACK_KEY] = prev;
  }
});

test("spawnIsolated child does not see planted SKILLFORGE_* secret (attack)", async () => {
  const prev = process.env[ATTACK_KEY];
  process.env[ATTACK_KEY] = ATTACK_VALUE;
  try {
    const result = await spawnIsolated(
      ["node", "-e", "process.stdout.write(JSON.stringify(process.env))"],
      {
        envNames: [ATTACK_KEY],
        timeoutS: 15,
        tempCwdPrefix: "skillforge-attack-",
      },
    );
    assert.equal(result.error, null, result.error ?? "spawn error");
    assert.equal(result.timedOut, false);
    assert.ok(result.stdout.length > 0, "child should print env JSON");
    assert.equal(
      result.stdout.includes(ATTACK_VALUE),
      false,
      "planted SKILLFORGE_* secret must not appear in child env output",
    );
    assert.equal(
      result.stdout.includes(ATTACK_KEY),
      false,
      "SKILLFORGE_* key name must not appear in child env output",
    );
    const parsed = JSON.parse(result.stdout) as Record<string, string>;
    assert.equal(parsed[ATTACK_KEY], undefined);
  } finally {
    if (prev === undefined) delete process.env[ATTACK_KEY];
    else process.env[ATTACK_KEY] = prev;
  }
});

test("buildSafeEnv scrubs SKILLFORGE_* case-insensitively", () => {
  const LOWER = "skillforge_lower_attack_secret";
  const MIXED = "SkillForge_Mixed_Attack";
  const prevL = process.env[LOWER];
  const prevM = process.env[MIXED];
  process.env[LOWER] = ATTACK_VALUE;
  process.env[MIXED] = ATTACK_VALUE;
  try {
    const env = buildSafeEnv([LOWER, MIXED, "PATH"]);
    for (const k of Object.keys(env)) {
      assert.equal(/^skillforge_/i.test(k), false, `key ${k} must not pass`);
    }
  } finally {
    if (prevL === undefined) delete process.env[LOWER];
    else process.env[LOWER] = prevL;
    if (prevM === undefined) delete process.env[MIXED];
    else process.env[MIXED] = prevM;
  }
});

test("spawnIsolated scrubs lowercase SKILLFORGE_* in options.env", async () => {
  const result = await spawnIsolated(
    ["node", "-e", "process.stdout.write(JSON.stringify(process.env))"],
    {
      env: { skillforge_probe_lower: ATTACK_VALUE, SkillForge_Probe_Mixed: ATTACK_VALUE },
      timeoutS: 15,
      tempCwdPrefix: "skillforge-attack-",
    },
  );
  assert.equal(result.error, null, result.error ?? "spawn error");
  const parsed = JSON.parse(result.stdout) as Record<string, string>;
  for (const k of Object.keys(parsed)) {
    assert.equal(/^skillforge_/i.test(k), false, `key ${k} must not reach the child`);
  }
  assert.equal(result.stdout.includes(ATTACK_VALUE), false);
});

test("spawnIsolated uses non-shell argv and returns ok for simple node -e", async () => {
  const result = await spawnIsolated(["node", "-e", "process.stdout.write('ok')"], {
    timeoutS: 15,
    tempCwdPrefix: "skillforge-ok-",
  });
  assert.equal(result.error, null, result.error ?? undefined);
  assert.equal(result.ok, true);
  assert.equal(result.stdout, "ok");
});

test(
  "killProcessTree: missing taskkill falls back to killing the child, no uncaught error",
  { skip: process.platform !== "win32" ? "Windows-only path (taskkill)" : false, timeout: 20_000 },
  async () => {
    const prevRoot = process.env.SystemRoot;
    process.env.SystemRoot = "C:/skillforge-no-such-windows-dir";
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    try {
      const exited = new Promise((resolve) => child.on("exit", resolve));
      killProcessTree(child);
      const winner = await Promise.race([
        exited.then(() => "exited"),
        new Promise((r) => setTimeout(() => r("timeout"), 10_000)),
      ]);
      assert.equal(winner, "exited", "child was not stopped by the fallback");
    } finally {
      if (prevRoot === undefined) delete process.env.SystemRoot;
      else process.env.SystemRoot = prevRoot;
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  },
);
