import { rubricBlock, rubricFor } from "../quality/rubric.ts";
import { securityBlock } from "../security/policy.ts";
import { mcpPolicyBlock } from "../mcp-policy/policy.ts";
import {
  detectArtifactType,
  parseArtifact,
  assessQuality,
  isArtifactType,
  artifactBodyFingerprint,
  ISSUE_CODES,
  type ArtifactType,
  type Issue,
  type ParsedArtifact,
  type QualityReport,
} from "@skillforge/core";
import semver from "semver";
import { decodeBase64Strict } from "../lib/base64.ts";
import { findRegistryDuplicates } from "../duplicates/registry.ts";
import {
  getArtifactByTypeName,
  hasDigest,
  hasVersion,
  listLatestVersionsForDuplicates,
  rowToSummary,
  type Database,
} from "../repo.ts";
import { canPublishVersion } from "../ownership.ts";
import { publishChannel, type Channel } from "../versions/channels.ts";
import type { Role } from "../auth/users.ts";
import type {
  ConflictKind,
  PrepareOk,
  PrepareResult,
  PublishRequestBody,
  ValidateArtifactView,
  ValidateExistingView,
} from "./types.ts";

/** When the publish body omits version, prefer a valid semver from the plugin manifest. */
function versionFromPluginManifest(artifact: ParsedArtifact): string | null {
  if (artifact.type !== "plugin") return null;
  const file = artifact.canonical.find((f) => f.path === ".claude-plugin/plugin.json");
  if (!file) return null;
  try {
    const raw = new TextDecoder().decode(file.content);
    const json = JSON.parse(raw) as { version?: unknown };
    if (typeof json.version !== "string") return null;
    const valid = semver.valid(json.version);
    if (!valid || valid !== json.version) return null;
    return json.version;
  } catch {
    return null;
  }
}

function decodeFiles(
  filesUnknown: unknown,
):
  | { ok: true; files: Array<{ path: string; content: Uint8Array }> }
  | { ok: false; message: string } {
  if (!Array.isArray(filesUnknown) || filesUnknown.length === 0) {
    return { ok: false, message: "files must be a non-empty array" };
  }
  const decoded: Array<{ path: string; content: Uint8Array }> = [];
  for (const entry of filesUnknown) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as { path?: unknown }).path !== "string" ||
      typeof (entry as { content_base64?: unknown }).content_base64 !== "string"
    ) {
      return { ok: false, message: "each file requires path and content_base64" };
    }
    const pathStr = (entry as { path: string }).path;
    const b64 = (entry as { content_base64: string }).content_base64;
    const content = decodeBase64Strict(b64);
    if (content === null) {
      return { ok: false, message: `invalid base64 for ${pathStr}` };
    }
    decoded.push({ path: pathStr, content });
  }
  return { ok: true, files: decoded };
}

function looksLikeReckonSkill(files: Array<{ path: string; content: Uint8Array }>): boolean {
  if (files.length !== 1) return false;
  const pathStr = files[0]!.path.replace(/\\/g, "/");
  if (!pathStr.toLowerCase().endsWith(".md")) return false;
  const text = Buffer.from(files[0]!.content).toString("utf8");
  if (!text.startsWith("---")) return false;
  const end = text.indexOf("\n---", 3);
  if (end < 0) return false;
  const fm = text.slice(3, end);
  return (
    /(?:^|\n)name\s*:/m.test(fm) &&
    /(?:^|\n)description\s*:/m.test(fm) &&
    /(?:^|\n)status\s*:/m.test(fm)
  );
}

/** Shared shape of a failed dry-run: no artifact, empty advisory fields. */
function preparedFailure(
  detected_type: ArtifactType | null,
  type: ArtifactType | null,
  errors: Issue[],
  warnings: Issue[],
  changelog: string | null,
  modelCompat: string[],
): PrepareOk {
  return {
    kind: "prepared",
    ok: false,
    detected_type,
    type,
    artifact: null,
    errors,
    warnings,
    quality: null,
    body_sha256: null,
    duplicates: [],
    existing: null,
    next_version: null,
    existingOwner: null,
    conflicts: [],
    parsed: null,
    version: null,
    channel: null,
    channelExplicit: false,
    changelog,
    modelCompat,
    visibility: "org",
    ownerTeam: null,
  };
}

