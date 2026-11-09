import { toPublishFiles } from "../publish/files.ts";
import {
  archivesAllowed,
  freshnessOf,
  isSourceAllowed,
  loadImportPolicy,
  recordCommitSeen,
} from "./policy.ts";
import { scanImportTree } from "@skillforge/core";
import type { AppConfig } from "../config.ts";
import { getArtifactByTypeName, type Database } from "../repo.ts";
import { preparePublish, commitPublish, type PrepareOk } from "../publish.ts";
import { publishGate } from "../hooks/engine.ts";
import { loadImport, deleteImport, type ImportMeta } from "./store.ts";
import { filesForPrepare, pluginMetaFromTree } from "./preview.ts";
import type { MaterializedFile } from "./sources.ts";
import type { Role } from "../auth/users.ts";

const PROVENANCE_SOURCES = new Set(["human", "reckon", "agentspace", "dreamteam", "import"]);

export type RunResultItem = {
  id: string;
  type: string;
  name: string;
  status: "created" | "skipped" | "failed";
  version?: string;
  reason?: string;
  owner?: string;
  errors?: unknown[];
};

export type RunOk = { ok: true; results: RunResultItem[] };
export type RunErr = {
  ok: false;
  error: string;
  status: number;
  message?: string;
  ready_at?: string;
};

export type ImportCandidate = {
  /** The artifact already exists in the registry (upstream-mirror publishes such updates to beta). */
  exists: boolean;
  id: string;
  type: string;
  nameHint: string;
  root: string;
  files: Array<{ path: string; content: string | Uint8Array }>;
  provenance: { source: string; ref: string | null };
};

type ImportTree = Parameters<typeof pluginMetaFromTree>[0];
type Prepared = ReturnType<typeof preparePublish>;
type Committed = ReturnType<typeof commitPublish>;

export type ImportRunContext = {
  /** upstream-mirror: a new version of an existing artifact goes to the beta channel. */
  betaForExisting?: boolean;
  ageOverrideReason?: string;
  db: Database;
  config: AppConfig;
  dataDir: string;
  actor: string;
  role: Role;
  importId: string;
  meta: { kind: string; ref: string };
  tree: ImportTree;
  provenanceSource: string | undefined;
  /** upstream-mirror: provenance ref is this prefix and the package folder (address@commit:root). */
  provenanceRefPrefix?: string;
  skipConflicts: boolean;
};

function preparePublishBody(
  c: { type: string; files: ImportCandidate["files"]; root: string; nameHint: string },
  tree: ImportTree,
): Record<string, unknown> {
  const preparedFiles = filesForPrepare(c.type, c.files);
  const body: Record<string, unknown> = {
    type: c.type,
    files: toPublishFiles(preparedFiles),
  };
  if (c.type === "hook") {
    const plugin = pluginMetaFromTree(tree, c.root);
    body.name = c.nameHint || plugin.name;
    if (plugin.description) body.description = plugin.description;
  }
  return body;
}

function conflictResult(
  db: Database,
  c: ImportCandidate,
  prepared: PrepareOk,
  skipConflicts: boolean,
): RunResultItem {
  const reason = prepared.conflicts.includes("digest_exists")
    ? "digest_exists"
    : prepared.conflicts.includes("version_exists")
      ? "version_exists"
      : prepared.conflicts[0]!;
  // Team scope hides the owner name (same rule as publish/commit).
  const existingRow =
    prepared.existingOwner && prepared.artifact
      ? getArtifactByTypeName(db, c.type, prepared.artifact.name)
      : null;
  const owner =
    prepared.existingOwner && existingRow?.visibility !== "team"
      ? { owner: prepared.existingOwner }
      : {};
  if (skipConflicts) {
    return {
      id: c.id,
      type: c.type,
      name: prepared.artifact?.name ?? c.nameHint,
      status: "skipped",
      reason,
      ...owner,
    };
  }
  return {
    id: c.id,
    type: c.type,
    name: prepared.artifact?.name ?? c.nameHint,
    status: "failed",
    reason,
    errors: prepared.errors,
    ...owner,
  };
}

