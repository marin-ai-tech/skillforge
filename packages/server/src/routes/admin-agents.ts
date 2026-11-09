import { organisationInventory } from "../agents/inventory.ts";
import type { FastifyPluginAsync } from "fastify";
import { isImportRuntime } from "@skillforge/core";
import { requireRole } from "../auth/guard.ts";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db.ts";
import { getUserById } from "../auth/users.ts";
import { compareAgent } from "../agents/compare.ts";
import { checkServerPathAgainstRoots } from "../agents/roots.ts";
import { scanAndStore } from "../agents/server-ops.ts";
import {
  agentPublicView,
  countAgentItems,
  deleteAgent,
  getAgentById,
  getAgentByName,
  listAllAgents,
} from "../agents/store.ts";
import { emitAgentScanned } from "./agents.ts";

export type AdminAgentsOpts = {
  db: Database;
  config: AppConfig;
};

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isValidAgentName(name: string): boolean {
  return name.length >= 1 && name.length <= 64 && NAME_RE.test(name);
}

type CreateAgentInput = { name: string; serverPath: string; runtime: string | null };

/** undefined = invalid runtime; null = not provided. */
function parseRuntime(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !isImportRuntime(value)) return undefined;
  return value;
}

function parseCreateAgentBody(
  raw: unknown,
): { ok: true; value: CreateAgentInput } | { ok: false; message: string } {
  const body = (raw ?? {}) as {
    name?: unknown;
    server_path?: unknown;
    runtime?: unknown;
  };
  if (typeof body.name !== "string" || !isValidAgentName(body.name)) {
    return { ok: false, message: "invalid agent name" };
  }
  if (typeof body.server_path !== "string" || body.server_path.length === 0) {
    return { ok: false, message: "server_path required" };
  }
  const runtime = parseRuntime(body.runtime);
  if (runtime === undefined) {
    return { ok: false, message: "invalid runtime" };
  }
  return { ok: true, value: { name: body.name, serverPath: body.server_path, runtime } };
}

export const adminAgentsRoutes: FastifyPluginAsync<AdminAgentsOpts> = async (app, opts) => {
  const { db, config } = opts;

  app.post("/api/v1/admin/agents", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    if (!config.agentRoots || config.agentRoots.length === 0) {
      return reply.code(403).send({ error: "agent_roots_disabled" });
    }
    const parsed = parseCreateAgentBody(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ error: "bad_request", message: parsed.message });
    }
    const body = { name: parsed.value.name, server_path: parsed.value.serverPath };
    const runtime = parsed.value.runtime;
    const checked = checkServerPathAgainstRoots(body.server_path, config.agentRoots);
    if (!checked.ok) {
      return reply.code(checked.status).send({ error: checked.error });
    }
    const existing = getAgentByName(db, request.user!.id, body.name);
    if (existing) {
      return reply.code(409).send({ error: "conflict", message: "agent name already exists" });
    }

    const result = scanAndStore({
      db,
      config,
      ownerId: request.user!.id,
      name: body.name,
      serverPath: checked.resolved,
      scanPath: checked.realPath,
      runtime,
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
    return reply.code(201).send({
      agent: result.agent,
      summary: result.compared.summary,
      items: result.compared.items,
      registry_only: result.compared.registry_only,
      skipped: result.skipped,
      invalid: result.invalid,
    });
  });

  app.post<{ Params: { id: string } }>("/api/v1/admin/agents/:id/scan", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    if (!config.agentRoots || config.agentRoots.length === 0) {
      return reply.code(403).send({ error: "agent_roots_disabled" });
    }
    const agent = getAgentById(db, request.params.id);
    if (!agent || agent.kind !== "server" || !agent.server_path) {
      return reply.code(404).send({ error: "not_found" });
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
    const owner = getUserById(db, agent.owner_id);
    emitAgentScanned({
      actor: { id: request.user!.id, username: request.user!.username },
      agent: result.agent,
      owner: {
        id: agent.owner_id,
        username: owner?.username ?? request.user!.username,
      },
      summary: result.compared.summary,
    });
    return reply.code(200).send({
      agent: result.agent,
      summary: result.compared.summary,
      items: result.compared.items,
      registry_only: result.compared.registry_only,
      skipped: result.skipped,
      invalid: result.invalid,
    });
  });

  // shadow-inventory: what stands on people's machines across the organisation, names and counts only.
  app.get("/api/v1/admin/inventory", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    return reply.send(
      organisationInventory(
        db,
        { username: request.user.username, role: request.user.role },
        config.dataDir,
      ),
    );
  });

  app.get("/api/v1/admin/agents", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    const agents = listAllAgents(db);
    const items = agents.map((a) => {
      const owner = getUserById(db, a.owner_id);
      const compared = compareAgent(db, a, {
        viewer: request.user ? { username: request.user.username, role: request.user.role } : null,
      });
      return {
        ...agentPublicView(a),
        item_count: countAgentItems(db, a.id),
        summary: compared.summary,
        owner: {
          id: a.owner_id,
          username: owner?.username ?? "",
        },
      };
    });
    const roots = config.agentRoots ?? [];
    return reply.code(200).send({
      items,
      roots,
      roots_enabled: roots.length > 0,
    });
  });

  app.delete<{ Params: { id: string } }>("/api/v1/admin/agents/:id", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    const agent = getAgentById(db, request.params.id);
    if (!agent) {
      return reply.code(404).send({ error: "not_found" });
    }
    deleteAgent(db, agent.id);
    return reply.code(204).send();
  });
};
