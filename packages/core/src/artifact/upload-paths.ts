import { scanImportTree } from "./scan.ts";
import { secretFileReason } from "./secret-files.ts";

export type UploadPaths = { upload: string[]; notSent: string[] };

/**
 * Which files of an agent folder a client may send in a snapshot: exactly the files the server's scanner turns
 * into artifacts, plus `.claude-plugin/plugin.json` of each hook bundle (the bundle takes its name from it).
 * Claiming depends only on paths, so contents are not needed. Everything else stays on the machine.
 */
export function artifactUploadPaths(paths: readonly string[]): UploadPaths {
  const scanned = scanImportTree(paths.map((p) => ({ path: p, content: "" })));
  const skipped = new Set(scanned.skipped.map((s) => s.path));
  const manifests = new Set(
    scanned.candidates
      .filter((c) => c.type === "hook")
      .map((c) => (c.root ? `${c.root}/.claude-plugin/plugin.json` : ".claude-plugin/plugin.json")),
  );
  const upload: string[] = [];
  const notSent: string[] = [];
  for (const p of paths) {
    const norm = normalize(p);
    // A secret file never leaves the machine, even inside an artifact folder (publish-secret-files).
    if (secretFileReason(norm)) notSent.push(p);
    else if (!skipped.has(norm) || manifests.has(norm)) upload.push(p);
    else notSent.push(p);
  }
  return { upload, notSent };
}

/** Same normalization as the scanner: forward slashes, no leading `./`, no repeated slashes. */
function normalize(p: string): string {
  let out = p.replace(/\\/g, "/");
  while (out.startsWith("./")) out = out.slice(2);
  return out.replace(/\/+/g, "/");
}
