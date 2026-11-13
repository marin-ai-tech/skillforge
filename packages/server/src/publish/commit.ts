import { ensureSourceForArtifact } from "../tracked/store.ts";
import type { RubricResult } from "../quality/rubric.ts";
import { signStoredVersion } from "../signing/signer.ts";
import { randomUUID } from "node:crypto";
import {
  assessQuality,
  artifactBodyFingerprint,
  type ArtifactType,
  type ParsedArtifact,
} from "@skillforge/core";
import { putBlob } from "../blobs.ts";
import { appendProvenance } from "../provenance/ledger.ts";
import { bumpMarketplaceVersion } from "../distribution/marketplace.ts";
import { emitPluginEvent } from "../plugins/events.ts";
import { notify, emitNotifications } from "../notifications/notify.ts";
import { actorFromUsername } from "../plugins/actor.ts";
import {
  appendAudit,
  createArtifact,
  getArtifactByTypeName,
  hasDigest,
  hasVersion,
  insertVersion,
  rowToSummary,
  updateArtifactOnPublish,
  type Database,
  type VersionDetail,
} from "../repo.ts";
import { canPublishVersion } from "../ownership.ts";
import { latestOf, listChannelEntries, type Channel } from "../versions/channels.ts";
import { getSuiteGate } from "../evals/suite.ts";
import type { Role } from "../auth/users.ts";
import type { ConflictKind, PrepareOk, PublishCtx, PublishResult } from "./types.ts";

type ExistingRow = NonNullable<ReturnType<typeof getArtifactByTypeName>>;

/** Immutable purge reservations: purged name or digest MUST NOT be republished. */
function purgedDigestExists(db: Database, digest: string): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM artifact_versions WHERE digest = ? AND purged_at IS NOT NULL LIMIT 1")
      .get(digest),
  );
}

