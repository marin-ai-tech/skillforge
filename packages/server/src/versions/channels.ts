import { bumpRegistryEpoch } from "../registry-epoch.ts";
import semver from "semver";
import { parseVersionSpec } from "@skillforge/core";
import { maxSemver, type Database } from "../repo.ts";

export const CHANNELS = ["stable", "beta"] as const;
export type Channel = (typeof CHANNELS)[number];

export type ChannelEntry = { version: string; digest: string; channel: Channel };

export function isChannel(value: unknown): value is Channel {
  return typeof value === "string" && (CHANNELS as readonly string[]).includes(value);
}

export function defaultChannel(version: string): Channel {
  return semver.prerelease(version) ? "beta" : "stable";
}

/** A pre-release version may only live in `beta`; any version may be `beta`. */
export function channelAllowed(version: string, channel: Channel): boolean {
  return channel === "beta" || semver.prerelease(version) === null;
}

/** Channel requested at publish time; null means `channel_invalid`. */
export function publishChannel(raw: unknown, version: string): Channel | null {
  if (raw === undefined || raw === null) return defaultChannel(version);
  return isChannel(raw) && channelAllowed(version, raw) ? raw : null;
}

export function listChannelEntries(db: Database, artifactId: string): ChannelEntry[] {
  const rows = db
    .prepare(
      "SELECT version, digest, channel FROM artifact_versions WHERE artifact_id = ? AND purged_at IS NULL",
    )
    .all(artifactId) as Array<{ version: string; digest: string; channel: string }>;
  return rows.map((r) => ({
    version: r.version,
    digest: r.digest,
    channel: isChannel(r.channel) ? r.channel : defaultChannel(r.version),
  }));
}

/** Max stable version; when there is no stable version, max over all channels. */
export function latestOf(
  entries: ReadonlyArray<{ version: string; channel: Channel }>,
): string | null {
  const stable = entries.filter((e) => e.channel === "stable").map((e) => e.version);
  return maxSemver(stable) ?? maxSemver(entries.map((e) => e.version));
}

/** Recompute and store `artifacts.latest_version`; caller owns the transaction. */
export function recomputeLatest(db: Database, artifactId: string): string | null {
  const latest = latestOf(listChannelEntries(db, artifactId));
  db.prepare("UPDATE artifacts SET latest_version = ? WHERE id = ?").run(latest, artifactId);
  bumpRegistryEpoch();
  return latest;
}

export function channelHeads(
  entries: readonly ChannelEntry[],
): Record<Channel, { version: string; digest: string } | null> {
  const head = (channel: Channel) => {
    const version = maxSemver(entries.filter((e) => e.channel === channel).map((e) => e.version));
    const entry = entries.find((e) => e.version === version);
    return entry ? { version: entry.version, digest: entry.digest } : null;
  };
  return { stable: head("stable"), beta: head("beta") };
}

export type SpecResolution =
  { kind: "invalid" } | { kind: "none" } | { kind: "ok"; entry: ChannelEntry };

/** Ranges resolve over stable versions only; `beta` is the max over all channels. */
export function resolveSpec(raw: unknown, entries: readonly ChannelEntry[]): SpecResolution {
  const spec = parseVersionSpec(raw);
  if (!spec) return { kind: "invalid" };
  let version: string | null;
  switch (spec.kind) {
    case "latest":
      version = latestOf(entries);
      break;
    case "beta":
      version = maxSemver(entries.map((e) => e.version));
      break;
    case "exact":
      version = spec.version;
      break;
    case "range":
      version = semver.maxSatisfying(
        entries.filter((e) => e.channel === "stable").map((e) => e.version),
        spec.range,
      );
      break;
  }
  const entry = version === null ? undefined : entries.find((e) => e.version === version);
  return entry ? { kind: "ok", entry } : { kind: "none" };
}
