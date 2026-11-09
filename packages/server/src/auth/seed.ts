import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { Database } from "../db.ts";
import { countUsers, createUser, getUserByUsername } from "./users.ts";
import { hashPassword } from "./passwords.ts";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function randomBase62(len: number): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += BASE62[bytes[i]! % 62]!;
  }
  return out;
}

export function initialAdminPasswordPath(dataDir: string): string {
  return path.join(dataDir, "initial-admin-password.txt");
}

export function seedAdmin(db: Database, dataDir: string, adminPassword: string | null): void {
  if (countUsers(db) > 0) return;

  let password = adminPassword;
  let generated = false;
  if (password === null || password === undefined || password === "") {
    password = randomBase62(20);
    generated = true;
  }

  const result = createUser(db, {
    username: "admin",
    password,
    role: "admin",
    display_name: "Admin",
  });
  if (!result.ok) {
    throw new Error(`failed to seed admin: ${result.error}`);
  }

  if (generated) {
    // Only the path goes to stdout: a service journal outlives the password change, the file does not.
    const file = initialAdminPasswordPath(dataDir);
    writeOwnerOnlyFile(file, `${password}\n`);
    console.log(`Initial admin password written to ${file}`);
  }
}

/**
 * Write a secret file readable only by its owner. An existing file is removed first:
 * `mode` applies only when a file is created, so a stale file would keep its old permissions.
 * On POSIX the mode is enforced with chmod (umask-independent). On Windows `mode` only toggles
 * read-only; the file inherits the data directory ACL.
 */
export function writeOwnerOnlyFile(filePath: string, content: string): void {
  fs.rmSync(filePath, { force: true });
  fs.writeFileSync(filePath, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  if (process.platform !== "win32") fs.chmodSync(filePath, 0o600);
}

export function seedLocalUser(db: Database): void {
  if (getUserByUsername(db, "local")) return;
  const now = new Date().toISOString();
  const id = randomBytes(16).toString("hex");
  db.prepare(
    `INSERT INTO users (id, username, display_name, password_hash, role, disabled, created_at, updated_at)
     VALUES (?, 'local', 'Local', ?, 'admin', 0, ?, ?)`,
  ).run(id, hashPassword(randomBytes(32).toString("hex")), now, now);
}

export function deleteInitialAdminPasswordFile(dataDir: string): void {
  const p = initialAdminPasswordPath(dataDir);
  try {
    fs.unlinkSync(p);
  } catch {
    // ignore missing
  }
}
