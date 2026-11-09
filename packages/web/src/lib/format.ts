import { locale } from "../i18n/index.ts";

export function formatRelativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diff = Math.round((now - t) / 1000);
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
  if (abs < 60) return rtf.format(-diff, "second");
  if (abs < 3600) return rtf.format(-Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(-Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(-Math.round(diff / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(-Math.round(diff / (86400 * 30)), "month");
  return rtf.format(-Math.round(diff / (86400 * 365)), "year");
}

export function formatBytes(n: number): string {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KiB";
  return (n / (1024 * 1024)).toFixed(1) + " MiB";
}

export function shortDigest(digest: string, n = 12): string {
  return digest.slice(0, n);
}
