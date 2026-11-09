/** Validate post-login redirect: relative path starting with / but not //. */
export function safeNextPath(raw: string | null | undefined): string {
  if (raw === null || raw === undefined || raw === "") return "/";
  let s = "";
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    const ch = raw[i]!;
    if (code <= 0x1f || code === 0x7f || ch === "\\") {
      s += "/";
    } else {
      s += ch;
    }
  }
  if (!s.startsWith("/")) return "/";
  if (s.includes("//")) return "/";
  if (s.includes("://")) return "/";
  return s;
}
