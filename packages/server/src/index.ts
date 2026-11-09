import { loadConfig } from "./config.ts";
import { buildApp } from "./app.ts";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp(config);

  const shutdown = async () => {
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

  await app.listen({ host: config.host, port: config.port });
  console.log(`SkillForge listening on ${config.baseUrl}`);
}

try {
  await main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
