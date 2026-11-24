import semver from "semver";
import type { Role } from "../auth/users.ts";
import { getArtifactByTypeName, getVersion, type Database } from "../repo.ts";
import { securityGate } from "../security/clearance.ts";
import { canView } from "../visibility/index.ts";
import { getPack, type PackItem, type PackManifest } from "./packs.ts";

/** One problem of a method pack draft (pack-authoring): of an item in a role, or of the pack itself (`role: null`). */
export type MethodPackProblem = {
  role: string | null;
  type?: string;
  name?: string;
  version?: string;
  code: string;
  message: string;
  latest?: string;
};

export type MethodPackActor = { username: string; role: Role };

/**
 * The first problem of one item, in the order the registry always used. An item the actor cannot see is unknown, so
 * a check never reveals a team artifact.
 */
function itemProblem(
  db: Database,
  actor: MethodPackActor,
  role: string,
  item: PackItem,
): MethodPackProblem | null {
  const label = `${item.type}/${item.name}@${item.version}`;
  const at = { role, type: item.type, name: item.name, version: item.version };
  const row = getArtifactByTypeName(db, item.type, item.name);
  const visible = row && !row.purged_at && canView(db, actor, row);
  const version = visible ? getVersion(db, row.id, item.version) : null;
  if (!row || !visible || !version || version.purged) {
    return { ...at, code: "unknown_item", message: `${label} is not in the registry` };
  }
  if (row.status !== "active")
    return { ...at, code: "item_not_active", message: `${label} is ${row.status}` };
  if (row.visibility !== "org")
    return { ...at, code: "item_not_org", message: `${label} is not visible to everyone` };
  const gate = securityGate(db, row.id, item.version);
  if (!gate.ok) {
    return {
      ...at,
      code: "item_security_not_cleared",
      message: `${label} has unreviewed security findings: ${gate.rules.join(", ")}`,
    };
  }
  return null;
}

/** Every item of every role: its first problem, if any. */
export function methodPackItemProblems(
  db: Database,
  actor: MethodPackActor,
  manifest: PackManifest,
): MethodPackProblem[] {
  const out: MethodPackProblem[] = [];
  for (const role of manifest.roles) {
    for (const item of role.items) {
      const p = itemProblem(db, actor, role.name, item);
      if (p) out.push(p);
    }
  }
  return out;
}

/** Problems of the pack itself: someone else's pack, a version not above the latest. */
export function methodPackOwnProblems(
  db: Database,
  actor: MethodPackActor,
  name: string,
  version: string,
): MethodPackProblem[] {
  const pack = getPack(db, name);
  if (!pack) return [];
  const out: MethodPackProblem[] = [];
  if (pack.owner !== actor.username && actor.role !== "admin") {
    out.push({ role: null, code: "not_owner", message: `pack ${name} belongs to ${pack.owner}` });
  }
  const latest = (
    db.prepare("SELECT version FROM method_pack_versions WHERE pack_id = ?").all(pack.id) as Array<{
      version: string;
    }>
  )
    .map((r) => r.version)
    .sort(semver.rcompare)[0];
  if (latest && !semver.gt(version, latest)) {
    out.push({
      role: null,
      code: "version_not_newer",
      message: `version must be greater than ${latest}`,
      latest,
    });
  }
  return out;
}
