import type { FastifyPluginAsync } from "fastify";
import { isImportRuntime } from "@skillforge/core";
import { requireRole, requireUser } from "../auth/guard.ts";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db.ts";
import { hasBlob, readBlob } from "../blobs.ts";
import { publishArtifact, type PublishRequestBody } from "../publish.ts";
import { postPublishHooks, publishGate } from "../hooks/engine.ts";
import { maybeAutoAblation } from "../evals/auto-ablation.ts";
import { getArtifactByTypeName } from "../repo.ts";
import { emitPluginEvent } from "../plugins/events.ts";
import { getUserById, roleAtLeast } from "../auth/users.ts";
import { buildSnapshot, AGENT_SCAN_LIMITS, type LockInput } from "../agents/scan.ts";
import { compareAgent } from "../agents/compare.ts";
import { checkServerPathAgainstRoots } from "../agents/roots.ts";
import { scanAndStore } from "../agents/server-ops.ts";
import { buildMyAgentsList } from "../agents/my-list.ts";
import { decodeBase64Strict } from "../lib/base64.ts";
import { parseMcpSnapshot, type McpSnapshot } from "../agents/mcp-body.ts";
import {
  listMcpServers,
  mcpScannedAt,
  mcpSummary,
  replaceMcpServers,
} from "../agents/mcp-store.ts";
import {
  agentPublicView,
  deleteAgent,
  getAgentByName,
  getAgentItem,
  replaceItems,
  upsertAgent,
} from "../agents/store.ts";

export type AgentsPluginOpts = {
  db: Database;
  config: AppConfig;
};

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isValidAgentName(name: string): boolean {
  return name.length >= 1 && name.length <= 64 && NAME_RE.test(name);
}

function parseFilesBody(
  filesUnknown: unknown,
):
  | { ok: true; files: Array<{ path: string; content: Uint8Array }> }
  | { ok: false; message: string } {
  if (!Array.isArray(filesUnknown) || filesUnknown.length === 0) {
    return { ok: false, message: "files must be a non-empty array" };
  }
  if (filesUnknown.length > AGENT_SCAN_LIMITS.maxFiles) {
    return { ok: false, message: "too many files" };
  }
  const files: Array<{ path: string; content: Uint8Array }> = [];
  let total = 0;
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
    const content = decodeBase64Strict((entry as { content_base64: string }).content_base64);
    if (content === null) {
      return { ok: false, message: `invalid base64 for ${pathStr}` };
    }
    total += content.byteLength;
    if (total > AGENT_SCAN_LIMITS.maxTotalBytes) {
      return { ok: false, message: "payload exceeds 32 MiB" };
    }
    files.push({ path: pathStr, content });
  }
  return { ok: true, files };
}

/** Map stored canonical paths back to parseArtifact-friendly relative paths. */
function filesForPublish(
  type: string,
  name: string,
  files: Array<{ path: string; sha256: string; size: number }>,
  dataDir: string,
):
  | { ok: true; files: Array<{ path: string; content_base64: string }> }
  | { ok: false; error: "rescan_required" } {
  const prefix =
    type === "skill"
      ? `skills/${name}/`
      : type === "command"
        ? "commands/"
        : type === "agent"
          ? "agents/"
          : "";
  const out: Array<{ path: string; content_base64: string }> = [];
  for (const f of files) {
    if (!hasBlob(dataDir, f.sha256)) {
      return { ok: false, error: "rescan_required" };
    }
    const rel = prefix && f.path.startsWith(prefix) ? f.path.slice(prefix.length) : f.path;
    const content = readBlob(dataDir, f.sha256);
    out.push({ path: rel, content_base64: Buffer.from(content).toString("base64") });
  }
  return { ok: true, files: out };
}

type PublishResult = ReturnType<typeof publishArtifact>;
type SimplePublishFailure = Exclude<
  PublishResult["kind"],
  "created" | "validation_failed" | "not_owner" | "bad_request"
>;

