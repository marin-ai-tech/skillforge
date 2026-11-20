import type { VersionListItem } from "../api/types.ts";

/** Where a version of an artifact is now: its channel, or "deleted" once it was purged. */
export type SourceVersionChannel = "beta" | "stable" | "deleted";

/**
 * The current place of `version` in the artifact's version list; null when the list does not have it. A tracked-source
 * check stores the version it published, so its channel at that moment is not its channel now.
 */
export function sourceVersionChannel(
  version: string,
  versions: readonly Pick<VersionListItem, "version" | "channel" | "purged">[],
): SourceVersionChannel | null {
  const item = versions.find((v) => v.version === version);
  if (!item) return null;
  if (item.purged) return "deleted";
  return item.channel;
}
