import { listBadges, type ArtifactBadge } from "./plugins/badges.ts";
import type { RubricResult } from "./quality/rubric.ts";
import { bumpRegistryEpoch } from "./registry-epoch.ts";
import type { DatabaseSync } from "node:sqlite";
import type {
  Issue,
  QualityGrade,
  QualityReport,
  PluginComponent,
  AgentCompat,
  AgentDeclaration,
  RuntimeId,
} from "@skillforge/core";
import {
  ARTIFACT_TYPES,
  isArtifactType,
  supportedAgents,
  unsupportedAgents,
} from "@skillforge/core";
import semver from "semver";
import { listMaintainers } from "./ownership.ts";
import type { Channel } from "./versions/channels.ts";
import {
  ablationSummaryFromEvidence,
  normalizeEvidence,
  type EvidenceRecord,
} from "./evidence/evidence.ts";
import { usageStats, type UsageStats } from "./evidence/usage.ts";
import { visibleClause } from "./visibility/sql.ts";
import type { Viewer } from "./visibility/index.ts";

export type Database = DatabaseSync;

export type QualitySummary = {
  score: number;
  grade: QualityGrade;
  security: "pass" | "warn" | "fail" | null;
  /** context-cost: level of the latest version's context cost. */
  context: "low" | "medium" | "high" | null;
};

export type ArtifactSummary = {
  replaced_by: string | null;
  /** plugin-artifact-badges: badges of enabled plugins. */
  badges: ArtifactBadge[];
  type: string;
  name: string;
  description: string;
  display_name: string | null;
  tags: string[];
  labels: string[];
  status: string;
  visibility: string;
  owner_team: string | null;
  owner: string;
  maintainers: string[];
  latest_version: string | null;
  versions_count: number;
  download_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  quality: QualitySummary | null;
  skill_age_days?: number;
  purged_at?: string | null;
  purged_by?: string | null;
  /** artifact-agent-compat: agents the type installs into and the author's declaration. */
  agents: AgentCompat;
};

export type VersionDetail = {
  version: string;
  digest: string;
  channel: Channel;
  description: string;
  display_name: string | null;
  tags: string[];
  frontmatter: Record<string, unknown> | null;
  files: Array<{ path: string; sha256: string; size: number }>;
  warnings: Issue[];
  quality: QualityReport | null;
  changelog: string | null;
  model_compat: string[];
  /** Agents declared when this version was published. */
  agents: AgentDeclaration[];
  provenance: { source: string; ref: string | null };
  evidence: EvidenceRecord[];
  ablation: {
    tasks: number;
    passed_with: number;
    passed_without: number;
    uplift: number;
    at: string | null;
    by: string | null;
  } | null;
  validated_at: string | null;
  use_count: number;
  help_count: number;
  usage: UsageStats;
  published_by: string;
  published_at: string;
  components?: PluginComponent[];
  purged?: boolean;
  purged_at?: string | null;
  /** release-signing: null for a version not signed yet. */
  signature: { alg: "ed25519"; key_id: string; sig: string } | null;
  /** quality-rubric: score by company and team rules at publish; null when they were off. */
  rubric?: RubricResult | null;
};

export type VersionListItem = {
  version: string;
  digest: string;
  channel: Channel;
  published_at: string;
  published_by: string;
  purged?: boolean;
  purged_at?: string | null;
};

export type AuditEvent = {
  id: number;
  ts: string;
  actor: string;
  action: string;
  version: string | null;
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
  meta: Record<string, unknown> | null;
};

export type ArtifactRow = {
  id: string;
  type: string;
  name: string;
  description: string;
  display_name: string | null;
  tags: string;
  labels: string;
  status: string;
  visibility: string;
  owner_team: string | null;
  owner: string;
  latest_version: string | null;
  download_count: number | bigint;
  created_by: string;
  created_at: string;
  updated_at: string;
  meta_override: string | null;
  purged_at: string | null;
  purged_by: string | null;
  agents: string;
  /** artifact-replacement: type/name of the successor. */
  replaced_by?: string | null;
};