/** Failures answered with just `{ error: kind }` and a fixed status code. */
const SIMPLE_PUBLISH_FAILURE_STATUS: Record<SimplePublishFailure, number> = {
  version_invalid: 409,
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

function sendPublishResult(
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  result: PublishResult,
  hooks?: { decision: string },
): unknown {
  switch (result.kind) {
    case "created":
      return reply.code(201).send({
        artifact: result.artifact,
        version: result.version,
        warnings: result.warnings,
        ...(hooks ? { hooks } : {}),
      });
    case "validation_failed":
      return reply.code(422).send({
        error: "validation_failed",
        errors: result.errors,
        warnings: result.warnings,
      });
    case "not_owner": {
      const body: { error: string; owner?: string } = { error: "not_owner" };
      if (result.owner !== undefined) body.owner = result.owner;
      return reply.code(403).send(body);
    }
    case "bad_request":
      return reply.code(400).send({ error: "bad_request", message: result.message });
    default: {
      const kind: SimplePublishFailure = result.kind;
      return reply.code(SIMPLE_PUBLISH_FAILURE_STATUS[kind]).send({ error: kind });
    }
  }
}

/** One upload snapshot in one transaction: the agent row, its items and, when sent, its MCP observations. */
function storeUpload(
  db: Database,
  input: {
    ownerId: string;
    name: string;
    runtime: string | null;
    scannedAt: string;
    snapshot: ReturnType<typeof buildSnapshot>;
    mcp: McpSnapshot | undefined;
  },
) {
  db.exec("BEGIN");
  try {
    const agent = upsertAgent(db, {
      ownerId: input.ownerId,
      name: input.name,
      kind: "upload",
      runtime: input.runtime,
      serverPath: null,
      scannedAt: input.scannedAt,
      duplicates: input.snapshot.duplicates,
    });
    replaceItems(db, agent.id, input.snapshot.items, input.scannedAt);
    if (input.mcp) replaceMcpServers(db, agent.id, input.mcp, input.scannedAt);
    db.exec("COMMIT");
    return agent;
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  }
}

export function emitAgentScanned(opts: {
  actor: { id: string; username: string };
  agent: ReturnType<typeof agentPublicView>;
  owner: { id: string; username: string };
  summary: {
    local_only: number;
    in_sync: number;
    outdated: number;
    modified: number;
    registry_only: number;
  };
}): void {
  emitPluginEvent({
    type: "agent.scanned",
    at: new Date().toISOString(),
    actor: opts.actor,
    agent: {
      id: opts.agent.id,
      name: opts.agent.name,
      kind: opts.agent.kind,
      runtime: opts.agent.runtime,
    },
    owner: opts.owner,
    summary: opts.summary,
  });
}

export const agentsRoutes: FastifyPluginAsync<AgentsPluginOpts> = async (app, opts) => {
  const { db, config } = opts;

  app.put<{ Params: { name: string } }>("/api/v1/me/agents/:name", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    const name = request.params.name;
    if (!isValidAgentName(name)) {
      return reply.code(400).send({ error: "bad_request", message: "invalid agent name" });
    }
    const body = (request.body ?? {}) as {
      runtime?: unknown;
      files?: unknown;
      lock?: unknown;
      mcp?: unknown;
    };
    const decoded = parseFilesBody(body.files);
    if (!decoded.ok) {
      return reply.code(400).send({ error: "bad_request", message: decoded.message });
    }
    const mcp = parseMcpSnapshot(body.mcp);
    if (!mcp.ok) {
      return reply.code(400).send({ error: "bad_request", message: mcp.message });
    }
    let runtime: string | null = null;
    if (body.runtime !== undefined && body.runtime !== null) {
      if (typeof body.runtime !== "string" || !isImportRuntime(body.runtime)) {
        return reply.code(400).send({ error: "bad_request", message: "invalid runtime" });
      }
      runtime = body.runtime;
    }
    const lock = (body.lock ?? null) as LockInput;
    const scannedAt = new Date().toISOString();
    const writeBlobs = roleAtLeast(request.user!.role, "contributor");
    const snapshot = buildSnapshot(
      decoded.files,
      lock,
      writeBlobs ? config.dataDir : undefined,
      runtime,
    );

    const agent = storeUpload(db, {
      ownerId: request.user!.id,
      name,
      runtime,
      scannedAt,
      snapshot,
      mcp: mcp.value,
    });

    const compared = compareAgent(db, agent, {
      viewer: request.user ? { username: request.user.username, role: request.user.role } : null,
      registryStatus:
        typeof (request.query as { registry_status?: string }).registry_status === "string"
          ? (request.query as { registry_status: string }).registry_status
          : "active",
    });
    const view = agentPublicView(agent);
    emitAgentScanned({
      actor: { id: request.user!.id, username: request.user!.username },
      agent: view,
      owner: { id: request.user!.id, username: request.user!.username },
      summary: compared.summary,
    });
    return reply.code(200).send({
      agent: view,
      summary: compared.summary,
      items: compared.items,
      registry_only: compared.registry_only,
      duplicates: snapshot.duplicates,
      skipped: snapshot.skipped,
      invalid: snapshot.invalid,
      ...(mcp.value ? { mcp: mcpSummary(mcp.value) } : {}),
    });
  });

  app.get("/api/v1/me/agents", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    return reply.code(200).send({
      items: buildMyAgentsList(db, request.user!.id, {
        username: request.user!.username,
        role: request.user!.role,
      }),
    });
  });

  app.get<{ Params: { name: string } }>("/api/v1/me/agents/:name", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    const agent = getAgentByName(db, request.user!.id, request.params.name);
    if (!agent) {
      return reply.code(404).send({ error: "not_found" });
    }
    const q = request.query as { registry_status?: string };
    const compared = compareAgent(db, agent, {
      viewer: request.user ? { username: request.user.username, role: request.user.role } : null,
      registryStatus: typeof q.registry_status === "string" ? q.registry_status : "active",
    });
    return reply.code(200).send({
      agent: agentPublicView(agent),
      summary: compared.summary,
      items: compared.items,
      registry_only: compared.registry_only,
      duplicates: agent.duplicates,
      mcp_scanned_at: mcpScannedAt(db, agent.id),
      mcp_servers: listMcpServers(db, agent.id),
    });
  });

  app.delete<{ Params: { name: string } }>("/api/v1/me/agents/:name", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    const agent = getAgentByName(db, request.user!.id, request.params.name);
    if (!agent) {
      return reply.code(404).send({ error: "not_found" });
    }
    deleteAgent(db, agent.id);
    return reply.code(204).send();
  });

  app.post<{ Params: { name: string } }>("/api/v1/me/agents/:name/scan", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    const agent = getAgentByName(db, request.user!.id, request.params.name);
    if (!agent) {
      return reply.code(404).send({ error: "not_found" });
    }
    if (agent.kind !== "server" || !agent.server_path) {
      return reply.code(409).send({ error: "not_server_agent" });
    }
    if (!config.agentRoots || config.agentRoots.length === 0) {
      return reply.code(403).send({ error: "agent_roots_disabled" });
    }
    const checked = checkServerPathAgainstRoots(agent.server_path, config.agentRoots);
    if (!checked.ok) {
      return reply.code(checked.status).send({ error: checked.error });
    }
    const result = scanAndStore({
      db,
      config,
      ownerId: agent.owner_id,
      name: agent.name,
      serverPath: checked.resolved,
      scanPath: checked.realPath,
      runtime: agent.runtime,
      kind: "server",
      viewer: request.user ? { username: request.user.username, role: request.user.role } : null,
    });
    if (!result.ok) {
      return reply
        .code(result.status)
        .send({ error: result.error, ...(result.message ? { message: result.message } : {}) });
    }
    emitAgentScanned({
      actor: { id: request.user!.id, username: request.user!.username },
      agent: result.agent,
      owner: { id: request.user!.id, username: request.user!.username },
      summary: result.compared.summary,
    });
    return reply.code(200).send({
      agent: result.agent,
      summary: result.compared.summary,
      items: result.compared.items,
      registry_only: result.compared.registry_only,
      duplicates: result.duplicates,
      skipped: result.skipped,
      invalid: result.invalid,
    });
  });

  app.post<{ Params: { name: string; type: string; iname: string } }>(
    "/api/v1/me/agents/:name/items/:type/:iname/publish",
    async (request, reply) => {
      if (!requireUser(request, reply)) return;
      const agent = getAgentByName(db, request.user!.id, request.params.name);
      if (!agent) {
        return reply.code(404).send({ error: "not_found" });
      }
      const item = getAgentItem(db, agent.id, request.params.type, request.params.iname);
      if (!item) {
        return reply.code(404).send({ error: "not_found" });
      }
      if (!requireRole(request, reply, "contributor")) return;
      const body = (request.body ?? {}) as { version?: unknown; changelog?: unknown };
      const prepared = filesForPublish(item.type, item.name, item.files, config.dataDir);
      if (!prepared.ok) {
        return reply.code(409).send({
          error: "rescan_required",
          message: "Snapshot content is not stored; rescan the agent and publish again",
        });
      }
      const files = prepared.files;
      const owner = getUserById(db, agent.owner_id);
      const actorName = owner?.username ?? request.user!.username;
      const gate = await publishGate(
        db,
        config.dataDir,
        actorName,
        {
          type: item.type,
          name: item.name,
        },
        config,
      );
      if (gate.decision === "block") {
        return reply.code(409).send({ error: "publish_blocked", results: gate.results });
      }
      const pubBody: PublishRequestBody = {
        type: item.type,
        name: item.name,
        files,
        provenance: { source: "agent", ref: agent.name },
      };
      if (typeof body.version === "string") pubBody.version = body.version;
      if (typeof body.changelog === "string") pubBody.changelog = body.changelog;
      const result = publishArtifact(
        { db, dataDir: config.dataDir, actor: actorName, role: request.user!.role },
        pubBody,
      );
      if (result.kind === "created") {
        void postPublishHooks(
          db,
          config.dataDir,
          actorName,
          {
            type: result.artifact.type,
            name: result.artifact.name,
            version: result.version.version,
          },
          config,
        );
        const artRow = getArtifactByTypeName(db, result.artifact.type, result.artifact.name);
        if (artRow) {
          maybeAutoAblation(db, config, {
            artifactId: artRow.id,
            type: result.artifact.type,
            name: result.artifact.name,
            version: result.version.version,
            actor: actorName,
          });
        }
      }
      return sendPublishResult(
        reply,
        result,
        gate.decision === "ask" ? { decision: "ask" } : undefined,
      );
    },
  );
};