function resolveType(
  bodyType: unknown,
  files: Array<{ path: string; content: Uint8Array }>,
): { type: ArtifactType | null; detected_type: ArtifactType | null } {
  const detected = detectArtifactType(files);
  if (typeof bodyType === "string" && isArtifactType(bodyType)) {
    return { type: bodyType as ArtifactType, detected_type: detected };
  }
  if (bodyType === undefined || bodyType === null || bodyType === "") {
    let detected_type = detected;
    if ((detected_type === null || detected_type === "command") && looksLikeReckonSkill(files)) {
      detected_type = "skill";
    }
    return { type: detected_type, detected_type };
  }
  // Explicit but unknown type string
  return { type: null, detected_type: detected };
}

/**
 * The highest version of any channel (purged ones included: their numbers stay taken). The latest stable version
 * is not enough: after a beta version the next patch of stable is already taken (upstream-mirror).
 */
function highestVersion(db: Database, artifactId: string): string | null {
  const rows = db
    .prepare("SELECT version FROM artifact_versions WHERE artifact_id = ?")
    .all(artifactId) as Array<{ version: string }>;
  const valid = rows.map((r) => r.version).filter((v) => semver.valid(v) !== null);
  return valid.sort(semver.rcompare)[0] ?? null;
}

function resolveVersion(
  db: Database,
  bodyVersion: unknown,
  artifact: ParsedArtifact,
  existingRow: ReturnType<typeof getArtifactByTypeName>,
): { version: string | null; next_version: string | null; conflicts: ConflictKind[] } {
  const conflicts: ConflictKind[] = [];
  const dupes = (version: string) => {
    if (existingRow) {
      if (hasVersion(db, existingRow.id, version)) conflicts.push("version_exists");
      if (hasDigest(db, existingRow.id, artifact.digest)) conflicts.push("digest_exists");
    }
  };

  if (bodyVersion !== undefined && bodyVersion !== null && bodyVersion !== "") {
    if (typeof bodyVersion !== "string") {
      conflicts.push("version_invalid");
      return { version: null, next_version: null, conflicts };
    }
    const valid = semver.valid(bodyVersion);
    if (!valid || valid !== bodyVersion) {
      conflicts.push("version_invalid");
      return { version: null, next_version: null, conflicts };
    }
    dupes(bodyVersion);
    return { version: bodyVersion, next_version: bodyVersion, conflicts };
  }

  const fromManifest = versionFromPluginManifest(artifact);
  if (fromManifest) {
    dupes(fromManifest);
    return { version: fromManifest, next_version: fromManifest, conflicts };
  }
  if (!existingRow) {
    return { version: "0.1.0", next_version: "0.1.0", conflicts };
  }
  const next = semver.inc(
    highestVersion(db, existingRow.id) ?? existingRow.latest_version ?? "0.1.0",
    "patch",
  );
  if (!next) {
    conflicts.push("version_invalid");
    return { version: null, next_version: null, conflicts };
  }
  if (hasDigest(db, existingRow.id, artifact.digest)) conflicts.push("digest_exists");
  return { version: next, next_version: next, conflicts };
}

type BodyBasics =
  | {
      ok: true;
      files: Array<{ path: string; content: Uint8Array }>;
      changelog: string | null;
      modelCompat: string[];
      name?: string;
      description?: string;
    }
  | { ok: false; message: string };

function normalizeChangelog(
  raw: unknown,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, message: "changelog must be a string" };
  return { ok: true, value: raw };
}

function normalizeModelCompat(
  raw: unknown,
): { ok: true; value: string[] } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw) || !raw.every((x) => typeof x === "string")) {
    return { ok: false, message: "model_compat must be an array of strings" };
  }
  return { ok: true, value: raw };
}

/** Decode files and normalize scalar fields; bad_request on malformed input. */
function decodeBodyBasics(body: PublishRequestBody): BodyBasics {
  const decoded = decodeFiles(body.files);
  if (!decoded.ok) {
    return { ok: false, message: decoded.message };
  }

  const changelog = normalizeChangelog(body.changelog);
  if (!changelog.ok) return { ok: false, message: changelog.message };

  const modelCompat = normalizeModelCompat(body.model_compat);
  if (!modelCompat.ok) return { ok: false, message: modelCompat.message };

  const name = typeof body.name === "string" ? body.name : undefined;
  const description = typeof body.description === "string" ? body.description : undefined;
  return {
    ok: true,
    files: decoded.files,
    changelog: changelog.value,
    modelCompat: modelCompat.value,
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
  };
}

