import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  emitPluginEvent,
  resetPluginEventHandlers,
  subscribePluginEvent,
  unsubscribePlugin,
} from "../src/plugins/events.ts";
import { pluginRegistry } from "../src/plugins/registry.ts";
import { buildApp } from "../src/app.ts";
import type { AppConfig } from "../src/config.ts";
import { TEST_ADMIN_PASSWORD } from "./helpers.ts";

function waitTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("unsubscribePlugin removes handlers so emit does not invoke them", async () => {
  resetPluginEventHandlers();
  pluginRegistry.reset();
  let ran = 0;
  subscribePluginEvent("leaky", "server.started", () => {
    ran += 1;
  });
  subscribePluginEvent("hello", "server.started", () => {
    ran += 10;
  });
  unsubscribePlugin("leaky");
  emitPluginEvent({ type: "server.started", at: new Date().toISOString(), version: "0.0.0" });
  await waitTick();
  assert.equal(ran, 10, "only hello handler should run");
  resetPluginEventHandlers();
  pluginRegistry.reset();
});

test("after register() throws, plugin event handlers are rolled back and not invoked", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-plug-rb-"));
  const pluginsDir = path.join(dataDir, "plugins");
  const leakyDir = path.join(pluginsDir, "leaky");
  fs.mkdirSync(leakyDir, { recursive: true });
  fs.writeFileSync(
    path.join(leakyDir, "skillforge-plugin.json"),
    JSON.stringify({
      name: "leaky",
      version: "1.0.0",
      api: 1,
      description: "leaky",
      capabilities: [],
    }),
    "utf8",
  );
  const marker = path.join(leakyDir, "RAN.txt");
  fs.writeFileSync(
    path.join(leakyDir, "index.js"),
    `import { writeFileSync } from "node:fs";
import { join } from "node:path";
export function register(ctx) {
  ctx.events.on("server.started", () => {
    writeFileSync(join(ctx.dir, "RAN.txt"), "ran");
  });
  ctx.events.on("artifact.published", () => {
    writeFileSync(join(ctx.dir, "RAN.txt"), "ran");
  });
  throw new Error("boom after subscribing");
}
`,
    "utf8",
  );

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
    importGit: true,
    importAllowFileUrls: false,
    importTtlMinutes: 15,
    marketplaceName: "skillforge",
    marketplaceOwner: "SkillForge",
    backupKeep: 10,
    pluginsDir,
    pluginsDisabled: false,
  };

  const app = await buildApp(config);
  try {
    const state = pluginRegistry.get("leaky");
    assert.ok(state);
    assert.equal(state.status, "error");
    assert.ok(state.error?.includes("boom after subscribing"));
    assert.deepEqual(
      {
        routes: state.contributions.routes,
        nav: state.contributions.nav,
        tabs: state.contributions.tabs,
        events: state.contributions.events,
      },
      { routes: 0, nav: 0, tabs: 0, events: [] },
    );
    // onReady already emitted server.started during listen/ready; give handlers a tick
    await waitTick();
    await waitTick();
    assert.ok(!fs.existsSync(marker), "rolled-back handler must not create RAN.txt");
  } finally {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    resetPluginEventHandlers();
    pluginRegistry.reset();
  }
});
