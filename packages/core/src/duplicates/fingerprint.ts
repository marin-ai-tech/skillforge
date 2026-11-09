import { sha256Hex } from "../digest.ts";
import { contentToString, extractFrontmatter } from "../artifact/frontmatter.ts";
import type { ArtifactType, ParsedArtifact } from "../artifact/types.ts";
import { artifactTypeDef } from "../artifact/index.ts";

/** Canonical path of the main file whose body identifies an artifact. */
export function mainFilePath(type: ArtifactType, name: string): string {
  return artifactTypeDef(type).mainFile(name);
}

/**
 * Normalizes a body for fingerprinting: `\n` line endings, no trailing whitespace on lines,
 * runs of blank lines collapsed to one, no leading or trailing blank lines.
 */
export function normalizeBody(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/[ \t\f\v]+$/u, "");
    if (line === "" && (out.length === 0 || out[out.length - 1] === "")) continue;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

/** sha256 of the normalized body; `withFrontmatter` strips a leading YAML block first. */
export function bodyFingerprint(text: string, opts: { withFrontmatter?: boolean } = {}): string {
  const body = opts.withFrontmatter === false ? text : extractFrontmatter(text).body;
  return sha256Hex(normalizeBody(body));
}

/** Fingerprint of a main file's content by artifact type (hooks: raw JSON text, no frontmatter). */
export function mainFileFingerprint(type: ArtifactType, content: string | Uint8Array): string {
  const text = contentToString(content);
  return bodyFingerprint(text, {
    withFrontmatter: type !== "hook" && type !== "plugin" && type !== "settings",
  });
}

/** Fingerprint of a parsed artifact's main file; null when the main file is absent. */
export function artifactBodyFingerprint(artifact: ParsedArtifact): string | null {
  const main = mainFilePath(artifact.type, artifact.name);
  const file = artifact.canonical.find((f) => f.path === main);
  if (!file) return null;
  return mainFileFingerprint(artifact.type, file.content);
}