function committedResult(
  c: ImportCandidate,
  committed: Committed,
  skipConflicts: boolean,
): RunResultItem {
  if (committed.kind === "created") {
    return {
      id: c.id,
      type: c.type,
      name: committed.artifact.name,
      status: "created",
      version: committed.version.version,
    };
  }
  if (committed.kind === "digest_exists" || committed.kind === "version_exists") {
    return {
      id: c.id,
      type: c.type,
      name: c.nameHint,
      status: skipConflicts ? "skipped" : "failed",
      reason: committed.kind,
    };
  }
  if (committed.kind === "validation_failed") {
    return {
      id: c.id,
      type: c.type,
      name: c.nameHint,
      status: "failed",
      errors: committed.errors,
    };
  }
  if (committed.kind === "not_owner") {
    return {
      id: c.id,
      type: c.type,
      name: c.nameHint,
      status: "failed",
      reason: "not_owner",
      ...(committed.owner ? { owner: committed.owner } : {}),
    };
  }
  return {
    id: c.id,
    type: c.type,
    name: c.nameHint,
    status: "failed",
    reason: committed.kind,
  };
}

/** Rebuild candidate list with resolved ids (same as preview). */
export function resolveCandidates(
  ctx: Pick<ImportRunContext, "db" | "actor" | "role">,
  scanned: ReturnType<typeof scanImportTree>,
  tree: ImportTree,
): ImportCandidate[] {
  const candidates: ImportCandidate[] = [];
  for (const c of scanned.candidates) {
    const body = preparePublishBody(c, tree);
    const prepared: Prepared = preparePublish(ctx.db, body, {
      username: ctx.actor,
      role: ctx.role,
    });
    const name =
      prepared.kind === "prepared" && prepared.artifact ? prepared.artifact.name : c.nameHint;
    candidates.push({
      exists: prepared.kind === "prepared" && prepared.existing !== null,
      id: `${c.type}/${name}`,
      type: c.type,
      nameHint: name,
      root: c.root,
      files: c.files,
      provenance: c.provenance,
    });
  }
  return candidates;
}

function provenanceRef(ctx: ImportRunContext, c: ImportCandidate): string | null {
  if (!ctx.provenanceRefPrefix) return c.provenance.ref;
  return c.root ? `${ctx.provenanceRefPrefix}:${c.root}` : ctx.provenanceRefPrefix;
}

/** The publish body of a candidate; a mirror sends updates of existing artifacts to beta. */
function candidateBody(ctx: ImportRunContext, c: ImportCandidate): Record<string, unknown> {
  const body = preparePublishBody(c, ctx.tree);
  if (ctx.betaForExisting && c.exists) body.channel = "beta";
  return body;
}

export async function importCandidate(
  ctx: ImportRunContext,
  c: ImportCandidate,
): Promise<RunResultItem> {
  const { db, dataDir, actor, role } = ctx;
  const body = candidateBody(ctx, c);

  const prepared = preparePublish(db, body, { username: actor, role });
  if (prepared.kind === "bad_request") {
    return {
      id: c.id,
      type: c.type,
      name: c.nameHint,
      status: "failed",
      errors: [{ code: "bad_request", message: prepared.message }],
    };
  }

  if (!prepared.ok) {
    return {
      id: c.id,
      type: c.type,
      name: prepared.artifact?.name ?? c.nameHint,
      status: "failed",
      errors: prepared.errors,
    };
  }

  if (prepared.conflicts.length > 0) {
    return conflictResult(db, c, prepared, ctx.skipConflicts);
  }

  // Same hook publish gate as POST /artifacts — imports must not bypass it
  //. Run before blobs are written by commitPublish.
  const gate = await publishGate(
    db,
    dataDir,
    actor,
    {
      type: prepared.type ?? c.type,
      name: prepared.artifact?.name ?? c.nameHint,
    },
    ctx.config,
  );
  if (gate.decision === "block") {
    return {
      id: c.id,
      type: c.type,
      name: prepared.artifact?.name ?? c.nameHint,
      status: "failed",
      reason: "publish_blocked",
    };
  }

  const provenance = ctx.provenanceSource
    ? { source: ctx.provenanceSource, ref: provenanceRef(ctx, c) }
    : c.provenance;

  const withMeta: PrepareOk & {
    provenance: { source: string; ref: string | null };
    importMeta: { kind: string; ref: string; import_id: string; age_override?: string };
  } = {
    ...prepared,
    provenance,
    importMeta: {
      kind: ctx.meta.kind,
      ref: ctx.meta.ref,
      import_id: ctx.importId,
      ...(ctx.ageOverrideReason ? { age_override: ctx.ageOverrideReason } : {}),
    },
  };

  const committed = commitPublish({ db, dataDir, actor, role }, withMeta);
  return committedResult(c, committed, ctx.skipConflicts);
}