type VersionRow = {
  signature?: string | null;
  rubric?: string | null;
  id: string;
  artifact_id: string;
  version: string;
  digest: string;
  channel: string;
  description: string;
  display_name: string | null;
  tags: string;
  frontmatter: string | null;
  components?: string | null;
  files: string;
  warnings: string;
  quality: string | null;
  changelog: string | null;
  model_compat: string;
  agents: string;
  provenance: string;
  evidence: string;
  validated_at: string | null;
  use_count: number | bigint;
  help_count: number | bigint;
  published_by: string;
  published_at: string;
  purged_at: string | null;
};

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

/** `{score, grade}` of the latest version, selected alongside the artifact row. */
const LATEST_QUALITY_SQL = `(SELECT quality FROM artifact_versions
   WHERE artifact_id = artifacts.id AND version = artifacts.latest_version)`;

function qualitySummary(raw: string | null | undefined): QualitySummary | null {
  if (!raw) return null;
  const report = parseJson<QualityReport>(raw);
  return {
    score: report.score,
    grade: report.grade,
    security: report.security?.verdict ?? null,
    context: report.context?.level ?? null,
  };
}

function summaryStats(
  db: Database,
  artifactId: string,
): { versions_count: number; latest_quality: string | null } {
  const row = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM artifact_versions WHERE artifact_id = artifacts.id) AS versions_count,
        ${LATEST_QUALITY_SQL} AS latest_quality
       FROM artifacts WHERE artifacts.id = ?`,
    )
    .get(artifactId) as { versions_count: number | bigint; latest_quality: string | null };
  return { versions_count: Number(row.versions_count), latest_quality: row.latest_quality };
}

export function rowToSummary(db: Database, row: ArtifactRow): ArtifactSummary {
  const stats = summaryStats(db, row.id);
  return {
    type: row.type,
    name: row.name,
    description: row.description,
    display_name: row.display_name,
    tags: parseJson<string[]>(row.tags),
    labels: parseJson<string[]>(row.labels),
    status: row.status,
    visibility: row.visibility,
    owner_team: row.owner_team,
    owner: row.owner,
    maintainers: listMaintainers(db, row.id),
    latest_version: row.latest_version,
    versions_count: stats.versions_count,
    download_count: Number(row.download_count ?? 0),
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    quality: qualitySummary(stats.latest_quality),
    purged_at: row.purged_at,
    purged_by: row.purged_by,
    agents: agentCompat(row.type, row.agents),
    replaced_by: row.replaced_by ?? null,
    badges: listBadges(db, row.id),
  };
}

/** Computed support by type plus the effective declaration stored on the artifact row. */
export function agentCompat(type: string, raw: string | null | undefined): AgentCompat {
  return {
    supported: isArtifactType(type) ? supportedAgents(type) : [],
    unsupported: isArtifactType(type) ? unsupportedAgents(type) : [],
    declared: raw ? parseJson<AgentDeclaration[]>(raw) : [],
  };
}

export function rowToVersionDetail(row: VersionRow): VersionDetail {
  const frontmatter = row.frontmatter ? parseJson<Record<string, unknown>>(row.frontmatter) : null;
  let components: PluginComponent[] | undefined;
  if (row.components) {
    const parsed = parseJson<unknown>(row.components);
    if (Array.isArray(parsed)) components = parsed as PluginComponent[];
  }
  return {
    version: row.version,
    digest: row.digest,
    channel: row.channel === "beta" ? "beta" : "stable",
    description: row.description,
    display_name: row.display_name,
    tags: parseJson<string[]>(row.tags),
    frontmatter,
    files: parseJson<Array<{ path: string; sha256: string; size: number }>>(row.files),
    warnings: parseJson<Issue[]>(row.warnings),
    quality: row.quality ? parseJson<QualityReport>(row.quality) : null,
    changelog: row.changelog,
    model_compat: parseJson<string[]>(row.model_compat),
    agents: row.agents ? parseJson<AgentDeclaration[]>(row.agents) : [],
    provenance: parseJson<{ source: string; ref: string | null }>(row.provenance),
    ...(() => {
      const evidence = normalizeEvidence(parseJson<unknown>(row.evidence));
      return { evidence, ablation: ablationSummaryFromEvidence(evidence) };
    })(),
    validated_at: row.validated_at,
    use_count: Number(row.use_count),
    help_count: Number(row.help_count),
    usage: usageStats(Number(row.use_count), Number(row.help_count)),
    published_by: row.published_by,
    published_at: row.published_at,
    purged: row.purged_at !== null,
    purged_at: row.purged_at,
    signature: row.signature ? parseJson<VersionDetail["signature"]>(row.signature) : null,
    rubric: row.rubric ? parseJson<RubricResult>(row.rubric) : null,
    ...(components ? { components } : {}),
  };
}

export function getArtifactByTypeName(
  db: Database,
  type: string,
  name: string,
): ArtifactRow | undefined {
  return db.prepare("SELECT * FROM artifacts WHERE type = ? AND name = ?").get(type, name) as
    ArtifactRow | undefined;
}

export function getArtifactById(db: Database, id: string): ArtifactRow | undefined {
  return db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as ArtifactRow | undefined;
}

export function createArtifact(
  db: Database,
  input: {
    id: string;
    type: string;
    name: string;
    description: string;
    display_name: string | null;
    tags: string[];
    agents?: AgentDeclaration[];
    created_by: string;
    latest_version: string;
    now: string;
    visibility?: string;
    owner_team?: string | null;
    labels?: string[];
  },
): ArtifactRow {
  const visibility = input.visibility ?? "org";
  const ownerTeam = input.owner_team ?? null;
  const labels = JSON.stringify(input.labels ?? []);
  db.prepare(
    `INSERT INTO artifacts (
      id, type, name, description, display_name, tags, agents, labels, status, visibility, owner_team, owner,
      latest_version, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.type,
    input.name,
    input.description,
    input.display_name,
    JSON.stringify(input.tags),
    JSON.stringify(input.agents ?? []),
    labels,
    visibility,
    ownerTeam,
    input.created_by,
    input.latest_version,
    input.created_by,
    input.now,
    input.now,
  );
  bumpRegistryEpoch();
  return getArtifactById(db, input.id)!;
}

