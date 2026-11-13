import { defineConfig } from "@playwright/test";

// E2E circuit: tests/e2e/global-setup.ts starts the built server on E2E_PORT (8790)
// with a temporary data directory and publishes the fixtures from tests/fixtures/artifacts/.
const port = Number(process.env.E2E_PORT ?? 8790);

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
    // The sandbox container has a small /dev/shm (256 MB): shared memory goes to temporary files instead, so a page
    // does not crash when it runs out.
    launchOptions: { args: ["--disable-dev-shm-usage"] },
  },
  // Default project is chromium; the Edge-channel run is opt-in (E2E_EDGE=1) because
  // stateful specs share one seeded stand — running them twice per suite fails on
  // second-project state.
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    ...(process.env.E2E_EDGE === "1"
      ? [{ name: "msedge", use: { browserName: "chromium" as const, channel: "msedge" } }]
      : []),
  ],
});
