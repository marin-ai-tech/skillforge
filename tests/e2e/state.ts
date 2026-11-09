import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const STATE_FILE = join(ROOT, "tests", "e2e", ".e2e-state.json");
export const FIXTURES = join(ROOT, "tests", "fixtures", "artifacts");
export const PORT = Number(process.env.E2E_PORT ?? 8790);
export const BASE = `http://127.0.0.1:${PORT}`;
