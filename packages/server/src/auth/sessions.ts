import { randomBytes } from "node:crypto";
import type { Database } from "../db.ts";

export type SessionRow = {
  id: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
};

const TOUCH_MIN_MS = 5 * 60 * 1000;

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function purgeExpiredSessions(db: Database, now = new Date()): void {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now.toISOString());
}

export function createSession(
  db: Database,
  userId: string,
  ttlDays: number,
  now = new Date(),
): SessionRow {
  purgeExpiredSessions(db, now);
  const id = base64url(randomBytes(32));
  const created = now.toISOString();
  const expires = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, userId, created, expires, created);
  return {
    id,
    user_id: userId,
    created_at: created,
    expires_at: expires,
    last_seen_at: created,
  };
}

export function getSession(db: Database, id: string, now = new Date()): SessionRow | null {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
  if (!row) return null;
  if (row.expires_at <= now.toISOString()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    return null;
  }
  return row;
}

export function touchSession(
  db: Database,
  session: SessionRow,
  ttlDays: number,
  now = new Date(),
): SessionRow {
  const lastSeen = Date.parse(session.last_seen_at);
  if (!Number.isNaN(lastSeen) && now.getTime() - lastSeen < TOUCH_MIN_MS) {
    return session;
  }
  const expires = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  const lastSeenAt = now.toISOString();
  db.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?").run(
    lastSeenAt,
    expires,
    session.id,
  );
  return { ...session, last_seen_at: lastSeenAt, expires_at: expires };
}

export function deleteSession(db: Database, id: string): void {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

export function deleteOtherSessions(db: Database, userId: string, keepSessionId: string): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(userId, keepSessionId);
}

export function deleteAllSessionsForUser(db: Database, userId: string): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}
