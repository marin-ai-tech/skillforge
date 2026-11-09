import { readFileSync, rmSync, existsSync } from "node:fs";
import { STATE_FILE } from "./state.ts";

export default async function globalTeardown() {
  if (!existsSync(STATE_FILE)) return;
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as { pid: number; dataDir: string };
  try {
    process.kill(state.pid);
  } catch {
    /* already gone */
  }
  await new Promise((r) => setTimeout(r, 500));
  rmSync(state.dataDir, { recursive: true, force: true });
  rmSync(STATE_FILE, { force: true });
}
