import { loadConfig } from "./config.ts";
import { buildApp } from "./app.ts";
import { createLogger } from "./logging.ts";
import { watchProcessExit, type CrashKind } from "./process-exit.ts";

/** Set once the log exists: a failed start is recorded there too (fix-server-exit-reason). */
let recordCrash: ((kind: CrashKind, e: unknown) => void) | undefined;

async function main(): Promise<void> {
  const config = loadConfig();
  const running: { app?: Awaited<ReturnType<typeof buildApp>> } = {};
  recordCrash = watchProcessExit(createLogger(config.dataDir), async () => {
    await running.app?.close();
  }).crashed;

  const app = await buildApp(config);
  running.app = app;
  await app.listen({ host: config.host, port: config.port });
  console.log(`SkillForge listening on ${config.baseUrl}`);
}

try {
  await main();
} catch (e) {
  console.error(e);
  if (recordCrash) recordCrash("start_failed", e);
  else process.exit(1);
}
