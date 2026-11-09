import semver from "semver";

export const VERSION_SPEC_MAX_LENGTH = 64;

export type VersionSpec =
  | { kind: "latest" }
  | { kind: "beta" }
  | { kind: "exact"; version: string }
  | { kind: "range"; range: string };

const RANGE_TOKEN = /^[0-9A-Za-z.+\-^~<>=*|]+$/;

/**
 * Strict grammar for version specs (resolve `spec`, lock `pin`):
 * `latest`, `beta`, exact `1.2.3` / `=1.2.3`, or a semver range of single-space separated tokens.
 */
export function parseVersionSpec(raw: unknown): VersionSpec | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > VERSION_SPEC_MAX_LENGTH) {
    return null;
  }
  if (raw === "latest") return { kind: "latest" };
  if (raw === "beta") return { kind: "beta" };
  const bare = raw.startsWith("=") ? raw.slice(1) : raw;
  if (semver.valid(bare) === bare) return { kind: "exact", version: bare };
  if (!raw.split(" ").every((token) => RANGE_TOKEN.test(token))) return null;
  if (semver.validRange(raw) === null) return null;
  return { kind: "range", range: raw };
}

/** True when both are valid semver and `a` has higher precedence than `b`. */
export function semverGreater(a: string, b: string): boolean {
  if (semver.valid(a) === null || semver.valid(b) === null) return false;
  return semver.gt(a, b);
}

/** Moving from `installed` to `wanted` lowers the semver precedence. */
export function isDowngrade(installed: string, wanted: string): boolean {
  return semverGreater(installed, wanted);
}
