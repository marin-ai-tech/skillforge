import type { ReactNode } from "react";

/** Match http(s) URLs; everything else stays plain escaped text (React default). */
const URL_RE = /(https?:\/\/[^\s<>"'`]+)/gi;

function isSafeHttpUrl(url: string): boolean {
  if (url.length === 0 || url.length > 2048) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0020\u007f\\]/.test(url)) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.length > 0;
  } catch {
    return false;
  }
}

/** Safe internal path for notification links: single leading slash, no protocol-relative. */
export function isSafeInternalPath(url: string): boolean {
  if (!url.startsWith("/") || url.startsWith("//")) return false;
  if (url.length > 2048) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0020\u007f\\]/.test(url)) return false;
  if (url.includes("://")) return false;
  return true;
}

export function CommentBody({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  const re = new RegExp(URL_RE.source, "gi");
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(<span key={key++}>{text.slice(last, m.index)}</span>);
    }
    const url = m[0]!;
    if (isSafeHttpUrl(url)) {
      parts.push(
        <a
          key={key++}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-accent underline"
        >
          {url}
        </a>,
      );
    } else {
      parts.push(<span key={key++}>{url}</span>);
    }
    last = m.index + url.length;
  }
  if (last < text.length) {
    parts.push(<span key={key++}>{text.slice(last)}</span>);
  }
  return (
    <p
      className="whitespace-pre-wrap break-words text-sm text-ink"
      data-testid="comment-body-text"
      translate="no"
    >
      {parts}
    </p>
  );
}
