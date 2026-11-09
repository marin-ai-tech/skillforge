import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db.ts";
import { getUserById } from "../auth/users.ts";
import { resolveToken } from "../auth/tokens.ts";
import {
  isNotification,
  negotiateProtocolVersion,
  parseErrorResponse,
  rpcError,
  rpcResult,
  toolCallResponse,
} from "./protocol.ts";
import { TOOL_DEFS, callTool } from "./tools.ts";
import type { JsonRpcId } from "./types.ts";

export type McpPluginOpts = {
  db: Database;
  config: AppConfig;
  serverVersion: string;
};

function bearerToken(request: FastifyRequest): string | null {
  const raw = request.headers.authorization;
  if (typeof raw !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m?.[1]?.trim() ? m[1].trim() : null;
}

function hasOrigin(request: FastifyRequest): boolean {
  return Object.prototype.hasOwnProperty.call(request.headers, "origin");
}

type McpAuth = { mcp_tags: string[]; username: string; role: import("../auth/users.ts").Role };

function authenticateMcp(
  request: FastifyRequest,
  reply: FastifyReply,
  db: Database,
): McpAuth | null {
  if (hasOrigin(request)) {
    void reply.code(403).type("application/json").send({ error: "origin_not_allowed" });
    return null;
  }

  const token = bearerToken(request);
  if (!token) {
    void reply
      .header("WWW-Authenticate", "Bearer")
      .code(401)
      .type("application/json")
      .send({ error: "unauthorized" });
    return null;
  }

  const resolved = resolveToken(db, token);
  if (!resolved) {
    void reply
      .header("WWW-Authenticate", "Bearer")
      .code(401)
      .type("application/json")
      .send({ error: "unauthorized" });
    return null;
  }

  const user = getUserById(db, resolved.userId);
  if (!user || user.disabled !== 0) {
    void reply
      .header("WWW-Authenticate", "Bearer")
      .code(401)
      .type("application/json")
      .send({ error: "unauthorized" });
    return null;
  }

  if (!resolved.mcp) {
    void reply.code(403).type("application/json").send({ error: "mcp_not_allowed" });
    return null;
  }

  return { mcp_tags: resolved.mcp_tags, username: user.username, role: user.role };
}

type RpcReply = { status: 200 | 202; body: unknown | null };

function initializeReply(id: JsonRpcId, params: unknown, serverVersion: string): RpcReply {
  const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
  const protocolVersion = negotiateProtocolVersion(p.protocolVersion);
  return {
    status: 200,
    body: rpcResult(id, {
      protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "skillforge", version: serverVersion },
    }),
  };
}

function toolsCallReply(
  id: JsonRpcId,
  params: unknown,
  auth: McpAuth,
  db: Database,
  dataDir: string,
): RpcReply {
  const p = (params && typeof params === "object" && !Array.isArray(params) ? params : null) as {
    name?: unknown;
    arguments?: unknown;
  } | null;
  if (!p || typeof p.name !== "string") {
    return {
      status: 200,
      body: rpcError(id, -32602, "Invalid params: tools/call requires name"),
    };
  }
  const outcome = callTool(db, dataDir, auth, p.name, p.arguments ?? {});
  if (outcome.kind === "invalid_params") {
    return { status: 200, body: rpcError(id, -32602, outcome.message) };
  }
  return { status: 200, body: toolCallResponse(id, outcome.result) };
}

function handleRpc(
  msg: unknown,
  auth: McpAuth,
  db: Database,
  dataDir: string,
  serverVersion: string,
): { status: 200 | 202; body: unknown | null } {
  if (Array.isArray(msg)) {
    return { status: 200, body: rpcError(null, -32600, "Invalid Request: batch not supported") };
  }
  if (msg === null || typeof msg !== "object") {
    return { status: 200, body: rpcError(null, -32600, "Invalid Request") };
  }

  const obj = msg as Record<string, unknown>;
  const notification = isNotification(obj);
  const id = (notification ? null : (obj.id as JsonRpcId)) ?? null;

  if (obj.jsonrpc !== "2.0" || typeof obj.method !== "string") {
    if (notification) return { status: 202, body: null };
    return { status: 200, body: rpcError(id, -32600, "Invalid Request") };
  }

  const method = obj.method;
  const params = obj.params;

  if (notification) {
    // Notifications never get a JSON-RPC body back.
    return { status: 202, body: null };
  }

  if (method === "initialize") {
    return initializeReply(id, params, serverVersion);
  }

  if (method === "ping") {
    return { status: 200, body: rpcResult(id, {}) };
  }

  if (method === "tools/list") {
    return {
      status: 200,
      body: rpcResult(id, {
        tools: TOOL_DEFS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      }),
    };
  }

  if (method === "tools/call") {
    return toolsCallReply(id, params, auth, db, dataDir);
  }

  return { status: 200, body: rpcError(id, -32601, `Method not found: ${method}`) };
}

export const mcpRoutes: FastifyPluginAsync<McpPluginOpts> = async (app, opts) => {
  const { db, config, serverVersion } = opts;
  const dataDir = config.dataDir;

  // Encapsulated: only /mcp gets raw string body for JSON-RPC -32700.
  // App-level Fastify secure-json-parse stays intact for all other routes.
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    done(null, body);
  });

  const methodNotAllowed = async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(405).send();
  };

  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  app.post("/mcp", async (request, reply) => {
    const auth = authenticateMcp(request, reply, db);
    if (!auth) return;

    const raw = request.body;
    if (typeof raw !== "string") {
      // Empty or non-string body
      return reply.code(400).type("application/json").send(parseErrorResponse());
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return reply.code(400).type("application/json").send(parseErrorResponse());
    }

    const out = handleRpc(parsed, auth, db, dataDir, serverVersion);
    if (out.status === 202) {
      return reply.code(202).send();
    }
    return reply.code(200).type("application/json").send(out.body);
  });
};
