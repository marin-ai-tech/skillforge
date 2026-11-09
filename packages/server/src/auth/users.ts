import { randomBytes } from "node:crypto";
import type { Database } from "../db.ts";
import { hashPassword } from "./passwords.ts";

export const ROLES = ["viewer", "contributor", "reviewer", "admin"] as const;
export type Role = (typeof ROLES)[number];

const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  contributor: 2,
  reviewer: 3,
  admin: 4,
};

const USERNAME_RE = /^[a-z0-9._-]{2,32}$/i;

export type UserRow = {
  id: string;
  username: string;
  display_name: string | null;
  password_hash: string;
  role: Role;
  disabled: number;
  created_at: string;
  updated_at: string;
};

export type PublicUser = {
  id: string;
  username: string;
  display_name: string | null;
  role: Role;
  disabled: boolean;
  created_at: string;
  updated_at: string;
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function roleAtLeast(have: Role, need: Role): boolean {
  return ROLE_RANK[have] >= ROLE_RANK[need];
}

export function validateUsername(username: string): boolean {
  return USERNAME_RE.test(username);
}

export function validatePassword(password: string): boolean {
  return typeof password === "string" && password.length >= 8;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    disabled: row.disabled !== 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function meUser(row: UserRow): {
  id: string;
  username: string;
  display_name: string | null;
  role: Role;
} {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
  };
}

function newId(): string {
  return randomBytes(16).toString("hex");
}

export function countUsers(db: Database): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number | bigint };
  return Number(row.n);
}

export function getUserById(db: Database, id: string): UserRow | null {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row ?? null;
}

export function getUserByUsername(db: Database, username: string): UserRow | null {
  const row = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(username) as
    UserRow | undefined;
  return row ?? null;
}

export function listUsers(db: Database): PublicUser[] {
  const rows = db
    .prepare("SELECT * FROM users ORDER BY username COLLATE NOCASE")
    .all() as UserRow[];
  return rows.map(toPublicUser);
}

export type CreateUserInput = {
  username: string;
  password: string;
  role: Role;
  display_name?: string | null;
};

export type CreateUserResult =
  { ok: true; user: PublicUser } | { ok: false; error: "bad_request" | "username_taken" };

export function createUser(db: Database, input: CreateUserInput): CreateUserResult {
  const username = input.username.trim();
  if (!validateUsername(username) || !validatePassword(input.password) || !isRole(input.role)) {
    return { ok: false, error: "bad_request" };
  }
  if (getUserByUsername(db, username)) {
    return { ok: false, error: "username_taken" };
  }
  const now = new Date().toISOString();
  const id = newId();
  const displayName =
    input.display_name === undefined || input.display_name === null || input.display_name === ""
      ? null
      : String(input.display_name);
  const passwordHash = hashPassword(input.password);
  const storedUsername = username.toLowerCase();
  db.prepare(
    `INSERT INTO users (id, username, display_name, password_hash, role, disabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(id, storedUsername, displayName, passwordHash, input.role, now, now);
  const row = getUserById(db, id)!;
  return { ok: true, user: toPublicUser(row) };
}

export type UpdateUserInput = {
  role?: Role;
  disabled?: boolean;
  display_name?: string | null;
  password?: string;
};

export type UpdateUserResult =
  { ok: true; user: PublicUser } | { ok: false; error: "not_found" | "bad_request" | "last_admin" };

export function countActiveAdmins(db: Database): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0")
    .get() as { n: number | bigint };
  return Number(row.n);
}

function updateInputValid(input: UpdateUserInput): boolean {
  if (input.role !== undefined && !isRole(input.role)) return false;
  if (input.password !== undefined && !validatePassword(input.password)) return false;
  return true;
}

function nextDisabledFlag(input: UpdateUserInput, current: number): number {
  if (input.disabled === undefined) return current;
  return input.disabled ? 1 : 0;
}

function nextDisplayName(input: UpdateUserInput, current: string | null): string | null {
  if (input.display_name === undefined) return current;
  return input.display_name === null || input.display_name === ""
    ? null
    : String(input.display_name);
}

export function updateUser(db: Database, id: string, input: UpdateUserInput): UpdateUserResult {
  const row = getUserById(db, id);
  if (!row) return { ok: false, error: "not_found" };

  if (!updateInputValid(input)) {
    return { ok: false, error: "bad_request" };
  }

  const nextRole = input.role ?? row.role;
  const nextDisabled = nextDisabledFlag(input, row.disabled);
  const wouldLoseAdmin =
    row.role === "admin" && row.disabled === 0 && (nextRole !== "admin" || nextDisabled !== 0);
  if (wouldLoseAdmin && countActiveAdmins(db) <= 1) {
    return { ok: false, error: "last_admin" };
  }

  const now = new Date().toISOString();
  const displayName = nextDisplayName(input, row.display_name);
  const passwordHash =
    input.password !== undefined ? hashPassword(input.password) : row.password_hash;

  db.prepare(
    `UPDATE users SET display_name = ?, password_hash = ?, role = ?, disabled = ?, updated_at = ?
     WHERE id = ?`,
  ).run(displayName, passwordHash, nextRole, nextDisabled, now, id);

  return { ok: true, user: toPublicUser(getUserById(db, id)!) };
}

export function setPassword(db: Database, id: string, password: string): void {
  const now = new Date().toISOString();
  db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(
    hashPassword(password),
    now,
    id,
  );
}
