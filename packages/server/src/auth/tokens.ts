import { createHash, randomBytes, randomInt } from "node:crypto";
import type { Database } from "../db.ts";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const TOUCH_MIN_MS = 60 * 1000;

export type TokenRow = {
  id: string;
  user_id: string;
  name: string;
  prefix: string;
  token_hash: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  mcp: number;
  mcp_tags: string;
};

export type TokenPublic = {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  mcp: boolean;
  mcp_tags: string[];
};

export type CreateTokenOpts = {
  mcp?: boolean;
  mcp_tags?: string[];
};

export type ResolvedToken = {
  userId: string;
  tokenId: string;
  mcp: boolean;
  mcp_tags: string[];
};

/** Uniform base62 string via crypto.randomInt (no modulo bias). */
export function randomBase62(len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += BASE62[randomInt(62)]!;
  }
  return out;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function newId(): string {
  return randomBytes(16).toString("hex");
}

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function toPublic(row: {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  mcp: number | boolean | null | undefined;
  mcp_tags: string | null | undefined;
}): TokenPublic {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    mcp: Boolean(row.mcp),
    mcp_tags: parseTags(row.mcp_tags ?? "[]"),
  };
}

export function createToken(
  db: Database,
  userId: string,
  name: string,
  opts: CreateTokenOpts = {},
): { row: TokenPublic; token: string } {
  const mcp = opts.mcp === true;
  const mcpTags = mcp ? (opts.mcp_tags ?? []) : [];
  const prefix = randomBase62(8);
  const secret = randomBase62(32);
  const token = `sf_${prefix}_${secret}`;
  const id = newId();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO api_tokens (id, user_id, name, prefix, token_hash, created_at, last_used_at, revoked_at, mcp, mcp_tags)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
  ).run(id, userId, name, prefix, hashToken(token), now, mcp ? 1 : 0, JSON.stringify(mcpTags));
  return {
    token,
    row: {
      id,
      name,
      prefix,
      created_at: now,
      last_used_at: null,
      mcp,
      mcp_tags: mcpTags,
    },
  };
}

export function listTokens(db: Database, userId: string): TokenPublic[] {
  const rows = db
    .prepare(
      `SELECT id, name, prefix, created_at, last_used_at, mcp, mcp_tags FROM api_tokens
       WHERE user_id = ? AND revoked_at IS NULL
       ORDER BY created_at DESC`,
    )
    .all(userId) as Array<{
    id: string;
    name: string;
    prefix: string;
    created_at: string;
    last_used_at: string | null;
    mcp: number;
    mcp_tags: string;
  }>;
  return rows.map(toPublic);
}

export function revokeToken(db: Database, userId: string, tokenId: string): boolean {
  const row = db
    .prepare("SELECT * FROM api_tokens WHERE id = ? AND user_id = ?")
    .get(tokenId, userId) as TokenRow | undefined;
  if (!row || row.revoked_at) return false;
  db.prepare("UPDATE api_tokens SET revoked_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    tokenId,
  );
  return true;
}

export function resolveToken(db: Database, token: string, now = new Date()): ResolvedToken | null {
  if (!/^sf_[A-Za-z0-9]{8}_[A-Za-z0-9]{32}$/.test(token)) return null;
  const row = db.prepare("SELECT * FROM api_tokens WHERE token_hash = ?").get(hashToken(token)) as
    TokenRow | undefined;
  if (!row || row.revoked_at) return null;
  const last = row.last_used_at ? Date.parse(row.last_used_at) : 0;
  if (Number.isNaN(last) || now.getTime() - last >= TOUCH_MIN_MS) {
    db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(
      now.toISOString(),
      row.id,
    );
  }
  return {
    userId: row.user_id,
    tokenId: row.id,
    mcp: Boolean(row.mcp),
    mcp_tags: parseTags(row.mcp_tags),
  };
}
