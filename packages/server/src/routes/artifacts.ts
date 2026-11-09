import { bumpRegistryEpoch } from "../registry-epoch.ts";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { actorFromRequest } from "../actor.ts";
import { requireRole, requireUser } from "../auth/guard.ts";
import { roleAtLeast, type Role } from "../auth/users.ts";
import { bumpMarketplaceVersion } from "../distribution/marketplace.ts";
import { canPublishVersion, recheckManageRight } from "../ownership.ts";
import { canView, type Viewer } from "../visibility/index.ts";
import {
  channelAllowed,
  channelHeads,
  isChannel,
  listChannelEntries,
  recomputeLatest,
  resolveSpec,
  type Channel,
} from "../versions/channels.ts";
import { getSuiteGate, listSuiteCases } from "../evals/suite.ts";
import { evaluateGateCompare, findFreshHoldoutCompare } from "../evals/runs.ts";
import semver from "semver";
import { allowedTransitions } from "../lifecycle/machine.ts";
import { contentTypeForPath } from "../mime.ts";
import { hasBlob, readBlob } from "../blobs.ts";
import {
  commitPublish,
  prepareArtifactPublish,
  preparePublish,
  type PrepareOk,
  type PublishResult,
} from "../publish.ts";
import { postPublishHooks, publishGate } from "../hooks/engine.ts";
import { maybeAutoAblation } from "../evals/auto-ablation.ts";
import { findRegistryDuplicates } from "../duplicates/registry.ts";
import { usageSummary } from "../evidence/usage.ts";
import { appendProvenance, listProvenance } from "../provenance/ledger.ts";
import { artifactMetrics, skillAgeDays } from "../sessions/facts.ts";
import type { AppConfig } from "../config.ts";
import type { ArtifactRow, Database } from "../repo.ts";
import { pluginName } from "../distribution/plugin.ts";
import {
  ARTIFACT_TYPES,
  RUNTIMES,
  isArtifactType,
  runtimeScopes,
  runtimeSupport,
  type ArtifactType,
  RUNTIME_IDS,
  type RuntimeId,
} from "@skillforge/core";
import {
  appendAudit,
  getArtifactByTypeName,
  getLatestVersionForDuplicates,
  getVersion,
  listArtifacts,
  listFacets,
  listLatestVersionsForDuplicates,
  listAudit,
  listVersionSummaries,
  listVersions,
  rowToSummary,
} from "../repo.ts";
import {
  addMaintainer,
  listMaintainers,
  removeMaintainer,
  resolveRecipient,
} from "../ownership.ts";

const channelBodySchema = z.object({
  channel: z.unknown(),
  reason: z.string().max(500).optional().nullable(),
});

const ARTIFACT_TYPE_IDS = ARTIFACT_TYPES.map((t) => t.id) as [string, ...string[]];

