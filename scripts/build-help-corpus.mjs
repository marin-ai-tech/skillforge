#!/usr/bin/env node
// Copies the help topics into the built web app (dist/help-corpus/<lang>) so the server can put them into the
// assistant's context without the web sources: `topics` as `en`, every `topics-<lang>` as `<lang>`. Runs after
// `vite build` (packages/web build script).
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HELP = join(ROOT, "packages", "web", "src", "help");
const OUT = join(ROOT, "packages", "web", "dist", "help-corpus");

rmSync(OUT, { recursive: true, force: true });
const translated = readdirSync(HELP).filter((n) => n.startsWith("topics-") && !n.endsWith(".ts"));
for (const [lang, dir] of [
  ["en", "topics"],
  ...translated.map((n) => [n.slice("topics-".length), n]),
]) {
  const src = join(HELP, dir);
  if (!existsSync(src)) throw new Error(`help topics not found: ${src}`);
  cpSync(src, join(OUT, lang), { recursive: true });
}
console.log(`help corpus: ${OUT}`);
