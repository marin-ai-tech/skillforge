import semver from "semver";
import {
  isArtifactType,
  splitFrontmatter,
  validateName,
  type ArtifactType,
} from "@skillforge/core";

/**
 * agent-source-marker: a file built from a registry artifact (for example an sdlc role agent built from `agent/<role>`)
 * says so in its front matter — `skillforge-source: <type>/<name>@<version>`. The marker is the builder's claim; the
 * comparison trusts it only for an artifact the viewer can see.
 */
export type SourceMarker = { type: ArtifactType; name: string; version: string };

export const SOURCE_MARKER_KEY = "skillforge-source";
const MARKER_RE = /^([a-z][a-z-]*)\/([^@\s]+)@(\S+)$/;

export function parseSourceMarker(raw: unknown): SourceMarker | null {
  if (typeof raw !== "string") return null;
  const m = MARKER_RE.exec(raw.trim());
  if (!m) return null;
  const [, type, name, version] = m;
  if (!isArtifactType(type!) || !validateName(name!) || semver.valid(version!) === null)
    return null;
  return { type: type as ArtifactType, name: name!, version: version! };
}

/** The main Markdown file of a scanned artifact: `SKILL.md` for a skill, otherwise its only `.md` file. */
function mainMarkdown(
  type: string,
  files: ReadonlyArray<{ path: string; content: string | Uint8Array }>,
): string | null {
  const main =
    type === "skill"
      ? files.find((f) => f.path === "SKILL.md" || f.path.endsWith("/SKILL.md"))
      : files.find((f) => f.path.endsWith(".md"));
  if (!main) return null;
  return typeof main.content === "string"
    ? main.content
    : Buffer.from(main.content).toString("utf8");
}

export function sourceMarkerOf(
  type: string,
  files: ReadonlyArray<{ path: string; content: string | Uint8Array }>,
): SourceMarker | null {
  const text = mainMarkdown(type, files);
  if (text === null) return null;
  return parseSourceMarker(splitFrontmatter(text).frontmatter?.[SOURCE_MARKER_KEY]);
}

/** The stored form (JSON of SourceMarker) back to a marker; anything else is no marker. */
export function parseSourceMarkerJson(raw: string): SourceMarker | null {
  try {
    const v = JSON.parse(raw) as Partial<SourceMarker> | null;
    return v ? parseSourceMarker(`${v.type}/${v.name}@${v.version}`) : null;
  } catch {
    return null;
  }
}
