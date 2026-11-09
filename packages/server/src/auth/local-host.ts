const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

/** True when Host header is a loopback name (with or without port). */
export function isLoopbackHostHeader(hostHeader: string | undefined | null): boolean {
  if (!hostHeader) return false;
  let host = hostHeader.trim().toLowerCase();
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end > 0) {
      const name = host.slice(1, end);
      return LOOPBACK.has(name);
    }
  }
  // Strip :port for IPv4/hostname (not IPv6 without brackets in Host)
  const colon = host.lastIndexOf(":");
  if (colon > 0 && host.indexOf(":") === colon) {
    host = host.slice(0, colon);
  }
  return LOOPBACK.has(host);
}
