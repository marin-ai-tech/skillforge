import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseConfig, ConfigError } from "../src/config.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const CONFIG_SRC = path.resolve(HERE, "../src/config.ts");
const SERVER_DIST = path.resolve(HERE, "../dist/index.js");

test("parseConfig: defaults", () => {
  const cfg = parseConfig({});
  assert.equal(cfg.port, 8787);
  assert.equal(cfg.host, "127.0.0.1");
  assert.ok(cfg.dataDir.length > 0);
  assert.equal(cfg.baseUrl, "http://127.0.0.1:8787");
  assert.ok(cfg.webDir.includes("web"));
  assert.equal(cfg.adminPassword, null);
  assert.equal(cfg.publicRead, true);
  assert.equal(cfg.sessionTtlDays, 30);
});

test("parseConfig: overrides including auth env", () => {
  const cfg = parseConfig({
    SKILLFORGE_PORT: "19000",
    SKILLFORGE_HOST: "0.0.0.0",
    SKILLFORGE_DATA_DIR: "C:\\tmp\\sf-data",
    SKILLFORGE_BASE_URL: "http://example.test:19000",
    SKILLFORGE_WEB_DIR: "C:\\tmp\\sf-web",
    SKILLFORGE_ADMIN_PASSWORD: "secret",
    SKILLFORGE_PUBLIC_READ: "false",
    SKILLFORGE_SESSION_TTL_DAYS: "7",
  });
  assert.equal(cfg.port, 19000);
  assert.equal(cfg.host, "0.0.0.0");
  assert.ok(cfg.dataDir.includes("sf-data"));
  assert.equal(cfg.baseUrl, "http://example.test:19000");
  assert.ok(cfg.webDir.includes("sf-web"));
  assert.equal(cfg.adminPassword, "secret");
  assert.equal(cfg.publicRead, false);
  assert.equal(cfg.sessionTtlDays, 7);
});

test("parseConfig: empty admin password is null", () => {
  const cfg = parseConfig({ SKILLFORGE_ADMIN_PASSWORD: "" });
  assert.equal(cfg.adminPassword, null);
});

test("parseConfig: invalid port throws ConfigError with variable name", () => {
  assert.throws(
    () => parseConfig({ SKILLFORGE_PORT: "abc" }),
    (err: unknown) => err instanceof ConfigError && err.variable === "SKILLFORGE_PORT",
  );
});

test("parseConfig: PUBLIC_READ=maybe throws naming variable", () => {
  assert.throws(
    () => parseConfig({ SKILLFORGE_PUBLIC_READ: "maybe" }),
    (err: unknown) => err instanceof ConfigError && err.variable === "SKILLFORGE_PUBLIC_READ",
  );
});

test("loadConfig via process: invalid port exits non-zero and names variable", async () => {
  const importUrl = pathToFileURL(CONFIG_SRC).href;
  const script = `import { loadConfig } from ${JSON.stringify(importUrl)}; loadConfig({ SKILLFORGE_PORT: "abc" });`;
  const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      cwd: ROOT,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.on("exit", (code) => resolve({ code, stderr }));
  });
  assert.notEqual(result.code, 0);
  assert.ok(
    result.stderr.includes("SKILLFORGE_PORT"),
    `stderr missing SKILLFORGE_PORT: ${result.stderr}`,
  );
});

test("server dist: invalid SKILLFORGE_PORT exits non-zero", async () => {
  const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [SERVER_DIST], {
      cwd: ROOT,
      env: { ...process.env, SKILLFORGE_PORT: "abc", SKILLFORGE_DATA_DIR: path.join(ROOT, "data") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.on("exit", (code) => resolve({ code, stderr }));
  });
  assert.notEqual(result.code, 0);
  assert.ok(result.stderr.includes("SKILLFORGE_PORT"), result.stderr);
});

test("parseConfig: aging and candidate TTL defaults", () => {
  const cfg = parseConfig({});
  assert.equal(cfg.agingDays, 90);
  assert.equal(cfg.candidateTtlDays, 30);
});