export function updateArtifactOnPublish(
  db: Database,
  artifactId: string,
  input: {
    description: string;
    display_name: string | null;
    tags: string[];
    agents?: AgentDeclaration[];
    latest_version: string;
    now: string;
  },
): void {
  const row = getArtifactById(db, artifactId)!;
  const effective = applyOverride({ ...input, agents: input.agents ?? [] }, row.meta_override);
  db.prepare(
    `UPDATE artifacts
     SET description = ?, display_name = ?, tags = ?, agents = ?, latest_version = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    effective.description,
    effective.display_name,
    JSON.stringify(effective.tags),
    JSON.stringify(effective.agents),
    input.latest_version,
    input.now,
    artifactId,
  );
  bumpRegistryEpoch();
}

export type Metadata = {
  description: string;
  display_name: string | null;
  tags: string[];
  agents: AgentDeclaration[];
};
export function applyOverride(base: Metadata, raw: string | null): Metadata {
  const override = raw ? (JSON.parse(raw) as Partial<Metadata>) : {};
  return {
    description: override.description ?? base.description,
    display_name: override.display_name ?? base.display_name,
    tags: override.tags ?? base.tags,
    agents: override.agents ?? base.agents,
  };
}

export function insertVersion(
  db: Database,
  input: {
    id: string;
    artifact_id: string;
    version: string;
    digest: string;
    /** Defaults to `beta` for semver pre-releases, otherwise `stable`. */
    channel?: Channel;
    description: string;
    display_name: string | null;
    tags: string[];
    frontmatter: Record<string, unknown> | null;
    components?: PluginComponent[];
    files: Array<{ path: string; sha256: string; size: number }>;
    warnings: Issue[];
    quality?: QualityReport | null;
    body_sha256?: string | null;
    changelog: string | null;
    model_compat: string[];
    agents?: AgentDeclaration[];
    provenance: { source: string; ref: string | null };
    evidence: Array<{ kind: string; url: string }>;
    published_by: string;
    published_at: string;
  },
): VersionDetail {
  db.prepare(
    `INSERT INTO artifact_versions (
      id, artifact_id, version, digest, channel, description, display_name, tags, frontmatter, components, files,
      warnings, quality, body_sha256, changelog, model_compat, agents, provenance, evidence, validated_at, use_count, help_count,
      published_by, published_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 0, ?, ?)`,
  ).run(
    input.id,
    input.artifact_id,
    input.version,
    input.digest,
    input.channel ?? (semver.prerelease(input.version) ? "beta" : "stable"),
    input.description,
    input.display_name,
    JSON.stringify(input.tags),
    input.frontmatter === null ? null : JSON.stringify(input.frontmatter),
    input.components === undefined ? null : JSON.stringify(input.components),
    JSON.stringify(input.files),
    JSON.stringify(input.warnings),
    (input.quality ?? null) === null ? null : JSON.stringify(input.quality),
    input.body_sha256 ?? null,
    input.changelog,
    JSON.stringify(input.model_compat),
    JSON.stringify(input.agents ?? []),
    JSON.stringify(input.provenance),
    JSON.stringify(input.evidence),
    input.published_by,
    input.published_at,
  );
  bumpRegistryEpoch();
  return getVersion(db, input.artifact_id, input.version)!;
}

export function hasVersion(db: Database, artifactId: string, version: string): boolean {
  const row = db
    .prepare("SELECT 1 AS n FROM artifact_versions WHERE artifact_id = ? AND version = ?")
    .get(artifactId, version);
  return row !== undefined;
}

export function hasDigest(db: Database, artifactId: string, digest: string): boolean {
  const row = db
    .prepare("SELECT 1 AS n FROM artifact_versions WHERE artifact_id = ? AND digest = ?")
    .get(artifactId, digest);
  return row !== undefined;
}

export function getVersion(
  db: Database,
  artifactId: string,
  version: string,
): VersionDetail | undefined {
  const row = db
    .prepare("SELECT * FROM artifact_versions WHERE artifact_id = ? AND version = ?")
    .get(artifactId, version) as VersionRow | undefined;
  return row ? rowToVersionDetail(row) : undefined;
}

/** Atomically add an evidence entry to a version's evidence JSON column (no duplicate urls). */
export function addVersionEvidence(
  db: Database,
  artifactId: string,
  version: string,
  evidence: { kind: string; url: string },
): EvidenceRecord[] | null {
  const row = db
    .prepare("SELECT evidence FROM artifact_versions WHERE artifact_id = ? AND version = ?")
    .get(artifactId, version) as { evidence: string } | undefined;
  if (!row) return null;
  const existing = normalizeEvidence(parseJson<unknown>(row.evidence));
  if (existing.some((e) => e.url === evidence.url)) {
    return existing;
  }
  const next: EvidenceRecord[] = [
    ...existing,
    {
      kind: evidence.kind,
      url: evidence.url,
      summary: null,
      at: new Date().toISOString(),
      by: null,
    },
  ];
  db.prepare("UPDATE artifact_versions SET evidence = ? WHERE artifact_id = ? AND version = ?").run(
    JSON.stringify(next),
    artifactId,
    version,
  );
  return next;
}

export function listVersions(db: Database, artifactId: string): VersionDetail[] {
  const rows = db
    .prepare("SELECT * FROM artifact_versions WHERE artifact_id = ?")
    .all(artifactId) as VersionRow[];
  return rows.map(rowToVersionDetail).sort((a, b) => semver.rcompare(a.version, b.version));
}

export function listVersionSummaries(db: Database, artifactId: string): VersionListItem[] {
  const rows = db
    .prepare(
      "SELECT version, digest, channel, published_at, published_by, purged_at, purged_at IS NOT NULL AS purged FROM artifact_versions WHERE artifact_id = ?",
    )
    .all(artifactId) as unknown as VersionListItem[];
  return rows.sort((a, b) => semver.rcompare(a.version, b.version));
}

export function maxSemver(versions: string[]): string | null {
  if (versions.length === 0) return null;
  return versions.slice().sort((a, b) => semver.rcompare(a, b))[0]!;
}

function escapeLike(q: string): string {
  return q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function incrementDownloads(db: Database, artifactId: string): void {
  db.prepare(`UPDATE artifacts SET download_count = download_count + 1 WHERE id = ?`).run(
    artifactId,
  );
}

/** Types that install into `agent` (runtime table) and a declaration that is empty or names the agent. */
function agentClause(agent: RuntimeId, where: string[], params: Array<string | number>): void {
  const types = ARTIFACT_TYPES.map((t) => t.id).filter((t) => supportedAgents(t).includes(agent));
  where.push(types.length ? `type IN (${types.map(() => "?").join(", ")})` : "0");
  params.push(...types);
  where.push(
    "(json_array_length(artifacts.agents) = 0 OR EXISTS (SELECT 1 FROM json_each(artifacts.agents) AS a WHERE json_extract(a.value, '$.runtime') = ?))",
  );
  params.push(agent);
}

export function listArtifacts(
  db: Database,
  filters: {
    type?: string;
    status?: string;
    tag?: string;
    q?: string;
    team?: string;
    owner?: string;
    label?: string;
    visibility?: string;
    mcpTags?: string[];
    /** artifact-agent-compat: the type installs into this agent and the declaration is empty or lists it. */
    agent?: RuntimeId;
    viewer?: Viewer;
    sort?: "updated" | "downloads";
    limit: number;
    offset: number;
  },
): { items: ArtifactSummary[]; total: number } {
  const where: string[] = [];
  const params: Array<string | number> = [];

  const vis = visibleClause(filters.viewer ?? null, "artifacts");
  where.push(vis.sql);
  params.push(...vis.params);

  if (filters.type) {
    where.push("type = ?");
    params.push(filters.type);
  }
  if (filters.status) {
    where.push("status = ?");
    params.push(filters.status);
  }
  if (filters.tag) {
    where.push("EXISTS (SELECT 1 FROM json_each(artifacts.tags) AS t WHERE t.value = ?)");
    params.push(filters.tag);
  }
  if (filters.label) {
    where.push("EXISTS (SELECT 1 FROM json_each(artifacts.labels) AS l WHERE l.value = ?)");
    params.push(filters.label);
  }
  if (filters.team) {
    where.push("owner_team = ?");
    params.push(filters.team);
  }
  if (filters.owner) {
    where.push("owner = ?");
    params.push(filters.owner);
  }
  if (filters.visibility) {
    where.push("visibility = ?");
    params.push(filters.visibility);
  }
  if (filters.mcpTags && filters.mcpTags.length > 0) {
    const placeholders = filters.mcpTags.map(() => "?").join(", ");
    where.push(
      `(EXISTS (SELECT 1 FROM json_each(artifacts.tags) AS t WHERE t.value IN (${placeholders}))` +
        ` OR EXISTS (SELECT 1 FROM json_each(artifacts.labels) AS l WHERE l.value IN (${placeholders})))`,
    );
    params.push(...filters.mcpTags, ...filters.mcpTags);
  }
  if (filters.agent) agentClause(filters.agent, where, params);
  if (filters.q) {
    const like = `%${escapeLike(filters.q)}%`;
    where.push(
      "(name LIKE ? ESCAPE '\\' COLLATE NOCASE OR description LIKE ? ESCAPE '\\' COLLATE NOCASE OR tags LIKE ? ESCAPE '\\' COLLATE NOCASE)",
    );
    params.push(like, like, like);
  }

  const whereSql = `WHERE ${where.join(" AND ")}`;
  const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM artifacts ${whereSql}`).get(...params) as {
    n: number | bigint;
  };
  const total = Number(totalRow.n);

  type ListRow = ArtifactRow & { versions_count: number | bigint; latest_quality: string | null };
  const orderBy =
    filters.sort === "downloads"
      ? "download_count DESC, updated_at DESC, name ASC"
      : "updated_at DESC, name ASC";
  const rows = db
    .prepare(
      `SELECT artifacts.*,
        (SELECT COUNT(*) FROM artifact_versions WHERE artifact_id = artifacts.id) AS versions_count,
        ${LATEST_QUALITY_SQL} AS latest_quality
       FROM artifacts ${whereSql}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, filters.limit, filters.offset) as ListRow[];

  return {
    items: rows.map((r) => ({
      type: r.type,
      name: r.name,
      description: r.description,
      display_name: r.display_name,
      tags: parseJson<string[]>(r.tags),
      labels: parseJson<string[]>(r.labels),
      status: r.status,
      visibility: r.visibility,
      owner_team: r.owner_team,
      owner: r.owner,
      maintainers: listMaintainers(db, r.id),
      latest_version: r.latest_version,
      versions_count: Number(r.versions_count),
      download_count: Number(r.download_count ?? 0),
      created_by: r.created_by,
      created_at: r.created_at,
      updated_at: r.updated_at,
      quality: qualitySummary(r.latest_quality),
      agents: agentCompat(r.type, r.agents),
      replaced_by: r.replaced_by ?? null,
      badges: listBadges(db, r.id),
    })),
    total,
  };
}

export type VersionForQuality = {
  id: string;
  type: string;
  name: string;
  description: string;
  frontmatter: Record<string, unknown> | null;
  files: Array<{ path: string; sha256: string; size: number }>;
};

/** Versions whose report is missing or produced by an older algorithm. */
export function listVersionsNeedingQuality(db: Database, algorithm: number): VersionForQuality[] {
  const rows = db
    .prepare(
      `SELECT v.id, a.type, a.name, v.description, v.frontmatter, v.files
       FROM artifact_versions v JOIN artifacts a ON a.id = v.artifact_id
       WHERE v.purged_at IS NULL AND (v.quality IS NULL OR json_extract(v.quality, '$.algorithm') < ?)
       ORDER BY v.id`,
    )
    .all(algorithm) as Array<{
    id: string;
    type: string;
    name: string;
    description: string;
    frontmatter: string | null;
    files: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    description: r.description,
    frontmatter: r.frontmatter ? parseJson<Record<string, unknown>>(r.frontmatter) : null,
    files: parseJson(r.files),
  }));
}

export function setVersionQuality(db: Database, versionId: string, report: QualityReport): void {
  db.prepare("UPDATE artifact_versions SET quality = ? WHERE id = ?").run(
    JSON.stringify(report),
    versionId,
  );
}

export type VersionForFingerprint = {
  id: string;
  type: string;
  name: string;
  files: Array<{ path: string; sha256: string; size: number }>;
};

/** Versions without a body fingerprint (backfilled at startup). */
export function listVersionsNeedingBodyFingerprint(db: Database): VersionForFingerprint[] {
  const rows = db
    .prepare(
      `SELECT v.id, a.type, a.name, v.files
       FROM artifact_versions v JOIN artifacts a ON a.id = v.artifact_id
       WHERE v.body_sha256 IS NULL AND v.purged_at IS NULL
       ORDER BY v.id`,
    )
    .all() as Array<{ id: string; type: string; name: string; files: string }>;
  return rows.map((r) => ({ id: r.id, type: r.type, name: r.name, files: parseJson(r.files) }));
}

export function setVersionBodySha256(db: Database, versionId: string, sha256: string): void {
  db.prepare("UPDATE artifact_versions SET body_sha256 = ? WHERE id = ?").run(sha256, versionId);
}

/** Latest version of an artifact as seen by duplicate detection. */
export type LatestVersionForDuplicates = {
  type: string;
  name: string;
  description: string;
  body_sha256: string | null;
  files: Array<{ path: string; sha256: string; size: number }>;
};

const LATEST_FOR_DUPLICATES_SQL = `SELECT a.type, a.name, v.description, v.body_sha256, v.files
   FROM artifacts a JOIN artifact_versions v
     ON v.artifact_id = a.id AND v.version = a.latest_version AND v.purged_at IS NULL`;

type LatestForDuplicatesRow = {
  type: string;
  name: string;
  description: string;
  body_sha256: string | null;
  files: string;
};

function mapLatestForDuplicates(r: LatestForDuplicatesRow): LatestVersionForDuplicates {
  return {
    type: r.type,
    name: r.name,
    description: r.description,
    body_sha256: r.body_sha256,
    files: parseJson(r.files),
  };
}

/** Latest versions of all artifacts that are not retired, ordered by type then name. */
export function listLatestVersionsForDuplicates(
  db: Database,
  viewer: Viewer = null,
): LatestVersionForDuplicates[] {
  const vis = visibleClause(viewer, "a");
  const rows = db
    .prepare(
      `${LATEST_FOR_DUPLICATES_SQL} WHERE a.status <> 'retired' AND ${vis.sql} ORDER BY a.type, a.name`,
    )
    .all(...vis.params) as LatestForDuplicatesRow[];
  return rows.map(mapLatestForDuplicates);
}

export function getLatestVersionForDuplicates(
  db: Database,
  type: string,
  name: string,
): LatestVersionForDuplicates | undefined {
  const row = db
    .prepare(`${LATEST_FOR_DUPLICATES_SQL} WHERE a.type = ? AND a.name = ? AND a.purged_at IS NULL`)
    .get(type, name) as LatestForDuplicatesRow | undefined;
  return row ? mapLatestForDuplicates(row) : undefined;
}

export function appendAudit(
  db: Database,
  input: {
    ts: string;
    actor: string;
    artifact_id: string;
    version: string | null;
    action: string;
    from_status?: string | null;
    to_status?: string | null;
    reason?: string | null;
    meta?: Record<string, unknown> | null;
  },
): void {
  db.prepare(
    `INSERT INTO audit_events (
      ts, actor, artifact_id, version, action, from_status, to_status, reason, meta
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.ts,
    input.actor,
    input.artifact_id,
    input.version,
    input.action,
    input.from_status ?? null,
    input.to_status ?? null,
    input.reason ?? null,
    input.meta ? JSON.stringify(input.meta) : null,
  );
}

export function listAudit(db: Database, artifactId: string): AuditEvent[] {
  const rows = db
    .prepare(
      `SELECT id, ts, actor, action, version, from_status, to_status, reason, meta
       FROM audit_events
       WHERE artifact_id = ?
       ORDER BY ts DESC, id DESC`,
    )
    .all(artifactId) as Array<{
    id: number | bigint;
    ts: string;
    actor: string;
    action: string;
    version: string | null;
    from_status: string | null;
    to_status: string | null;
    reason: string | null;
    meta: string | null;
  }>;

  return rows.map((r) => ({
    id: Number(r.id),
    ts: r.ts,
    actor: r.actor,
    action: r.action,
    version: r.version,
    from_status: r.from_status,
    to_status: r.to_status,
    reason: r.reason,
    meta: r.meta ? parseJson<Record<string, unknown>>(r.meta) : null,
  }));
}

export type FacetCount = { value: string; count: number };

export type ArtifactsFacets = {
  types: FacetCount[];
  statuses: FacetCount[];
  teams: FacetCount[];
  owners: FacetCount[];
  labels: FacetCount[];
};

function facetRows(db: Database, sql: string, params: Array<string | number>): FacetCount[] {
  const rows = db.prepare(sql).all(...params) as Array<{ value: string; count: number | bigint }>;
  return rows
    .filter((r) => r.value !== null && r.value !== undefined && String(r.value) !== "")
    .map((r) => ({ value: String(r.value), count: Number(r.count) }));
}

/** Facet counts over artifacts visible to the viewer. */
export function listFacets(db: Database, viewer: Viewer = null): ArtifactsFacets {
  const vis = visibleClause(viewer, "artifacts");
  const where = `WHERE ${vis.sql}`;
  const types = facetRows(
    db,
    `SELECT type AS value, COUNT(*) AS count FROM artifacts ${where} GROUP BY type ORDER BY type`,
    vis.params,
  );
  const statuses = facetRows(
    db,
    `SELECT status AS value, COUNT(*) AS count FROM artifacts ${where} GROUP BY status ORDER BY status`,
    vis.params,
  );
  const teams = facetRows(
    db,
    `SELECT owner_team AS value, COUNT(*) AS count FROM artifacts ${where} AND owner_team IS NOT NULL GROUP BY owner_team ORDER BY owner_team`,
    vis.params,
  );
  const owners = facetRows(
    db,
    `SELECT owner AS value, COUNT(*) AS count FROM artifacts ${where} GROUP BY owner ORDER BY owner`,
    vis.params,
  );
  const labels = facetRows(
    db,
    `SELECT l.value AS value, COUNT(*) AS count FROM artifacts, json_each(artifacts.labels) AS l ${where} GROUP BY l.value ORDER BY l.value`,
    vis.params,
  );
  return { types, statuses, teams, owners, labels };
}

export function countArtifacts(db: Database): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM artifacts").get() as {
    n: number | bigint;
  };
  return Number(row.n);
}

export function listVersionStrings(db: Database, artifactId: string): string[] {
  const rows = db
    .prepare("SELECT version FROM artifact_versions WHERE artifact_id = ?")
    .all(artifactId) as Array<{ version: string }>;
  return rows.map((r) => r.version);
}
