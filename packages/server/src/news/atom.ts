// news-delivery: the Atom 1.0 feed of the news and its personal key. The XML is written by hand: every text goes
// through escapeXml, Markdown is sent as plain text (never HTML). The key `sfa_<prefix>_<secret>` opens only the feed
// of its owner: it is stored as a hash, one per user, a new one replaces the old; an unknown, replaced or revoked key
// gets the same 404. The request log masks it (logging.ts).
import { randomBytes } from "node:crypto";
import type { Database } from "../db.ts";
import type { Role } from "../auth/users.ts";
import { hashToken, randomBase62 } from "../auth/tokens.ts";
import type { NewsItemView } from "./read.ts";
import { newsItemUrl } from "./links.ts";

export const ATOM_FEED_SIZE = 50;
const KEY_RE = /^sfa_[A-Za-z0-9]{8}_[A-Za-z0-9_-]{43}$/;

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/** Escape text and attribute values; characters XML 1.0 does not allow are dropped. */
export function escapeXml(text: string): string {
  return text
    .replace(/[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/[&<>"']/g, (c) => XML_ESCAPES[c] ?? c);
}

function artifactLabel(item: NewsItemView): string {
  return item.artifact ? `${item.artifact.type} ${item.artifact.name}` : "an artifact";
}

/** The English sentence of an automatic item (the CLI's wording); a post is its own title. */
export function itemTitle(item: NewsItemView): string {
  if (item.post) return item.post.title;
  const what = artifactLabel(item);
  if (item.kind === "new_artifact") return `New ${what}`;
  if (item.kind === "new_version") return `New version of ${what}: ${item.version ?? ""}`.trim();
  const replacement = item.replacement
    ? ` (use ${item.replacement.type} ${item.replacement.name} instead)`
    : "";
  return `${what}: ${item.from ?? "?"} -> ${item.to ?? "?"}${replacement}`;
}

function itemSummary(item: NewsItemView): string {
  if (item.post) return item.post.body;
  return `${itemTitle(item)}, by ${item.actor}.`;
}

function entryXml(base: string, item: NewsItemView): string {
  const href = escapeXml(newsItemUrl(base, item));
  return [
    "  <entry>",
    `    <id>${escapeXml(`${base}/news#news-${item.id}`)}</id>`,
    `    <title>${escapeXml(itemTitle(item))}</title>`,
    `    <updated>${escapeXml(item.at)}</updated>`,
    `    <author><name>${escapeXml(item.post?.author ?? item.actor)}</name></author>`,
    `    <link rel="alternate" href="${href}"/>`,
    `    <summary type="text">${escapeXml(itemSummary(item))}</summary>`,
    "  </entry>",
  ].join("\n");
}

/** The feed document; `updated` is the newest item, or `now` for an empty feed. */
export function renderAtom(base: string, items: NewsItemView[], now: string): string {
  const updated = items[0]?.at ?? now;
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>${escapeXml(`${base}/news`)}</id>`,
    "  <title>SkillForge news</title>",
    `  <updated>${escapeXml(updated)}</updated>`,
    `  <link rel="alternate" href="${escapeXml(`${base}/news`)}"/>`,
    "  <author><name>SkillForge</name></author>",
    ...items.map((item) => entryXml(base, item)),
    "</feed>",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// The key

export type AtomKeyState = { exists: boolean; prefix: string | null; created_at: string | null };

/** Issue a key for the user, replacing the old one. The key itself is returned only here. */
export function issueAtomKey(
  db: Database,
  username: string,
  now: string,
): { key: string; prefix: string; created_at: string } {
  const prefix = randomBase62(8);
  const key = `sfa_${prefix}_${randomBytes(32).toString("base64url")}`;
  db.prepare(
    `INSERT INTO news_atom_keys (username, prefix, key_hash, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (username) DO UPDATE SET prefix = excluded.prefix, key_hash = excluded.key_hash,
       created_at = excluded.created_at`,
  ).run(username, prefix, hashToken(key), now);
  return { key, prefix, created_at: now };
}

export function atomKeyState(db: Database, username: string): AtomKeyState {
  const row = db
    .prepare("SELECT prefix, created_at FROM news_atom_keys WHERE username = ?")
    .get(username) as { prefix: string; created_at: string } | undefined;
  return {
    exists: row !== undefined,
    prefix: row?.prefix ?? null,
    created_at: row?.created_at ?? null,
  };
}

export function revokeAtomKey(db: Database, username: string): void {
  db.prepare("DELETE FROM news_atom_keys WHERE username = ?").run(username);
}

/** The owner of a live key (an enabled user), or null for anything else. */
export function resolveAtomKey(db: Database, key: string): { username: string; role: Role } | null {
  if (!KEY_RE.test(key)) return null;
  const row = db
    .prepare(
      `SELECT u.username, u.role FROM news_atom_keys k JOIN users u ON u.username = k.username
       WHERE k.key_hash = ? AND u.disabled = 0`,
    )
    .get(hashToken(key)) as { username: string; role: Role } | undefined;
  return row ?? null;
}