const listQuerySchema = z.object({
  type: z.enum(ARTIFACT_TYPE_IDS as [string, ...string[]]).optional(),
  status: z.string().optional(),
  tag: z.string().optional(),
  q: z.string().optional(),
  team: z.string().optional(),
  owner: z.string().optional(),
  label: z.string().optional(),
  agent: z.string().optional(),
  visibility: z.enum(["org", "team"]).optional(),
  sort: z.enum(["updated", "downloads"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

function viewerOf(request: {
  user: { username: string; role: import("../auth/users.ts").Role } | null;
}): Viewer {
  return request.user ? { username: request.user.username, role: request.user.role } : null;
}

export type ArtifactsPluginOpts = {
  db: Database;
  config: AppConfig;
};

function isKnownType(type: string): type is ArtifactType {
  return isArtifactType(type);
}

export type RuntimeInstall = {
  runtime: string;
  label: string;
  supported: boolean;
  command: string | null;
  reason: string | null;
};

function runtimeInstalls(
  type: ArtifactType,
  name: string,
  plugin: string,
  settingsScope: string,
): RuntimeInstall[] {
  return RUNTIMES.map((rt) => {
    const support = runtimeSupport(rt, type, "project");
    const head = { runtime: rt.id, label: rt.label };
    if (!support.supported) {
      return { ...head, supported: false, command: null, reason: support.reason };
    }
    const command =
      support.method === "plugin"
        ? `/plugin install ${plugin}`
        : support.method === "settings"
          ? `skillforge settings apply settings/${name} --scope ${settingsScope}`
          : `skillforge install ${type}/${name} --runtime ${rt.id}`;
    return { ...head, supported: true, command, reason: null };
  });
}

type DeriveBody =
  | {
      ok: true;
      parentType: string;
      parentName: string;
      parentVersion: string | null;
      transform: string | null;
      ref: string | null;
    }
  | { ok: false; status: 400 | 422; error: string };

function deriveShapeOk(b: Record<string, unknown>): boolean {
  const parent = b.parent as Record<string, unknown> | undefined;
  return (
    !!parent &&
    typeof parent === "object" &&
    typeof parent.type === "string" &&
    typeof parent.name === "string" &&
    (parent.version === undefined || typeof parent.version === "string") &&
    (b.transform === undefined || typeof b.transform === "string") &&
    (b.ref === undefined || b.ref === null || typeof b.ref === "string")
  );
}

function parseDeriveBody(body: unknown): DeriveBody {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b) || typeof b.kind !== "string") {
    return { ok: false, status: 400, error: "bad_request" };
  }
  if (b.kind !== "derive") return { ok: false, status: 422, error: "kind_not_allowed" };
  if (!deriveShapeOk(b)) return { ok: false, status: 400, error: "bad_request" };
  const parent = b.parent as Record<string, unknown>;
  return {
    ok: true,
    parentType: parent.type as string,
    parentName: parent.name as string,
    parentVersion: (parent.version as string | undefined) ?? null,
    transform: (b.transform as string | undefined) ?? null,
    ref: (b.ref as string | null | undefined) ?? null,
  };
}

/** parent exists and is visible to the caller (otherwise treated as missing, 404). */
function resolveDeriveParent(
  db: Database,
  viewer: Viewer,
  parsed: Extract<DeriveBody, { ok: true }>,
) {
  if (!isArtifactType(parsed.parentType)) return null;
  const prow = getArtifactByTypeName(db, parsed.parentType, parsed.parentName);
  if (!prow || prow.purged_at || !canView(db, viewer, prow)) return null;
  if (parsed.parentVersion && !getVersion(db, prow.id, parsed.parentVersion)) return null;
  return prow;
}

type PublishReply = { code: (n: number) => { send: (b: unknown) => unknown } };
type PublishCreated = Extract<PublishResult, { kind: "created" }>;
type PublishFailure = Exclude<PublishResult, { kind: "created" }>;
type SimplePublishFailure = Exclude<
  PublishFailure["kind"],
  "validation_failed" | "bad_request" | "not_owner"
>;

/** Failures answered with just `{ error: kind }` and a fixed status code. */
const SIMPLE_PUBLISH_FAILURE_STATUS: Record<SimplePublishFailure, number> = {
  version_invalid: 400,
  channel_invalid: 400,
  provenance_invalid: 400,
  version_exists: 409,
  digest_exists: 409,
  content_purged: 409,
  name_purged: 409,
  team_required: 422,
  team_unknown: 422,
  not_team_member: 403,
  eval_gate_required: 409,
  agents_invalid: 400,
};

function sendPublishFailure(reply: PublishReply, result: PublishFailure): unknown {
  switch (result.kind) {
    case "validation_failed":
      return reply.code(422).send({
        error: "validation_failed",
        errors: result.errors,
        warnings: result.warnings,
      });
    case "bad_request":
      return reply.code(400).send({ error: "bad_request", message: result.message });
    case "agents_invalid":
      return reply.code(400).send({ error: "agents_invalid", detail: result.detail });
    case "not_owner": {
      const body: { error: string; owner?: string } = { error: "not_owner" };
      if (result.owner !== undefined) body.owner = result.owner;
      return reply.code(403).send(body);
    }
    default: {
      const kind: SimplePublishFailure = result.kind;
      return reply.code(SIMPLE_PUBLISH_FAILURE_STATUS[kind]).send({ error: kind });
    }
  }
}

function runPostPublish(
  db: Database,
  config: AppConfig,
  actor: string,
  result: PublishCreated,
): void {
  void postPublishHooks(
    db,
    config.dataDir,
    actor,
    {
      type: result.artifact.type,
      name: result.artifact.name,
      version: result.version.version,
    },
    config,
  );
  const row0 = getArtifactByTypeName(db, result.artifact.type, result.artifact.name);
  if (row0) {
    maybeAutoAblation(db, config, {
      artifactId: row0.id,
      type: result.artifact.type,
      name: result.artifact.name,
      version: result.version.version,
      actor,
    });
  }
}

type ChannelChangeInput = {
  actor: string;
  role: Role;
  type: ArtifactType;
  name: string;
  version: string;
  to: Channel;
  reason: string | null;
  row: ArtifactRow;
};

type ChannelChangeOutcome =
  | { ok: true; changed: boolean; latestVersion: string | null }
  | { ok: false; status: number; body: Record<string, unknown> };

type ChannelChangeFailure = Extract<ChannelChangeOutcome, { ok: false }>;

function channelFail(status: number, body: Record<string, unknown>): ChannelChangeFailure {
  return { ok: false, status, body };
}

/** beta -> stable under a required eval gate: holdout cases and a fresh passing compare. */
function checkStableEvalGate(
  db: Database,
  artifactId: string,
  version: string,
): ChannelChangeFailure | null {
  const holdouts = listSuiteCases(db, artifactId).filter((c) => c.holdout).length;
  if (holdouts === 0) {
    return channelFail(409, { error: "eval_gate_missing", reason: "no_holdout_cases" });
  }
  const entries = listChannelEntries(db, artifactId);
  const stableVersions = entries.filter((e) => e.channel === "stable").map((e) => e.version);
  const head = stableVersions.length
    ? stableVersions.sort((x, y) => semver.rcompare(x, y))[0]
    : null;
  if (!head || head === version) return null;
  const pub = db
    .prepare("SELECT published_at FROM artifact_versions WHERE artifact_id = ? AND version = ?")
    .get(artifactId, version) as { published_at: string } | undefined;
  const suiteUpdated = (
    db.prepare("SELECT updated_at FROM eval_suites WHERE artifact_id = ?").get(artifactId) as
      { updated_at: string } | undefined
  )?.updated_at;
  if (!pub || !suiteUpdated) {
    return channelFail(409, { error: "eval_gate_missing" });
  }
  const found = findFreshHoldoutCompare(
    db,
    artifactId,
    version,
    head,
    pub.published_at,
    suiteUpdated,
  );
  if (!found) {
    return channelFail(409, { error: "eval_gate_missing" });
  }
  const ev = evaluateGateCompare(found.run.summary, found.run.errors);
  if (!ev.ok) {
    return channelFail(409, { error: "eval_gate_failed", reason: ev.reason });
  }
  return null;
}

/** Runs inside BEGIN IMMEDIATE; the caller commits on ok and rolls back otherwise. */
function applyChannelChange(db: Database, input: ChannelChangeInput): ChannelChangeOutcome {
  const { actor, role, type, name, version, to, row } = input;
  // Changing a channel changes what every consumer of `latest` receives: the same right as
  // publishing a version (owner, maintainer; reviewer+/admin as an audited override).
  // Re-read the artifact after BEGIN IMMEDIATE so a concurrent transfer cannot be missed.
  const fresh = getArtifactByTypeName(db, type, name);
  if (!fresh) return channelFail(404, { error: "not_found" });
  const right = canPublishVersion(db, actor, role, { id: fresh.id, owner: fresh.owner });
  if (!right.allowed) return channelFail(403, { error: "not_owner", owner: right.owner });
  const current = db
    .prepare(
      "SELECT channel FROM artifact_versions WHERE artifact_id = ? AND version = ? AND purged_at IS NULL",
    )
    .get(row.id, version) as { channel: string } | undefined;
  if (!current) return channelFail(404, { error: "not_found" });
  if (!channelAllowed(version, to)) return channelFail(400, { error: "channel_invalid" });
  if (current.channel === "beta" && to === "stable" && getSuiteGate(db, fresh.id) === "required") {
    const gateFailure = checkStableEvalGate(db, fresh.id, version);
    if (gateFailure) return gateFailure;
  }
  if (current.channel === to) {
    return { ok: true, changed: false, latestVersion: row.latest_version };
  }
  db.prepare("UPDATE artifact_versions SET channel = ? WHERE artifact_id = ? AND version = ?").run(
    to,
    row.id,
    version,
  );
  bumpRegistryEpoch();
  const latestVersion = recomputeLatest(db, row.id);
  appendAudit(db, {
    ts: new Date().toISOString(),
    actor,
    artifact_id: row.id,
    version,
    action: "channel_change",
    reason: input.reason,
    meta: { version, from: current.channel, to },
  });
  if (right.override) {
    appendAudit(db, {
      ts: new Date().toISOString(),
      actor,
      artifact_id: row.id,
      version,
      action: "publish_override",
      meta: { by_role: role, owner: right.owner, via: "channel_change" },
    });
  }
  return { ok: true, changed: true, latestVersion };
}

function changeVersionChannel(db: Database, input: ChannelChangeInput): ChannelChangeOutcome {
  db.exec("BEGIN IMMEDIATE");
  try {
    const outcome = applyChannelChange(db, input);
    db.exec(outcome.ok ? "COMMIT" : "ROLLBACK");
    return outcome;
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ignore
    }
    throw e;
  }
}

function parseOwnerTransferBody(
  raw: unknown,
): { ok: true; owner: string; reason: string } | { ok: false; message: string } {
  const body = (raw ?? {}) as { owner?: unknown; reason?: unknown };
  if (typeof body.owner !== "string" || body.owner.trim() === "") {
    return { ok: false, message: "owner is required" };
  }
  if (typeof body.reason !== "string" || body.reason.trim() === "") {
    return { ok: false, message: "reason is required" };
  }
  return { ok: true, owner: body.owner, reason: body.reason };
}

export const artifactsRoutes: FastifyPluginAsync<ArtifactsPluginOpts> = async (app, opts) => {
  const { db, config } = opts;
  const dataDir = config.dataDir;

  app.get("/api/v1/artifact-types", async (_request, reply) => {
    return reply.send({
      items: ARTIFACT_TYPES.map((t) => ({ id: t.id, label: t.label, plural: t.plural })),
    });
  });

  app.get("/api/v1/runtimes", async (_request, reply) => {
    return reply.send({
      items: RUNTIMES.map((r) => ({
        id: r.id,
        label: r.label,
        docs_url: r.docs_url,
        scopes: runtimeScopes(r),
      })),
    });
  });

  app.post("/api/v1/artifacts/validate", async (request, reply) => {
    if (!requireRole(request, reply, "contributor")) return;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const prepared = preparePublish(db, body, {
      username: request.user!.username,
      role: request.user!.role,
    });
    if (prepared.kind === "bad_request") {
      return reply.code(400).send({ error: "bad_request", message: prepared.message });
    }
    return reply.code(200).send({
      ok: prepared.ok,
      detected_type: prepared.detected_type,
      type: prepared.type,
      artifact: prepared.artifact,
      errors: prepared.errors,
      warnings: prepared.warnings,
      quality: prepared.quality,
      rubric: prepared.rubric ?? null,
      duplicates: prepared.duplicates,
      existing: prepared.existing,
      next_version: prepared.next_version,
      conflicts: prepared.conflicts,
    });
  });

  app.post("/api/v1/artifacts", async (request, reply) => {
    if (!requireRole(request, reply, "contributor")) return;
    const actor = actorFromRequest(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const ctx = { db, dataDir, actor, role: request.user!.role };
    // Gate on the NORMALIZED type/name (preparePublish derives them from files
    // when the body omits them) — raw body fields can be empty.
    const stage = prepareArtifactPublish(ctx, body);
    let gateDecision: "allow" | "ask" = "allow";
    let result: PublishResult;
    if (stage.kind === "ready") {
      const gate = await publishGate(
        db,
        dataDir,
        actor,
        {
          type: stage.prepared.type ?? "",
          name: stage.prepared.artifact?.name ?? "",
        },
        config,
      );
      if (gate.decision === "block") {
        return reply.code(409).send({ error: "publish_blocked", results: gate.results });
      }
      gateDecision = gate.decision === "ask" ? "ask" : "allow";
      const withProv: PrepareOk & { provenance: { source: string; ref: string | null } } = {
        ...stage.prepared,
        provenance: stage.provenance,
      };
      result = commitPublish(ctx, withProv);
    } else {
      result = stage;
    }

    if (result.kind !== "created") return sendPublishFailure(reply, result);
    const hooks = gateDecision === "ask" ? { hooks: { decision: "ask" } } : {};
    runPostPublish(db, config, actor, result);
    return reply.code(201).send({
      artifact: result.artifact,
      version: result.version,
      warnings: result.warnings,
      quality: result.quality,
      rubric: result.rubric ?? null,
      duplicates: result.duplicates,
      ...hooks,
    });
  });

  app.get("/api/v1/artifacts", async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "bad_request",
        message: parsed.error.issues[0]?.message ?? "invalid query",
      });
    }
    const { limit, offset, agent, ...rest } = parsed.data;
    if (agent !== undefined && !RUNTIME_IDS.includes(agent as RuntimeId)) {
      return reply.code(400).send({ error: "agent_invalid" });
    }
    // Only the filters the request set (exactOptionalPropertyTypes: no undefined values).
    const set = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Omit<
      typeof rest,
      never
    >;
    const result = listArtifacts(db, {
      ...set,
      ...(agent !== undefined ? { agent: agent as RuntimeId } : {}),
      viewer: viewerOf(request),
      limit,
      offset,
    });
    return reply.send(result);
  });

  app.get("/api/v1/artifacts/facets", async (request, reply) => {
    return reply.send(listFacets(db, viewerOf(request)));
  });

  app.get<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/duplicates",
    async (request, reply) => {
      const { type, name } = request.params;
      if (!isKnownType(type)) return reply.code(404).send({ error: "not_found" });
      const latest = getLatestVersionForDuplicates(db, type, name);
      if (!latest) return reply.code(404).send({ error: "not_found" });
      const items = findRegistryDuplicates(
        { ...latest, type },
        listLatestVersionsForDuplicates(db, viewerOf(request)),
      );
      return reply.send({ items });
    },
  );

  app.get<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name",
    async (request, reply) => {
      const { type, name } = request.params;
      if (!isKnownType(type)) {
        return reply.code(404).send({ error: "not_found" });
      }
      const row = getArtifactByTypeName(db, type, name);
      if (!row) {
        return reply.code(404).send({ error: "not_found" });
      }
      const summary = rowToSummary(db, row);
      const latest =
        row.latest_version !== null ? getVersion(db, row.id, row.latest_version) : null;
      const versions = listVersionSummaries(db, row.id);
      const channels = channelHeads(listChannelEntries(db, row.id));
      const allowed_transitions = allowedTransitions(row.status, request.user?.role);
      const base = config.baseUrl.replace(/\/$/, "");
      const ver = row.latest_version ?? "latest";
      const scopeFromFm =
        latest &&
        latest.frontmatter &&
        typeof latest.frontmatter.scope === "string" &&
        ["user", "project", "local"].includes(latest.frontmatter.scope)
          ? latest.frontmatter.scope
          : "project";
      const plugin = pluginName(type, name);
      const install: Record<string, string> = {
        marketplace_name: config.marketplaceName,
        marketplace_url: `${base}/marketplace.json`,
        plugin_name: plugin,
        tgz_url: `${base}/api/v1/plugins/${type}/${name}/${ver}.tar.gz`,
        zip_url: `${base}/api/v1/artifacts/${type}/${name}/versions/${ver}/bundle.zip`,
      };
      if (type === "settings") {
        install.cli = `skillforge settings apply settings/${name} --scope ${scopeFromFm}`;
      }
      const runtimes = runtimeInstalls(
        type,
        name,
        `${plugin}@${config.marketplaceName}`,
        scopeFromFm,
      );
      return reply.send({
        artifact: {
          ...summary,
          comments_count: Number(
            (
              db
                .prepare(
                  "SELECT COUNT(*) AS n FROM comments WHERE artifact_id = ? AND deleted_at IS NULL",
                )
                .get(row.id) as { n: number }
            ).n,
          ),
          latest_channel: latest?.channel ?? null,
          skill_age_days: skillAgeDays(db, row.id),
        },
        latest,
        versions,
        channels,
        allowed_transitions,
        viewer: request.user
          ? {
              watching: !!db
                .prepare("SELECT 1 FROM artifact_watchers WHERE artifact_id = ? AND username = ?")
                .get(row.id, request.user.username),
            }
          : null,
        usage_total: usageSummary(db, row.id).total,
        install: { ...install, runtimes },
      });
    },
  );

  app.get<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/metrics",
    async (request, reply) => {
      const { type, name } = request.params;
      if (!isKnownType(type)) {
        return reply.code(404).send({ error: "not_found" });
      }
      const row = getArtifactByTypeName(db, type, name);
      if (!row) {
        return reply.code(404).send({ error: "not_found" });
      }
      return reply.send(artifactMetrics(db, row.id));
    },
  );

  app.get<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/versions",
    async (request, reply) => {
      const { type, name } = request.params;
      if (!isKnownType(type)) {
        return reply.code(404).send({ error: "not_found" });
      }
      const row = getArtifactByTypeName(db, type, name);
      if (!row) {
        return reply.code(404).send({ error: "not_found" });
      }
      return reply.send({ items: listVersions(db, row.id) });
    },
  );

  app.get<{ Params: { type: string; name: string }; Querystring: { spec?: unknown } }>(
    "/api/v1/artifacts/:type/:name/resolve",
    async (request, reply) => {
      const { type, name } = request.params;
      if (!isKnownType(type)) {
        return reply.code(404).send({ error: "not_found" });
      }
      const row = getArtifactByTypeName(db, type, name);
      if (!row) {
        return reply.code(404).send({ error: "not_found" });
      }
      const resolved = resolveSpec(request.query.spec, listChannelEntries(db, row.id));
      if (resolved.kind === "invalid") return reply.code(400).send({ error: "spec_invalid" });
      if (
        resolved.kind === "none" &&
        typeof request.query.spec === "string" &&
        db
          .prepare(
            "SELECT 1 FROM artifact_versions WHERE artifact_id = ? AND version = ? AND purged_at IS NOT NULL",
          )
          .get(row.id, request.query.spec)
      ) {
        return reply.code(410).send({ error: "purged" });
      }
      if (resolved.kind === "none") return reply.code(404).send({ error: "no_matching_version" });
      const { version, digest, channel } = resolved.entry;
      return reply.send({ version, digest, channel });
    },
  );

  app.post<{ Params: { type: string; name: string; version: string } }>(
    "/api/v1/artifacts/:type/:name/versions/:version/channel",
    async (request, reply) => {
      if (!requireUser(request, reply)) return;
      const actor = actorFromRequest(request);
      const role = request.user.role;
      if (!roleAtLeast(role, "contributor")) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const parsed = channelBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "bad_request",
          message: "reason must be a string of at most 500 characters",
        });
      }
      const to = parsed.data.channel;
      if (!isChannel(to)) return reply.code(400).send({ error: "channel_invalid" });
      const { type, name, version } = request.params;
      if (!isKnownType(type)) {
        return reply.code(404).send({ error: "not_found" });
      }
      const row = getArtifactByTypeName(db, type, name);
      if (!row) {
        return reply.code(404).send({ error: "not_found" });
      }

      const outcome = changeVersionChannel(db, {
        actor,
        role,
        type,
        name,
        version,
        to,
        reason: parsed.data.reason ?? null,
        row,
      });
      if (!outcome.ok) return reply.code(outcome.status).send(outcome.body);
      if (outcome.changed) bumpMarketplaceVersion();
      return reply.send({
        version: getVersion(db, row.id, version),
        latest_version: outcome.latestVersion,
      });
    },
  );

  app.get<{ Params: { type: string; name: string; version: string } }>(
    "/api/v1/artifacts/:type/:name/versions/:version",
    async (request, reply) => {
      const { type, name, version: versionParam } = request.params;
      if (!isKnownType(type)) {
        return reply.code(404).send({ error: "not_found" });
      }
      const row = getArtifactByTypeName(db, type, name);
      if (!row) {
        return reply.code(404).send({ error: "not_found" });
      }
      const version = versionParam === "latest" ? (row.latest_version ?? "") : versionParam;
      if (!version) {
        return reply.code(404).send({ error: "not_found" });
      }
      const detail = getVersion(db, row.id, version);
      if (!detail) {
        return reply.code(404).send({ error: "not_found" });
      }
      if (detail.purged) return reply.code(410).send({ error: "purged" });
      return reply.send(detail);
    },
  );

  app.get<{ Params: { type: string; name: string; version: string; "*": string } }>(
    "/api/v1/artifacts/:type/:name/versions/:version/files/*",
    async (request, reply) => {
      const { type, name, version: versionParam } = request.params;
      const filePath = request.params["*"];
      if (!isKnownType(type)) {
        return reply.code(404).send({ error: "not_found" });
      }
      const row = getArtifactByTypeName(db, type, name);
      if (!row) {
        return reply.code(404).send({ error: "not_found" });
      }
      const version = versionParam === "latest" ? (row.latest_version ?? "") : versionParam;
      if (!version) {
        return reply.code(404).send({ error: "not_found" });
      }
      const detail = getVersion(db, row.id, version);
      if (!detail) {
        return reply.code(404).send({ error: "not_found" });
      }
      if (detail.purged) return reply.code(410).send({ error: "purged" });
      const entry = detail.files.find((f) => f.path === filePath);
      if (!entry || !hasBlob(dataDir, entry.sha256)) {
        return reply.code(404).send({ error: "not_found" });
      }
      const content = readBlob(dataDir, entry.sha256);
      return reply
        .header("etag", `"${entry.sha256}"`)
        .header("cache-control", "public, max-age=31536000, immutable")
        .type(contentTypeForPath(filePath))
        .send(Buffer.from(content));
    },
  );

  app.get<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/audit",
    async (request, reply) => {
      const { type, name } = request.params;
      if (!isKnownType(type)) {
        return reply.code(404).send({ error: "not_found" });
      }
      const row = getArtifactByTypeName(db, type, name);
      if (!row) {
        return reply.code(404).send({ error: "not_found" });
      }
      return reply.send({ items: listAudit(db, row.id) });
    },
  );

  // provenance-ledger: read like /audit; visibility comes from the global preHandler.
  app.get<{
    Params: { type: string; name: string };
    Querystring: { version?: string; kind?: string };
  }>("/api/v1/artifacts/:type/:name/provenance", async (request, reply) => {
    const { type, name } = request.params;
    if (!isKnownType(type)) return reply.code(404).send({ error: "not_found" });
    const row = getArtifactByTypeName(db, type, name);
    if (!row) return reply.code(404).send({ error: "not_found" });
    return reply.send({
      items: listProvenance(db, row.id, {
        version: request.query.version,
        kind: request.query.kind,
      }),
    });
  });

  // Explicit inheritance: an owner/maintainer or reviewer+ declares a derive from a visible parent.
  app.post<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/provenance",
    async (request, reply) => {
      if (!requireUser(request, reply)) return;
      const { type, name } = request.params;
      const row = isKnownType(type) ? getArtifactByTypeName(db, type, name) : undefined;
      if (!row || row.purged_at) return reply.code(404).send({ error: "not_found" });
      const right = canPublishVersion(db, request.user.username, request.user.role, {
        id: row.id,
        owner: row.owner,
      });
      if (!right.allowed) return reply.code(403).send({ error: "forbidden" });
      const parsed = parseDeriveBody(request.body);
      if (!parsed.ok) {
        return reply.code(parsed.status).send({ error: parsed.error });
      }
      const viewer: Viewer = { username: request.user.username, role: request.user.role };
      const prow = resolveDeriveParent(db, viewer, parsed);
      if (!prow) return reply.code(404).send({ error: "not_found" });
      appendProvenance(db, {
        artifact_id: row.id,
        kind: "derive",
        source: "human",
        ref: parsed.ref,
        transform: parsed.transform,
        parent_artifact_id: prow.id,
        parent_version: parsed.parentVersion,
        actor: request.user.username,
      });
      return reply.code(201).send({ ok: true });
    },
  );

  app.post<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/owner",
    async (request, reply) => {
      if (!request.user) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const { type, name } = request.params;
      if (!isKnownType(type)) {
        return reply.code(404).send({ error: "not_found" });
      }
      const row = getArtifactByTypeName(db, type, name);
      if (!row) {
        return reply.code(404).send({ error: "not_found" });
      }
      const isAdmin = roleAtLeast(request.user.role, "admin");
      if (request.user.username !== row.owner && !isAdmin) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const body = parseOwnerTransferBody(request.body);
      if (!body.ok) {
        return reply.code(400).send({ error: "bad_request", message: body.message });
      }
      const recipient = resolveRecipient(db, body.owner);
      if (!recipient.ok) {
        return reply.code(422).send({ error: "owner_invalid" });
      }
      if (recipient.username === row.owner) {
        return reply.code(422).send({ error: "owner_invalid" });
      }
      const now = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        const right = recheckManageRight(db, row.id, row.owner, request.user!);
        if (!right.ok) {
          db.exec("ROLLBACK");
          return reply.code(right.status).send({ error: right.error });
        }
        db.prepare("UPDATE artifacts SET owner = ?, updated_at = ? WHERE id = ?").run(
          recipient.username,
          now,
          row.id,
        );
        bumpRegistryEpoch();
        removeMaintainer(db, row.id, recipient.username);
        appendAudit(db, {
          ts: now,
          actor: request.user!.username,
          artifact_id: row.id,
          version: null,
          action: "owner_transfer",
          reason: body.reason.trim(),
          meta: { from: right.owner, to: recipient.username },
        });
        db.exec("COMMIT");
      } catch (e) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // ignore
        }
        throw e;
      }
      return reply.code(200).send({
        owner: recipient.username,
        maintainers: listMaintainers(db, row.id),
      });
    },
  );

  app.post<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/maintainers",
    async (request, reply) => {
      if (!request.user) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const { type, name } = request.params;
      if (!isKnownType(type)) {
        return reply.code(404).send({ error: "not_found" });
      }
      const row = getArtifactByTypeName(db, type, name);
      if (!row) {
        return reply.code(404).send({ error: "not_found" });
      }
      const isAdmin = roleAtLeast(request.user.role, "admin");
      if (request.user.username !== row.owner && !isAdmin) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const body = (request.body ?? {}) as { username?: unknown };
      if (typeof body.username !== "string" || body.username.trim() === "") {
        return reply.code(400).send({ error: "bad_request", message: "username is required" });
      }
      const recipient = resolveRecipient(db, body.username);
      if (!recipient.ok || recipient.username === row.owner) {
        return reply.code(422).send({ error: "maintainer_invalid" });
      }
      const now = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        const right = recheckManageRight(db, row.id, row.owner, request.user!);
        if (!right.ok) {
          db.exec("ROLLBACK");
          return reply.code(right.status).send({ error: right.error });
        }
        addMaintainer(db, row.id, recipient.username, request.user!.username, now);
        appendAudit(db, {
          ts: now,
          actor: request.user!.username,
          artifact_id: row.id,
          version: null,
          action: "maintainer_add",
          meta: { username: recipient.username },
        });
        db.exec("COMMIT");
      } catch (e) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // ignore
        }
        throw e;
      }
      return reply.code(200).send({ maintainers: listMaintainers(db, row.id) });
    },
  );

  app.delete<{ Params: { type: string; name: string; username: string } }>(
    "/api/v1/artifacts/:type/:name/maintainers/:username",
    async (request, reply) => {
      if (!request.user) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const { type, name } = request.params;
      if (!isKnownType(type)) {
        return reply.code(404).send({ error: "not_found" });
      }
      const row = getArtifactByTypeName(db, type, name);
      if (!row) {
        return reply.code(404).send({ error: "not_found" });
      }
      const isAdmin = roleAtLeast(request.user.role, "admin");
      if (request.user.username !== row.owner && !isAdmin) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const now = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        const right = recheckManageRight(db, row.id, row.owner, request.user!);
        if (!right.ok) {
          db.exec("ROLLBACK");
          return reply.code(right.status).send({ error: right.error });
        }
        const removed = removeMaintainer(db, row.id, request.params.username);
        if (removed) {
          appendAudit(db, {
            ts: now,
            actor: request.user!.username,
            artifact_id: row.id,
            version: null,
            action: "maintainer_remove",
            meta: { username: request.params.username },
          });
        }
        db.exec("COMMIT");
      } catch (e) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // ignore
        }
        throw e;
      }
      return reply.code(200).send({ maintainers: listMaintainers(db, row.id) });
    },
  );
};
