import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app.ts";
import type { AppConfig } from "../src/config.ts";

export const TEST_ADMIN_PASSWORD = "test-admin-pw";

export function makeConfig(overrides: Partial<AppConfig> = {}): {
  config: AppConfig;
  dataDir: string;
  cleanup: () => void;
} {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-test-"));
  const config: AppConfig = {
    port: 0,
    host: "127.0.0.1",
    dataDir,
    baseUrl: "http://127.0.0.1:0",
    webDir: path.join(dataDir, "missing-web"),
    adminPassword: TEST_ADMIN_PASSWORD,
    publicRead: true,
    sessionTtlDays: 30,
    agingDays: 90,
    candidateTtlDays: 30,
    dataLifecycleEnabled: true,
    zombieIdleDays: 180,
    zombieWindowDays: 60,
    zombieMinUses: 20,
    zombieMinReporters: 3,
    zombieTransferRate: 0.2,
    zombieRetireDays: 30,
    ablationMinTasks: 10,
    reviveWindowDays: 14,
    reviveMinEvents: 3,
    lifecycleMaxPerSweep: 20,
    importGit: true,
    importAllowFileUrls: false,
    importTtlMinutes: 15,
    marketplaceName: "skillforge",
    marketplaceOwner: "SkillForge",
    backupKeep: 10,
    pluginsDir: path.join(dataDir, "plugins"),
    pluginsDisabled: false,
    agentRoots: [],
    starterPacksDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../starter-packs"),
    orchestrationEnabled: true,
    routinesDisabled: false,
    hooksDisabled: false,
    safeErrors: false,
    ...overrides,
  };
  return {
    config,
    dataDir,
    cleanup: () => fs.rmSync(dataDir, { recursive: true, force: true }),
  };
}

export async function withApp(
  fn: (
    app: Awaited<ReturnType<typeof buildApp>>,
    dataDir: string,
    config: AppConfig,
  ) => Promise<void>,
  overrides: Partial<AppConfig> = {},
): Promise<void> {
  const { config, dataDir, cleanup } = makeConfig(overrides);
  const app = await buildApp(config);
  try {
    await fn(app, dataDir, config);
  } finally {
    await app.close();
    cleanup();
  }
}

export async function loginCookie(
  app: Awaited<ReturnType<typeof buildApp>>,
  username = "admin",
  password = TEST_ADMIN_PASSWORD,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { username, password },
  });
  if (res.statusCode !== 200) {
    throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  }
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const m = /sf_session=([^;]+)/.exec(raw ?? "");
  if (!m) throw new Error(`no sf_session cookie: ${raw}`);
  return `sf_session=${m[1]}`;
}
