import { randomBytes } from "node:crypto";
import type { Database } from "../db.ts";
import { hashPassword } from "./passwords.ts";
import {
  getUserById,
  getUserByUsername,
  isRole,
  roleAtLeast,
  type Role,
  type UserRow,
} from "./users.ts";
import type { OidcProviderConfig } from "./oidc/types.ts";
import type { JwtClaims } from "./oidc/jwt.ts";
import type { LdapProviderConfig } from "./ldap/types.ts";

export type IdentityRow = {
  provider: string;
  subject: string;
  user_id: string;
  email: string | null;
  created_at: string;
  last_login_at: string;
};

function newId(): string {
  return randomBytes(16).toString("hex");
}

export function getIdentity(db: Database, provider: string, subject: string): IdentityRow | null {
  const row = db
    .prepare("SELECT * FROM user_identities WHERE provider = ? AND subject = ?")
    .get(provider, subject) as IdentityRow | undefined;
  return row ?? null;
}

export function getIdentityByUserId(db: Database, userId: string): IdentityRow | null {
  const row = db.prepare("SELECT * FROM user_identities WHERE user_id = ? LIMIT 1").get(userId) as
    IdentityRow | undefined;
  return row ?? null;
}

export function listIdentityProvidersByUser(db: Database): Map<string, string> {
  const rows = db.prepare("SELECT user_id, provider FROM user_identities").all() as Array<{
    user_id: string;
    provider: string;
  }>;
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.user_id, r.provider);
  return map;
}

export function sanitizeOidcUsername(
  preferred: string | undefined,
  email: string | undefined,
): string {
  let base =
    (typeof preferred === "string" && preferred.trim() ? preferred.trim() : "") ||
    (typeof email === "string" && email.includes("@") ? email.split("@")[0]! : "") ||
    "user";
  base = base.toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (base.length > 32) base = base.slice(0, 32);
  if (base.length < 2) base = (base + "user").slice(0, 32);
  return base;
}

function allocateUsername(db: Database, base: string): string {
  if (!getUserByUsername(db, base)) return base;
  for (let i = 2; i < 10000; i++) {
    const suffix = `-${i}`;
    const candidate = base.slice(0, Math.max(1, 32 - suffix.length)) + suffix;
    if (!getUserByUsername(db, candidate)) return candidate;
  }
  throw new Error("username_exhausted");
}

function pickHighestRole(candidates: Role[], fallback: Role): Role {
  let best = fallback;
  for (const r of candidates) {
    if (roleAtLeast(r, best)) best = r;
  }
  return best;
}

export function resolveRoleFromClaims(claims: JwtClaims, provider: OidcProviderConfig): Role {
  const fallback = isRole(provider.default_role) ? (provider.default_role as Role) : "viewer";
  if (!provider.role_claim || !provider.role_map) return fallback;
  const raw = claims[provider.role_claim];
  const values: string[] = Array.isArray(raw)
    ? raw.filter((v): v is string => typeof v === "string")
    : typeof raw === "string"
      ? [raw]
      : [];
  const matched: Role[] = [];
  for (const v of values) {
    const mapped = provider.role_map[v];
    if (typeof mapped === "string" && isRole(mapped)) matched.push(mapped);
  }
  return pickHighestRole(matched, fallback);
}

export function resolveRoleFromLdapGroups(groups: string[], provider: LdapProviderConfig): Role {
  const fallback = isRole(provider.default_role) ? (provider.default_role as Role) : "viewer";
  if (!provider.role_map) return fallback;
  const groupSet = new Set(groups.map((g) => g.toLowerCase()));
  const matched: Role[] = [];
  for (const [dn, mapped] of Object.entries(provider.role_map)) {
    if (groupSet.has(dn.toLowerCase()) && isRole(mapped)) matched.push(mapped);
  }
  return pickHighestRole(matched, fallback);
}

function unusablePasswordHash(): string {
  return hashPassword(randomBytes(32).toString("hex"));
}

