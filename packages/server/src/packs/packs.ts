import semver from "semver";
import { getArtifactByTypeName, getVersion, type Database } from "../repo.ts";

/**
 * Team method packs: a versioned, immutable manifest of roles, each with artifacts
 * at exact versions. The pack holds references, not copies, so installing goes through the usual `install`.
 */
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TYPES = new Set(["skill", "command", "agent", "hook", "plugin", "settings"]);
const MAX_ROLES = 20;
const MAX_ITEMS = 100;

export type PackItem = { type: string; name: string; version: string };
export type PackRole = { name: string; description: string; items: PackItem[] };
export type PackManifest = { title: string; description: string; roles: PackRole[] };

export class PackError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const bad = (message: string) => new PackError(400, "bad_request", message);

function text(v: unknown, max: number, what: string): string {
  if (v === undefined) return "";
  if (typeof v !== "string" || v.length > max)
    throw bad(`${what} must be a string up to ${max} characters`);
  return v.trim();
}

function parseItem(v: unknown): PackItem {
  const o = (v ?? {}) as Record<string, unknown>;
  if (typeof o.type !== "string" || !TYPES.has(o.type))
    throw bad("item type is not an artifact type");
  if (typeof o.name !== "string" || !NAME_RE.test(o.name))
    throw bad("item name must be kebab-case");
  if (typeof o.version !== "string" || !semver.valid(o.version))
    throw bad("item version must be exact semver");
  return { type: o.type, name: o.name, version: o.version };
}

function parseRole(v: unknown): PackRole {
  const o = (v ?? {}) as Record<string, unknown>;
  if (typeof o.name !== "string" || !NAME_RE.test(o.name))
    throw bad("role name must be kebab-case");
  if (!Array.isArray(o.items) || o.items.length === 0 || o.items.length > MAX_ITEMS) {
    throw bad(`role ${o.name} must list 1..${MAX_ITEMS} items`);
  }
  return {
    name: o.name,
    description: text(o.description, 500, "role description"),
    items: o.items.map(parseItem),
  };
}

export function parsePackBody(body: unknown): {
  name: string;
  version: string;
  manifest: PackManifest;
} {
  const o = (body ?? {}) as Record<string, unknown>;
  if (typeof o.name !== "string" || !NAME_RE.test(o.name) || o.name.length > 64) {
    throw bad("name must be kebab-case, up to 64 characters");
  }
  if (typeof o.version !== "string" || !semver.valid(o.version))
    throw bad("version must be semver");
  if (!Array.isArray(o.roles) || o.roles.length === 0 || o.roles.length > MAX_ROLES) {
    throw bad(`roles must list 1..${MAX_ROLES} roles`);
  }
  const roles = o.roles.map(parseRole);
  if (new Set(roles.map((r) => r.name)).size !== roles.length)
    throw bad("role names must be unique");
  return {
    name: o.name,
    version: o.version,
    manifest: {
      title: text(o.title, 200, "title") || o.name,
      description: text(o.description, 2000, "description"),
      roles,
    },
  };
}

/** Every item exists at that version, is active and visible to the whole organisation. */
export function checkPackItems(db: Database, manifest: PackManifest): void {
  for (const item of manifest.roles.flatMap((r) => r.items)) {
    const label = `${item.type}/${item.name}@${item.version}`;
    const row = getArtifactByTypeName(db, item.type, item.name);
    const version = row && !row.purged_at ? getVersion(db, row.id, item.version) : null;
    if (!row || !version || version.purged)
      throw new PackError(422, "unknown_item", `${label} is not in the registry`);
    if (row.status !== "active")
      throw new PackError(422, "item_not_active", `${label} is ${row.status}`);
    if (row.visibility !== "org")
      throw new PackError(422, "item_not_org", `${label} is not visible to everyone`);
  }
}

type PackRow = { id: number; name: string; owner: string; created_at: string; updated_at: string };
type VersionRow = { version: string; manifest: string; published_by: string; published_at: string };

export function getPack(db: Database, name: string): PackRow | undefined {
  return db.prepare("SELECT * FROM method_packs WHERE name = ?").get(name) as PackRow | undefined;
}

function versionsOf(db: Database, packId: number): VersionRow[] {
  const rows = db
    .prepare(
      "SELECT version, manifest, published_by, published_at FROM method_pack_versions WHERE pack_id = ?",
    )
    .all(packId) as VersionRow[];
  return rows.sort((a, b) => semver.rcompare(a.version, b.version));
}

/** Publishes an immutable version; the first publisher owns the pack. */
export function publishPack(
  db: Database,
  actor: { username: string; role: string },
  input: { name: string; version: string; manifest: PackManifest },
): void {
  const now = new Date().toISOString();
  const existing = getPack(db, input.name);
  if (existing) {
    if (existing.owner !== actor.username && actor.role !== "admin") {
      throw new PackError(403, "not_owner", `pack ${input.name} belongs to ${existing.owner}`);
    }
    const latest = versionsOf(db, existing.id)[0];
    if (latest && !semver.gt(input.version, latest.version)) {
      throw new PackError(
        409,
        "version_not_newer",
        `version must be greater than ${latest.version}`,
      );
    }
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const id = existing
      ? existing.id
      : Number(
          db
            .prepare(
              "INSERT INTO method_packs (name, owner, created_at, updated_at) VALUES (?, ?, ?, ?)",
            )
            .run(input.name, actor.username, now, now).lastInsertRowid,
        );
    db.prepare(
      "INSERT INTO method_pack_versions (pack_id, version, manifest, published_by, published_at) VALUES (?, ?, ?, ?, ?)",
    ).run(id, input.version, JSON.stringify(input.manifest), actor.username, now);
    db.prepare("UPDATE method_packs SET updated_at = ? WHERE id = ?").run(now, id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function versionView(v: VersionRow) {
  return {
    version: v.version,
    published_by: v.published_by,
    published_at: v.published_at,
    ...(JSON.parse(v.manifest) as PackManifest),
  };
}

export function packView(db: Database, row: PackRow) {
  const versions = versionsOf(db, row.id);
  const latest = versions[0] ? versionView(versions[0]) : null;
  return {
    pack: {
      name: row.name,
      owner: row.owner,
      title: latest?.title ?? row.name,
      description: latest?.description ?? "",
      latest_version: latest?.version ?? null,
      updated_at: row.updated_at,
      versions: versions.map((v) => v.version),
    },
    latest,
  };
}

export function packVersion(db: Database, row: PackRow, version: string) {
  const v = versionsOf(db, row.id).find((x) => x.version === version);
  return v ? versionView(v) : null;
}

export function listPacks(db: Database) {
  const rows = db.prepare("SELECT * FROM method_packs ORDER BY name").all() as PackRow[];
  return rows.map((r) => packView(db, r).pack);
}
