// How marketplace.json tells Claude Code (>= 2.1.288) to fetch a plugin.
// `archive`: zip over https from a host the client may download from; `command`: the client runs
// `skillforge plugin-dir …`, which prints a ready plugin directory (works for http / loopback stands).
import { isIP } from "node:net";

export type MarketplaceSource = "archive" | "command";

/** Cloud metadata host names the client refuses for archive downloads. */
const METADATA_HOSTS = new Set([
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "instance-data.ec2.internal",
]);

/** Literal IPv4 addresses the client treats as metadata endpoints. */
const METADATA_IPV4 = new Set(["100.100.100.200", "168.63.129.16"]);

function blockedIpv4(host: string): boolean {
  if (METADATA_IPV4.has(host)) return true;
  const [a = 0, b = 0] = host.split(".").map(Number);
  return a === 127 || a === 0 || (a === 169 && b === 254);
}

function blockedIpv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "::" || h === "::1") return true;
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true; // fe80::/10 link-local
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  if (dotted) return blockedIpv4(dotted[1]!);
  // WHATWG URL rewrites ::ffff:127.0.0.1 as ::ffff:7f00:1
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (!hex) return false;
  const hi = parseInt(hex[1]!, 16);
  const lo = parseInt(hex[2]!, 16);
  return blockedIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
}

/** True when Claude Code would refuse to download an `archive` plugin from this host. */
export function blockedArchiveHost(hostname: string): boolean {
  let host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host === "" || host === "localhost" || host.endsWith(".localhost")) return true;
  if (METADATA_HOSTS.has(host)) return true;
  if (host.startsWith("instance-data.") && host.endsWith(".compute.internal")) return true;
  const ip = isIP(host);
  if (ip === 4) return blockedIpv4(host);
  if (ip === 6) return blockedIpv6(host);
  return false;
}

/** `archive` needs https and a host the client may download from. */
export function archiveEligible(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl);
    return u.protocol === "https:" && !blockedArchiveHost(u.hostname);
  } catch {
    return false;
  }
}

/**
 * The base URL goes unquoted into a command run by cmd.exe or sh: allow only characters that
 * neither shell treats specially.
 */
export function commandSafeBaseUrl(baseUrl: string): boolean {
  return /^https?:\/\/[A-Za-z0-9.:/_~-]+$/.test(baseUrl.replace(/\/+$/, ""));
}

/** SKILLFORGE_MARKETPLACE_SOURCE (auto | archive | command) → the source used; null when invalid. */
export function resolveMarketplaceSource(
  raw: string | undefined,
  baseUrl: string,
): MarketplaceSource | null {
  const mode = raw === undefined || raw === "" ? "auto" : raw;
  if (mode === "archive") return archiveEligible(baseUrl) ? "archive" : null;
  if (mode === "auto" && archiveEligible(baseUrl)) return "archive";
  if (mode !== "auto" && mode !== "command") return null;
  return commandSafeBaseUrl(baseUrl) ? "command" : null;
}

/**
 * Defence in depth for the `command` source: publish already restricts names (kebab-case) and versions
 * (strict semver), but the parts go unquoted into a shell, so an entry outside this charset is never listed.
 */
export function shellSafeEntry(type: string, name: string, version: string): boolean {
  return /^[a-z]+$/.test(type) && /^[a-z0-9-]+$/.test(name) && /^[0-9A-Za-z.+-]+$/.test(version);
}

/** The command a `command` source runs; `base` has no trailing slash. */
export function pluginDirCommand(
  base: string,
  type: string,
  name: string,
  version: string,
): string {
  return `skillforge plugin-dir ${type}/${name}@${version} --url ${base}`;
}