export type ProvisionResult = { ok: true; user: UserRow } | { ok: false; error: "disabled" };

export function provisionOidcUser(
  db: Database,
  provider: OidcProviderConfig,
  claims: JwtClaims,
): ProvisionResult {
  const subject = String(claims.sub);
  const email = typeof claims.email === "string" ? claims.email : null;
  const now = new Date().toISOString();
  const existing = getIdentity(db, provider.id, subject);

  if (existing) {
    const user = getUserById(db, existing.user_id);
    if (!user) throw new Error("identity_orphan");
    if (user.disabled !== 0) return { ok: false, error: "disabled" };
    db.prepare(
      "UPDATE user_identities SET email = ?, last_login_at = ? WHERE provider = ? AND subject = ?",
    ).run(email, now, provider.id, subject);
    if (provider.role_map) {
      const role = resolveRoleFromClaims(claims, provider);
      if (role !== user.role) {
        db.prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?").run(
          role,
          now,
          user.id,
        );
      }
    }
    return { ok: true, user: getUserById(db, user.id)! };
  }

  const preferred =
    typeof claims.preferred_username === "string" ? claims.preferred_username : undefined;
  const base = sanitizeOidcUsername(preferred, email ?? undefined);
  const username = allocateUsername(db, base);
  const displayName = typeof claims.name === "string" && claims.name ? claims.name : null;
  const role = resolveRoleFromClaims(claims, provider);
  const id = newId();
  db.prepare(
    `INSERT INTO users (id, username, display_name, password_hash, role, disabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(id, username, displayName, unusablePasswordHash(), role, now, now);
  db.prepare(
    `INSERT INTO user_identities (provider, subject, user_id, email, created_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(provider.id, subject, id, email, now, now);
  return { ok: true, user: getUserById(db, id)! };
}

export type LdapAuthIdentity = {
  dn: string;
  username: string;
  displayName: string | null;
  email: string | null;
  groups: string[];
};

export function provisionLdapUser(
  db: Database,
  provider: LdapProviderConfig,
  auth: LdapAuthIdentity,
): ProvisionResult {
  const identityProvider = `ldap:${provider.id}`;
  const subject = auth.dn.toLowerCase();
  const email = auth.email;
  const now = new Date().toISOString();
  const existing = getIdentity(db, identityProvider, subject);

  const role = resolveRoleFromLdapGroups(auth.groups, provider);

  if (existing) {
    const user = getUserById(db, existing.user_id);
    if (!user) throw new Error("identity_orphan");
    if (user.disabled !== 0) return { ok: false, error: "disabled" };
    db.prepare(
      "UPDATE user_identities SET email = ?, last_login_at = ? WHERE provider = ? AND subject = ?",
    ).run(email, now, identityProvider, subject);
    if (role !== user.role) {
      db.prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?").run(role, now, user.id);
    }
    // Refresh display name when provided
    if (auth.displayName && auth.displayName !== user.display_name) {
      db.prepare("UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?").run(
        auth.displayName,
        now,
        user.id,
      );
    }
    return { ok: true, user: getUserById(db, user.id)! };
  }

  const base = sanitizeOidcUsername(auth.username, email ?? undefined);
  const username = allocateUsername(db, base);
  const displayName = auth.displayName;
  const id = newId();
  db.prepare(
    `INSERT INTO users (id, username, display_name, password_hash, role, disabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(id, username, displayName, unusablePasswordHash(), role, now, now);
  db.prepare(
    `INSERT INTO user_identities (provider, subject, user_id, email, created_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(identityProvider, subject, id, email, now, now);
  return { ok: true, user: getUserById(db, id)! };
}

export type UserSource = string;

export function userSource(db: Database, userId: string, username: string): UserSource {
  const ident = getIdentityByUserId(db, userId);
  if (ident) {
    if (ident.provider.startsWith("ldap:")) return ident.provider;
    return `oidc:${ident.provider}`;
  }
  if (username === "local") return "local";
  return "password";
}