/** Advisory not_owner conflict when the actor may not publish a new version. */
function ownershipConflict(
  db: Database,
  existingRow: ReturnType<typeof getArtifactByTypeName>,
  actor: { username: string; role: Role } | null | undefined,
  conflicts: ConflictKind[],
): string | null {
  if (!existingRow || !actor) return null;
  const right = canPublishVersion(db, actor.username, actor.role, {
    id: existingRow.id,
    owner: existingRow.owner,
  });
  if (right.allowed) return null;
  conflicts.push("not_owner");
  return right.owner;
}

/**
 * Dry-run path: decode, detect type, parse, compute next_version and conflicts.
 * MUST NOT write blobs, rows, or audit.
 */
/** Policies that can refuse a version: the security scan and the company and team quality rules (quality-rubric). */
function publishGates(
  db: Database,
  existingRow: { owner_team: string | null } | undefined,
  ownerTeam: string | null,
  quality: QualityReport,
  artifact: ParsedArtifact,
) {
  // The team of an existing artifact, or the team a first publication goes to.
  const rubric = rubricFor(db, existingRow?.owner_team ?? ownerTeam, quality, artifact);
  const blocked = [
    securityBlock(db, quality.security),
    rubricBlock(rubric),
    mcpPolicyBlock(db, artifact),
  ].filter((i): i is NonNullable<typeof i> => i !== null);
  return { rubric, blocked };
}

export function preparePublish(
  db: Database,
  body: PublishRequestBody,
  actor?: { username: string; role: Role } | null,
): PrepareResult {
  const basics = decodeBodyBasics(body);
  if (!basics.ok) {
    return { kind: "bad_request", message: basics.message };
  }
  const { files, changelog, modelCompat, name, description } = basics;

  const { type, detected_type } = resolveType(body.type, files);

  if (type === null) {
    return preparedFailure(
      detected_type,
      null,
      [
        {
          code: ISSUE_CODES.E_TYPE_UNKNOWN,
          message: "Could not detect artifact type; set type explicitly",
        },
      ],
      [],
      changelog,
      modelCompat,
    );
  }

  const parsed = parseArtifact({
    type,
    files,
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
  });

  if (!parsed.ok) {
    return preparedFailure(
      detected_type,
      type,
      parsed.errors,
      parsed.warnings,
      changelog,
      modelCompat,
    );
  }

  const artifact = parsed.artifact;
  const warnings = parsed.warnings;
  const existingRow = getArtifactByTypeName(db, type, artifact.name);
  const existing: ValidateExistingView | null = existingRow
    ? {
        latest_version: existingRow.latest_version,
        versions_count: rowToSummary(db, existingRow).versions_count,
        status: existingRow.status,
      }
    : null;

  const { version, next_version, conflicts } = resolveVersion(
    db,
    body.version,
    artifact,
    existingRow,
  );

  let channel: Channel | null = null;
  const channelExplicit = body.channel !== undefined && body.channel !== null;
  if (version !== null) {
    channel = publishChannel(body.channel, version);
    if (channel === null) conflicts.push("channel_invalid");
  }

  const view: ValidateArtifactView = {
    type: artifact.type,
    name: artifact.name,
    description: artifact.description,
    display_name: artifact.displayName,
    tags: artifact.tags,
    files: artifact.files,
    digest: artifact.digest,
    ...(artifact.components ? { components: artifact.components } : {}),
  };

  const body_sha256 = artifactBodyFingerprint(artifact);
  const duplicates = findRegistryDuplicates(
    {
      type: artifact.type,
      name: artifact.name,
      description: artifact.description,
      body_sha256,
      files: artifact.files,
    },
    listLatestVersionsForDuplicates(
      db,
      actor ? { username: actor.username, role: actor.role } : null,
    ),
  );

  const existingOwner = ownershipConflict(db, existingRow, actor, conflicts);

  // Normalized publish scope (validated in publishArtifact; ignored for existing artifacts).
  const visibility = typeof body.visibility === "string" ? body.visibility : "org";
  const ownerTeam = typeof body.owner_team === "string" ? body.owner_team : null;

  const quality = assessQuality(artifact);
  const { rubric, blocked } = publishGates(db, existingRow, ownerTeam, quality, artifact);
  return {
    kind: "prepared",
    ok: blocked.length === 0,
    detected_type,
    type,
    artifact: view,
    errors: blocked,
    rubric,
    warnings,
    quality,
    body_sha256,
    duplicates,
    existing,
    next_version,
    conflicts,
    existingOwner,
    parsed: artifact,
    version,
    channel,
    channelExplicit,
    changelog,
    modelCompat,
    visibility,
    ownerTeam,
  };
}
