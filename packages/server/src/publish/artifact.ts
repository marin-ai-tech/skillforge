import {
  AgentDeclarationError,
  isArtifactType,
  parseAgentDeclarations,
  type AgentDeclaration,
  type ArtifactType,
} from "@skillforge/core";
import { getArtifactByTypeName, getVersion } from "../repo.ts";
import { getTeamByName, isTeamMemberByUsername } from "../teams.ts";
import { roleAtLeast } from "../auth/users.ts";
import { getSuiteGate } from "../evals/suite.ts";
import { preparePublish } from "./prepare.ts";
import { commitPublish, conflictResult } from "./commit.ts";
import {
  PROVENANCE_SOURCES,
  type PrepareOk,
  type PublishCtx,
  type PublishRequestBody,
  type PublishResult,
} from "./types.ts";

type Provenance = { source: string; ref: string | null };

/** Parse body.provenance; null means invalid input. */
function parseProvenance(raw: unknown): Provenance | null {
  if (raw === undefined || raw === null) return { source: "human", ref: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as { source?: unknown; ref?: unknown };
  if (typeof p.source !== "string" || !PROVENANCE_SOURCES.has(p.source)) return null;
  if (p.ref !== undefined && p.ref !== null && typeof p.ref !== "string") return null;
  const ref = p.ref === undefined || p.ref === null ? null : p.ref;
  return { source: p.source, ref };
}

/** First-publication scope. Existing artifacts ignore scope fields. */
function firstPublicationScopeResult(ctx: PublishCtx, prepared: PrepareOk): PublishResult | null {
  if (prepared.visibility !== "team") return null;
  if (!prepared.ownerTeam) return { kind: "team_required" };
  if (!getTeamByName(ctx.db, prepared.ownerTeam)) return { kind: "team_unknown" };
  if (
    !roleAtLeast(ctx.role, "admin") &&
    !isTeamMemberByUsername(ctx.db, prepared.ownerTeam, ctx.actor)
  ) {
    return { kind: "not_team_member" };
  }
  return null;
}

/** True when body.type is present but not a known artifact type. */
function hasBadType(bodyType: unknown): boolean {
  return (
    bodyType !== undefined &&
    bodyType !== null &&
    bodyType !== "" &&
    (typeof bodyType !== "string" || !isArtifactType(bodyType))
  );
}

/** Advisory not_owner conflict prepared by the dry-run; team scope hides the owner. */
function notOwnerGuard(
  existing: ReturnType<typeof getArtifactByTypeName>,
  prepared: PrepareOk,
): PublishResult | null {
  if (!prepared.conflicts.includes("not_owner")) return null;
  if (existing && existing.visibility === "team") return { kind: "not_owner" };
  return { kind: "not_owner", owner: prepared.existingOwner ?? "" };
}

/** eval gate in publishArtifact: before digest/version conflicts. */
function evalGateGuard(
  ctx: PublishCtx,
  existing: ReturnType<typeof getArtifactByTypeName>,
  prepared: PrepareOk,
): PublishResult | null {
  const reject =
    existing !== undefined &&
    getSuiteGate(ctx.db, existing.id) === "required" &&
    prepared.channelExplicit &&
    prepared.channel === "stable";
  return reject ? { kind: "eval_gate_required" } : null;
}

/** All pre-commit guards against the prepared dry-run; null when clear to commit. */
function preCommitGuards(ctx: PublishCtx, prepared: PrepareOk): PublishResult | null {
  const existingForScope =
    prepared.type && prepared.artifact
      ? getArtifactByTypeName(ctx.db, prepared.type, prepared.artifact.name)
      : undefined;

  if (existingForScope?.purged_at) return { kind: "name_purged" };

  const denied = notOwnerGuard(existingForScope, prepared);
  if (denied) return denied;

  if (
    prepared.artifact &&
    ctx.db
      .prepare("SELECT 1 FROM artifact_versions WHERE digest = ? AND purged_at IS NOT NULL LIMIT 1")
      .get(prepared.artifact.digest)
  )
    return { kind: "content_purged" };

  if (!existingForScope) {
    const scope = firstPublicationScopeResult(ctx, prepared);
    if (scope) return scope;
  }

  const gated = evalGateGuard(ctx, existingForScope, prepared);
  if (gated) return gated;

  return conflictResult(prepared.conflicts);
}

/** The declaration of the artifact's latest version, if the artifact exists. */
function previousDeclaration(
  db: PublishCtx["db"],
  type: ArtifactType,
  name: string | undefined,
): AgentDeclaration[] {
  const row = name ? getArtifactByTypeName(db, type, name) : undefined;
  if (!row?.latest_version) return [];
  return getVersion(db, row.id, row.latest_version)?.agents ?? [];
}

/** The author's agent declaration, checked against the runtime table for the prepared type (artifact-agent-compat). */
function declaredAgents(
  db: PublishCtx["db"],
  raw: unknown,
  type: ArtifactType | null,
  name: string | undefined,
): { ok: true; value: AgentDeclaration[] } | { ok: false; detail: string } {
  if (!type) return { ok: true, value: [] };
  // No field: a new version keeps the previous version's declaration; an explicit [] clears it.
  if (raw === undefined) return { ok: true, value: previousDeclaration(db, type, name) };
  try {
    return { ok: true, value: parseAgentDeclarations(raw, type) };
  } catch (e) {
    if (e instanceof AgentDeclarationError) return { ok: false, detail: e.message };
    throw e;
  }
}

/** Sync phase of publish: prepare + all pre-commit guards; commit is left to the caller. */
export type PreparedArtifact =
  { kind: "ready"; prepared: PrepareOk; provenance: Provenance } | PublishResult;

/**
 * Everything publishArtifact does before commitPublish — normalized type/name are
 * available in `prepared`, so the hook publish gate (async) can run between this
 * and commitPublish without re-deriving fields from the raw body.
 */
export function prepareArtifactPublish(
  ctx: PublishCtx,
  body: PublishRequestBody,
): PreparedArtifact {
  if (hasBadType(body.type)) {
    return { kind: "bad_request", message: "type is required and must be a known artifact type" };
  }

  const provenance = parseProvenance(body.provenance);
  if (provenance === null) {
    return { kind: "provenance_invalid" };
  }

  const prepared = preparePublish(ctx.db, body, { username: ctx.actor, role: ctx.role });
  if (prepared.kind === "bad_request") {
    return prepared;
  }

  if (!prepared.ok) {
    return {
      kind: "validation_failed",
      errors: prepared.errors,
      warnings: prepared.warnings,
    };
  }

  const agents = declaredAgents(ctx.db, body.agents, prepared.type, prepared.artifact?.name);
  if (!agents.ok) return { kind: "agents_invalid", detail: agents.detail };

  const guarded = preCommitGuards(ctx, prepared);
  if (guarded) return guarded;

  return { kind: "ready", prepared: { ...prepared, agents: agents.value }, provenance };
}

export function publishArtifact(ctx: PublishCtx, body: PublishRequestBody): PublishResult {
  const stage = prepareArtifactPublish(ctx, body);
  if (stage.kind !== "ready") return stage;
  const withProv: PrepareOk & { provenance: Provenance } = {
    ...stage.prepared,
    provenance: stage.provenance,
  };
  return commitPublish(ctx, withProv);
}