/** Pre-blob purge reservation check under a write lock; null when clean. */
function purgeReservationResult(
  db: Database,
  type: ArtifactType,
  name: string,
  digest: string,
): PublishResult | null {
  db.exec("BEGIN IMMEDIATE");
  try {
    const reserved = getArtifactByTypeName(db, type, name);
    const purgedDigest = purgedDigestExists(db, digest);
    db.exec("COMMIT");
    if (reserved?.purged_at) return { kind: "name_purged" };
    if (purgedDigest) return { kind: "content_purged" };
    return null;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Ownership denial result for an existing row; team scope hides the owner name. */
function notOwnerResult(existing: ExistingRow, owner: string): PublishResult {
  return existing.visibility === "team" ? { kind: "not_owner" } : { kind: "not_owner", owner };
}

/** Pre-check BEFORE putBlob: a stranger must not pollute the blob store. */
function earlyOwnershipResult(
  db: Database,
  type: ArtifactType,
  name: string,
  actor: string,
  role: Role,
): PublishResult | null {
  const existing = getArtifactByTypeName(db, type, name);
  if (!existing) return null;
  const right = canPublishVersion(db, actor, role, { id: existing.id, owner: existing.owner });
  return right.allowed ? null : notOwnerResult(existing, right.owner);
}

/** Eval gate outcome for a row: reject explicit stable, force beta when unset. */
function evalGateResult(
  db: Database,
  existing: ExistingRow,
  channelExplicit: boolean,
  channel: Channel,
): { outcome: "none" } | { outcome: "reject" } | { outcome: "beta" } {
  if (getSuiteGate(db, existing.id) !== "required") return { outcome: "none" };
  if (channelExplicit && channel === "stable") return { outcome: "reject" };
  if (!channelExplicit) return { outcome: "beta" };
  return { outcome: "none" };
}

/** Map prepared conflicts to the publish result, in the fixed order of precedence. */
export function conflictResult(conflicts: ConflictKind[]): PublishResult | null {
  if (conflicts.includes("version_invalid")) return { kind: "version_invalid" };
  if (conflicts.includes("channel_invalid")) return { kind: "channel_invalid" };
  if (conflicts.includes("version_exists")) return { kind: "version_exists" };
  if (conflicts.includes("digest_exists")) return { kind: "digest_exists" };
  return null;
}

type TxWrite = {
  artifactId: string;
  owner: string;
  override: boolean;
  versionDetail: VersionDetail;
  createdNotifications: Parameters<typeof emitNotifications>[0];
};

/** Insert artifact/version inside the open transaction; failure result or the rows written. */
function writeVersionRows(
  db: Database,
  args: {
    existing: ExistingRow | undefined;
    artifact: ParsedArtifact;
    type: ArtifactType;
    version: string;
    channel: Channel;
    actor: string;
    role: Role;
    prepared: PrepareOk;
    now: string;
    versionId: string;
  },
): TxWrite | PublishResult {
  const { existing, artifact, type, version, channel, actor, role, prepared, now, versionId } =
    args;
  let artifactId: string;
  let latestVersion: string;
  let override = false;
  let owner = actor;

  const agents = prepared.agents ?? [];

  if (!existing) {
    artifactId = randomUUID();
    createArtifact(db, {
      id: artifactId,
      type,
      name: artifact.name,
      description: artifact.description,
      display_name: artifact.displayName,
      tags: artifact.tags,
      agents,
      created_by: actor,
      latest_version: version,
      now,
      visibility: prepared.visibility,
      owner_team: prepared.ownerTeam,
    });
    latestVersion = version;
  } else {
    const right = canPublishVersion(db, actor, role, { id: existing.id, owner: existing.owner });
    if (!right.allowed) {
      return notOwnerResult(existing, right.owner);
    }
    override = right.override;
    owner = right.owner;
    artifactId = existing.id;
    if (hasVersion(db, artifactId, version)) return { kind: "version_exists" };
    if (hasDigest(db, artifactId, artifact.digest)) return { kind: "digest_exists" };
    latestVersion =
      latestOf([...listChannelEntries(db, artifactId), { version, channel }]) ?? version;
    updateArtifactOnPublish(db, artifactId, {
      description: artifact.description,
      display_name: artifact.displayName,
      tags: artifact.tags,
      agents,
      latest_version: latestVersion,
      now,
    });
  }

  const provenance = (
    prepared as PrepareOk & { provenance?: { source: string; ref: string | null } }
  ).provenance ?? { source: "human", ref: null };

  const versionDetail = insertVersion(db, {
    id: versionId,
    artifact_id: artifactId,
    version,
    digest: artifact.digest,
    channel,
    description: artifact.description,
    display_name: artifact.displayName,
    tags: artifact.tags,
    frontmatter: artifact.frontmatter,
    components: artifact.components,
    files: artifact.files,
    warnings: prepared.warnings,
    quality: prepared.quality ?? assessQuality(artifact),
    body_sha256: prepared.body_sha256 ?? artifactBodyFingerprint(artifact),
    changelog: prepared.changelog,
    model_compat: prepared.modelCompat,
    agents,
    provenance,
    evidence: [],
    published_by: actor,
    published_at: now,
  });

  versionDetail.signature = signStoredVersion(db, versionId, {
    type,
    name: artifact.name,
    version,
    digest: artifact.digest,
    files: artifact.files,
  });
  versionDetail.rubric = storeRubric(db, versionId, prepared.rubric);

  const importMeta = (
    prepared as PrepareOk & { importMeta?: { kind: string; ref: string; import_id: string } }
  ).importMeta;
  appendProvenance(db, {
    artifact_id: artifactId,
    version,
    kind: provenance.source === "import" ? "import" : "publish",
    source: provenance.source,
    ref: provenance.ref,
    actor,
    meta: { digest: artifact.digest, ...(importMeta ? { import: importMeta } : {}) },
  });
  appendAudit(db, {
    ts: now,
    actor,
    artifact_id: artifactId,
    version,
    action: "publish",
    meta: {
      digest: artifact.digest,
      ...(importMeta ? { import: importMeta } : {}),
    },
  });

  if (override) {
    appendAudit(db, {
      ts: now,
      actor,
      artifact_id: artifactId,
      version,
      action: "publish_override",
      meta: { by_role: role, owner },
    });
  }

  const createdNotifications = notify(db, {
    kind: "new_version",
    artifact: getArtifactByTypeName(db, type, artifact.name)!,
    actor,
    version,
  });
  return { artifactId, owner, override, versionDetail, createdNotifications };
}

/** UNIQUE violation recovery: lost a publish race — classify against the winner row. */
function uniqueConflictResult(
  db: Database,
  msg: string,
  type: ArtifactType,
  name: string,
  actor: string,
  role: Role,
): PublishResult {
  if (/digest/i.test(msg) || /artifact_id, digest/i.test(msg)) {
    return { kind: "digest_exists" };
  }
  // UNIQUE(type, name): lost the first-publication race — re-read and re-apply the rule.
  const winner = getArtifactByTypeName(db, type, name);
  if (winner) {
    const right = canPublishVersion(db, actor, role, { id: winner.id, owner: winner.owner });
    if (!right.allowed) return notOwnerResult(winner, right.owner);
  }
  return { kind: "version_exists" };
}

/** In-transaction checks and writes; caller rolls back when a PublishResult is returned. */
function commitRowsInTx(
  db: Database,
  args: {
    artifact: ParsedArtifact;
    type: ArtifactType;
    version: string;
    channel: Channel;
    actor: string;
    role: Role;
    prepared: PrepareOk;
    now: string;
    versionId: string;
  },
): TxWrite | PublishResult {
  const { artifact, type, version, actor, role, prepared, now, versionId } = args;
  let channel = args.channel;

  // Re-read inside the transaction (not the earlier `existingPre`): the final
  // ownership check uses data re-read after BEGIN IMMEDIATE.
  const existing = getArtifactByTypeName(db, type, artifact.name);
  if (existing?.purged_at) {
    return { kind: "name_purged" };
  }
  // eval gate: force beta / reject explicit stable when suite gate is required
  if (existing) {
    const gate = evalGateResult(db, existing, prepared.channelExplicit, channel);
    if (gate.outcome === "reject") return { kind: "eval_gate_required" };
    if (gate.outcome === "beta") channel = "beta";
  }
  if (purgedDigestExists(db, artifact.digest)) {
    return { kind: "content_purged" };
  }

  return writeVersionRows(db, {
    existing,
    artifact,
    type,
    version,
    channel,
    actor,
    role,
    prepared,
    now,
    versionId,
  });
}

function isCommittable(prepared: PrepareOk): prepared is PrepareOk & {
  parsed: ParsedArtifact;
  type: ArtifactType;
  version: string;
  channel: Channel;
} {
  return Boolean(
    prepared.ok && prepared.parsed && prepared.type && prepared.version && prepared.channel,
  );
}

/** quality-rubric: the score by company and team rules belongs to the version, written in the publish transaction. */
function storeRubric(db: Database, versionId: string, rubric: RubricResult | null | undefined) {
  if (!rubric) return null;
  db.prepare("UPDATE artifact_versions SET rubric = ? WHERE id = ?").run(
    JSON.stringify(rubric),
    versionId,
  );
  return rubric;
}

export function commitPublish(ctx: PublishCtx, prepared: PrepareOk): PublishResult {
  const { db, dataDir, actor, role } = ctx;
  if (!isCommittable(prepared)) {
    return {
      kind: "validation_failed",
      errors: prepared.errors,
      warnings: prepared.warnings,
    };
  }

  const artifact = prepared.parsed;
  const type = prepared.type;
  const version = prepared.version;
  let channel = prepared.channel;
  const warnings = prepared.warnings;

  // Check immutable purge reservations under a write lock before creating any blob.
  const reserved = purgeReservationResult(db, type, artifact.name, artifact.digest);
  if (reserved) return reserved;

  // Pre-check BEFORE putBlob: a stranger must not pollute the blob store.
  const denied = earlyOwnershipResult(db, type, artifact.name, actor, role);
  if (denied) return denied;

  // eval gate early: before digest/version conflicts so explicit stable is rejected first
  {
    const existingGate = getArtifactByTypeName(db, type, artifact.name);
    if (existingGate) {
      const gate = evalGateResult(db, existingGate, prepared.channelExplicit, channel);
      if (gate.outcome === "reject") return { kind: "eval_gate_required" };
      if (gate.outcome === "beta") channel = "beta";
    }
  }

  const conflicted = conflictResult(prepared.conflicts);
  if (conflicted) return conflicted;

  for (const file of artifact.canonical) {
    putBlob(dataDir, file.content);
  }

  const now = new Date().toISOString();
  const versionId = randomUUID();

  db.exec("BEGIN IMMEDIATE");
  try {
    const tx = commitRowsInTx(db, {
      artifact,
      type,
      version,
      channel,
      actor,
      role,
      prepared,
      now,
      versionId,
    });
    if ("kind" in tx) {
      db.exec("ROLLBACK");
      return tx;
    }
    const { owner, override, versionDetail, createdNotifications } = tx;

    db.exec("COMMIT");
    emitNotifications(createdNotifications);
    bumpMarketplaceVersion();

    const row = getArtifactByTypeName(db, type, artifact.name)!;
    ensureSourceForArtifact(db, row.id);
    emitPluginEvent({
      type: "artifact.published",
      at: now,
      actor: actorFromUsername(db, actor),
      artifact: {
        id: row.id,
        type: row.type,
        name: row.name,
        status: row.status,
        owner,
        override,
      },
      version: { version: versionDetail.version, digest: versionDetail.digest },
    });
    return {
      kind: "created",
      artifact: rowToSummary(db, row),
      version: versionDetail,
      warnings,
      quality: versionDetail.quality,
      rubric: versionDetail.rubric ?? null,
      duplicates: prepared.duplicates,
    };
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ignore
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (/UNIQUE|CONSTRAINT/i.test(msg)) {
      return uniqueConflictResult(db, msg, type, artifact.name, actor, role);
    }
    throw e;
  }
}
