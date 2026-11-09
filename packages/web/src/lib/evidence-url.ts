/**
 * An evidence URL is rendered as a link only for `http(s)://host…` or a registry path `/…`.
 * Anything else (`javascript:`, `data:`, `//host`, `/\host`, control characters) stays plain text.
 */
export function isSafeEvidenceHref(url: string): boolean {
  if (url.length === 0 || url.length > 2048) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0020\u007f\\]/.test(url)) return false;
  if (url.startsWith("/")) return !url.startsWith("//");
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.length > 0;
  } catch {
    return false;
  }
}

export function formatTransferRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return "—";
  return `${Math.round(rate * 1000) / 10}%`;
}
