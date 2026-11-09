import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db.ts";
import {
  getUserById,
  getUserByUsername,
  meUser,
  roleAtLeast,
  type Role,
  type UserRow,
} from "./users.ts";
import { getSession, touchSession } from "./sessions.ts";
import { resolveToken } from "./tokens.ts";

export type RequestUser = {
  id: string;
  username: string;
  display_name: string | null;
  role: Role;
};

/**
 * How the request signed in. `mcp_token` wins over a live session: an MCP-consent bearer token in the request is
 * enough to apply the MCP limits (mcp-token-write-deny).
 */
export type AuthVia = "session" | "token" | "mcp_token" | "local" | null;

declare module "fastify" {
  interface FastifyRequest {
    user: RequestUser | null;
    authVia: AuthVia;
  }
}

/**
 * The only `/api/*` requests an MCP token may make (method + exact path): who am I (`skillforge login --token`,
 * `whoami`) and health (`skillforge doctor`). Artifact content goes through `POST /mcp`, where status and consent
 * tags apply. An exception needs a documented requirement.
 */
const MCP_TOKEN_ALLOWED: ReadonlySet<string> = new Set([
  "GET /api/v1/me",
  "HEAD /api/v1/me",
  "GET /api/v1/health",
  "HEAD /api/v1/health",
]);

function isMcpTokenDenied(request: FastifyRequest, url: string): boolean {
  if (request.authVia !== "mcp_token") return false;
  return !MCP_TOKEN_ALLOWED.has(`${request.method} ${url}`);
}

function pathOnly(url: string): string {
  return url.split("?")[0] ?? url;
}

export function bearerToken(request: FastifyRequest): string | null {
  const raw = request.headers.authorization;
  if (typeof raw !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m?.[1]?.trim() ? m[1].trim() : null;
}

export function userFromRow(row: UserRow): RequestUser {
  return meUser(row);
}

function sessionUser(request: FastifyRequest, db: Database, config: AppConfig): RequestUser | null {
  const cookieId =
    typeof request.cookies?.sf_session === "string" ? request.cookies.sf_session : undefined;
  if (!cookieId) return null;
  const session = getSession(db, cookieId);
  if (!session) return null;
  const user = getUserById(db, session.user_id);
  if (!user || user.disabled !== 0) return null;
  touchSession(db, session, config.sessionTtlDays);
  return userFromRow(user);
}

export async function resolveRequestAuth(
  request: FastifyRequest,
  db: Database,
  config: AppConfig,
): Promise<{ user: RequestUser | null; via: AuthVia }> {
  const token = bearerToken(request);
  const resolved = token ? resolveToken(db, token) : null;
  const fromSession = sessionUser(request, db, config);
  if (fromSession) return { user: fromSession, via: resolved?.mcp ? "mcp_token" : "session" };

  if (resolved) {
    const user = getUserById(db, resolved.userId);
    if (user && user.disabled === 0) {
      return { user: userFromRow(user), via: resolved.mcp ? "mcp_token" : "token" };
    }
  }

  if (config.authMode === "local") {
    const local = getUserByUsername(db, "local");
    if (local && local.disabled === 0) {
      return { user: userFromRow(local), via: "local" };
    }
  }

  return { user: null, via: null };
}

/** Auth endpoints reachable without a user (login, health, providers, OIDC/LDAP flows). */
function isOpenAuthEndpoint(method: string, url: string): boolean {
  if (method === "POST" && url === "/api/v1/auth/login") return true;
  if (method === "GET" && url === "/api/v1/health") return true;
  if (method === "GET" && url === "/api/v1/auth/providers") return true;
  if (method === "GET" && /^\/api\/v1\/auth\/oidc\/[^/]+\/(start|callback)$/.test(url)) {
    return true;
  }
  return method === "POST" && /^\/api\/v1\/auth\/ldap\/[^/]+\/login$/.test(url);
}

/** GET paths readable anonymously when publicRead is on. */
function isPublicReadPath(url: string): boolean {
  return (
    url === "/api/v1/artifacts" ||
    url.startsWith("/api/v1/artifacts/") ||
    url === "/api/v1/lifecycle/board" ||
    url === "/api/v1/marketplace.json" ||
    url.startsWith("/api/v1/plugins/") ||
    url === "/api/v1/install-info" ||
    url === "/api/v1/metrics/overview"
  );
}

/** Known API surfaces where auth is enforced; unknown /api/* falls through to 404. */
function isKnownApiSurface(url: string): boolean {
  return (
    url === "/api/v1/me" ||
    url.startsWith("/api/v1/me/") ||
    url.startsWith("/api/v1/admin/") ||
    url.startsWith("/api/v1/auth/") ||
    url === "/api/v1/artifacts" ||
    url.startsWith("/api/v1/artifacts/") ||
    url === "/api/v1/lifecycle/board" ||
    url.startsWith("/api/v1/lifecycle/") ||
    url === "/api/v1/marketplace.json" ||
    url.startsWith("/api/v1/plugins/") ||
    url === "/api/v1/install-info" ||
    url.startsWith("/api/v1/metrics/")
  );
}

export function createAuthenticateHook(db: Database, config: AppConfig) {
  return async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const auth = await resolveRequestAuth(request, db, config);
    request.user = auth.user;
    request.authVia = auth.via;

    const url = pathOnly(request.url);
    if (!url.startsWith("/api/")) return;

    if (isMcpTokenDenied(request, url)) {
      return reply.code(403).send({ error: "mcp_token_forbidden" });
    }

    if (isOpenAuthEndpoint(request.method, url)) return;
    if (request.user) return;
    if (config.publicRead && request.method === "GET" && isPublicReadPath(url)) {
      return;
    }
    // Unauthenticated eval routes must reach visibility first so team-hidden
    // artifacts 404 (as-absent) instead of 401; other mutating paths stay 401.
    if (!request.user && /^\/api\/v1\/artifacts\/[^/]+\/[^/]+\/evals(?:\/|$)/.test(url)) {
      return;
    }

    // Only enforce auth on known API surfaces; unknown /api/* falls through to 404.
    if (!isKnownApiSurface(url)) return;

    return reply.code(401).send({ error: "unauthorized" });
  };
}

export function requireUser(
  request: FastifyRequest,
  reply: FastifyReply,
): request is FastifyRequest & {
  user: RequestUser;
} {
  if (!request.user) {
    void reply.code(401).send({ error: "unauthorized" });
    return false;
  }
  return true;
}

export function requireRole(
  request: FastifyRequest,
  reply: FastifyReply,
  role: Role,
): request is FastifyRequest & { user: RequestUser } {
  if (!request.user) {
    void reply.code(401).send({ error: "unauthorized" });
    return false;
  }
  if (!roleAtLeast(request.user.role, role)) {
    void reply.code(403).send({ error: "forbidden" });
    return false;
  }
  return true;
}
