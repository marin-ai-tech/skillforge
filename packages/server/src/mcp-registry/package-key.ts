/**
 * Package identity for matching an MCP snapshot observation with a registry artifact
 * (mcp-version-tracking, decision 6). One key is used by registryIndex and mcpUsage.
 * The key is `${registryType}:${normalized}` so the same name in npm and pypi does not collide.
 */
/** Normalized package identifier (PEP 503 for pypi, OCI without digest). Not the index key. */
export function normalizedPackageName(registryType: string, identifier: string): string {
  if (registryType === "pypi") return identifier.toLowerCase().replace(/[-_.]+/g, "-");
  if (registryType === "oci") return identifier.replace(/@sha256:.*$/, "");
  return identifier;
}

export function packageKey(registryType: string, identifier: string): string {
  return `${registryType}:${normalizedPackageName(registryType, identifier)}`;
}

/** Registry type of a snapshot observation, from its launcher. */
export function registryTypeOfLauncher(launcher: string | null | undefined): string {
  if (launcher === "uvx" || launcher === "pipx") return "pypi";
  if (launcher === "docker" || launcher === "podman") return "oci";
  return "npm";
}

/** Digest in an OCI identifier (`image@sha256:…`), including the `sha256:` prefix, or null. */
export function ociDigest(identifier: string): string | null {
  const at = identifier.indexOf("@sha256:");
  return at >= 0 ? identifier.slice(at + 1) : null;
}

/** Package version the registry artifact declares: `server.json` version, or the OCI digest. */
export function packageVersion(
  registryType: string,
  identifier: string,
  declared: string | null,
): string | null {
  if (registryType === "oci") return ociDigest(identifier) ?? declared;
  return declared;
}
