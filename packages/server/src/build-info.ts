import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The commit of a release build, from `build.json` next to the server's package.json (written by scripts/release.mjs);
 * null outside a release. Parsed down to 12 hex characters: this value is public in /api/v1/health.
 */
export function buildCommit(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  try {
    const raw = JSON.parse(readFileSync(path.resolve(here, "../build.json"), "utf8")) as {
      commit?: unknown;
    };
    return typeof raw.commit === "string" && /^[0-9a-f]{12}$/.test(raw.commit) ? raw.commit : null;
  } catch {
    return null;
  }
}