test("parseConfig: aging overrides and invalid names variable", () => {
  const cfg = parseConfig({ SKILLFORGE_AGING_DAYS: "0", SKILLFORGE_CANDIDATE_TTL_DAYS: "7" });
  assert.equal(cfg.agingDays, 0);
  assert.equal(cfg.candidateTtlDays, 7);
  assert.throws(
    () => parseConfig({ SKILLFORGE_AGING_DAYS: "soon" }),
    (err: unknown) => err instanceof ConfigError && err.variable === "SKILLFORGE_AGING_DAYS",
  );
  assert.throws(
    () => parseConfig({ SKILLFORGE_CANDIDATE_TTL_DAYS: "-1" }),
    (err: unknown) =>
      err instanceof ConfigError && err.variable === "SKILLFORGE_CANDIDATE_TTL_DAYS",
  );
});

test("parseConfig: marketplace defaults and validation", () => {
  const cfg = parseConfig({});
  assert.equal(cfg.marketplaceName, "skillforge");
  assert.equal(cfg.marketplaceOwner, "SkillForge");
  const custom = parseConfig({
    SKILLFORGE_MARKETPLACE_NAME: "acme-skills",
    SKILLFORGE_MARKETPLACE_OWNER: "ACME Platform Team",
  });
  assert.equal(custom.marketplaceName, "acme-skills");
  assert.equal(custom.marketplaceOwner, "ACME Platform Team");
  assert.throws(
    () => parseConfig({ SKILLFORGE_MARKETPLACE_NAME: "My Market" }),
    (err: unknown) => err instanceof ConfigError && err.variable === "SKILLFORGE_MARKETPLACE_NAME",
  );
  assert.throws(
    () => parseConfig({ SKILLFORGE_MARKETPLACE_OWNER: "x".repeat(121) }),
    (err: unknown) => err instanceof ConfigError && err.variable === "SKILLFORGE_MARKETPLACE_OWNER",
  );
});

test("parseConfig: backupKeep default and validation", () => {
  const cfg = parseConfig({});
  assert.equal(cfg.backupKeep, 10);
  assert.equal(parseConfig({ SKILLFORGE_BACKUP_KEEP: "3" }).backupKeep, 3);
  assert.throws(
    () => parseConfig({ SKILLFORGE_BACKUP_KEEP: "abc" }),
    (err: unknown) => err instanceof ConfigError && err.variable === "SKILLFORGE_BACKUP_KEEP",
  );
  assert.throws(
    () => parseConfig({ SKILLFORGE_BACKUP_KEEP: "0" }),
    (err: unknown) => err instanceof ConfigError && err.variable === "SKILLFORGE_BACKUP_KEEP",
  );
  assert.throws(
    () => parseConfig({ SKILLFORGE_BACKUP_KEEP: "-1" }),
    (err: unknown) => err instanceof ConfigError && err.variable === "SKILLFORGE_BACKUP_KEEP",
  );
});

test("parseConfig: pluginsDir defaults under dataDir and can be overridden", () => {
  const cfg = parseConfig({ SKILLFORGE_DATA_DIR: "C:\\tmp\\sf-data" });
  assert.ok(cfg.pluginsDir.replace(/\\/g, "/").endsWith("/plugins"));
  assert.ok(cfg.pluginsDir.includes("sf-data"));
  assert.equal(cfg.pluginsDisabled, false);
  const off = parseConfig({ SKILLFORGE_PLUGINS_DISABLED: "true" });
  assert.equal(off.pluginsDisabled, true);
  const custom = parseConfig({ SKILLFORGE_PLUGINS_DIR: "C:\\tmp\\my-plugins" });
  assert.ok(custom.pluginsDir.includes("my-plugins"));
});

test("parseConfig: PLUGINS_DISABLED=maybe throws naming variable", () => {
  assert.throws(
    () => parseConfig({ SKILLFORGE_PLUGINS_DISABLED: "maybe" }),
    (err: unknown) => err instanceof ConfigError && err.variable === "SKILLFORGE_PLUGINS_DISABLED",
  );
});