/** The policy again at run time: it can change after the preview, and the quarantine ends on its own. */
function refusedByPolicy(
  db: Database,
  meta: ImportMeta,
  role: Role,
  ageOverrideReason: string | undefined,
): RunErr | null {
  const policy = loadImportPolicy(db);
  if (meta.kind !== "git") {
    return archivesAllowed(policy, role)
      ? null
      : { ok: false, error: "import_archives_disabled", status: 403 };
  }
  if (!meta.git) return null;
  if (!isSourceAllowed(policy, meta.git.url)) {
    return { ok: false, error: "import_source_not_allowed", status: 403 };
  }
  const fresh = freshnessOf(policy, recordCommitSeen(db, meta.git.location_key, meta.git.commit));
  if (fresh.ready) return null;
  if (ageOverrideReason !== undefined) {
    return role === "admin" ? null : { ok: false, error: "forbidden", status: 403 };
  }
  return { ok: false, error: "import_too_fresh", status: 409, ready_at: fresh.ready_at };
}

export async function runImport(opts: {
  db: Database;
  config: AppConfig;
  dataDir: string;
  userId: string;
  actor: string;
  role: Role;
  importId: string;
  selected: string[] | "all";
  provenanceSource?: string;
  skipConflicts?: boolean;
  ageOverrideReason?: string;
}): Promise<RunOk | RunErr> {
  const {
    db,
    config,
    dataDir,
    userId,
    actor,
    role,
    importId,
    selected,
    provenanceSource,
    skipConflicts = true,
    ageOverrideReason,
  } = opts;

  if (provenanceSource !== undefined && !PROVENANCE_SOURCES.has(provenanceSource)) {
    return { ok: false, error: "bad_request", status: 400, message: "invalid provenance_source" };
  }

  const loaded = loadImport(dataDir, importId, userId);
  if (!loaded.ok) {
    // Acceptance: missing and expired both 410 import_expired
    if (loaded.error === "forbidden") {
      return { ok: false, error: "not_found", status: 404 };
    }
    return { ok: false, error: "import_expired", status: 410 };
  }

  const { meta, files } = loaded;
  const refused = refusedByPolicy(db, meta, role, ageOverrideReason);
  if (refused) return refused;
  const scanned = scanImportTree(files.map((f) => ({ path: f.path, content: f.content })));

  // Rebuild candidate list with resolved ids (same as preview)
  const candidates = resolveCandidates({ db, actor, role }, scanned, files);

  const selectedIds = selected === "all" ? candidates.map((c) => c.id) : selected;
  const selectedSet = new Set(selectedIds);
  const toRun = candidates.filter((c) => selectedSet.has(c.id));

  const results: RunResultItem[] = [];

  const ctx: ImportRunContext = {
    db,
    config,
    dataDir,
    actor,
    role,
    importId,
    meta,
    tree: files as MaterializedFile[],
    provenanceSource,
    skipConflicts,
    ...(ageOverrideReason ? { ageOverrideReason } : {}),
  };

  try {
    for (const c of toRun) {
      results.push(await importCandidate(ctx, c));
    }
  } finally {
    deleteImport(dataDir, importId);
  }

  void config;
  return { ok: true, results };
}
