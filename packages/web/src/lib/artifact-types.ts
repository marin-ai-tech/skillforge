/**
 * Artifact type ids shown while `GET /api/v1/artifact-types` is still loading. One list for
 * every page; `tests/web-type-fallback.test.mjs` keeps it equal to `ARTIFACT_TYPES` of the core.
 */
export const FALLBACK_TYPE_IDS = [
  "skill",
  "command",
  "agent",
  "hook",
  "plugin",
  "settings",
  "mcp-server",
] as const;

export type ArtifactType = (typeof FALLBACK_TYPE_IDS)[number];
