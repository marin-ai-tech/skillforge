import type { FastifyPluginAsync } from "fastify";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db.ts";
import { requireUser } from "../auth/guard.ts";
import { clearLoginFailures, isRateLimited, recordFailedLogin } from "../auth/ratelimit.ts";
import { hashPassword, verifyPassword } from "../auth/passwords.ts";
import { createSession, deleteOtherSessions, deleteSession } from "../auth/sessions.ts";
import { createToken, listTokens, resolveToken, revokeToken } from "../auth/tokens.ts";
import { getUserByUsername, meUser, setPassword, validatePassword } from "../auth/users.ts";
import { deleteInitialAdminPasswordFile } from "../auth/seed.ts";
import { emitPluginEvent } from "../plugins/events.ts";
import { randomBytes } from "node:crypto";
import { oidcRoutes } from "../auth/oidc/routes.ts";
import { ldapRoutes } from "../auth/ldap/routes.ts";

export type AuthPluginOpts = {
  db: Database;
  config: AppConfig;
};

/** Valid scrypt hash of a random string; used for constant-time unknown-user login. */
const DUMMY_HASH = hashPassword(randomBytes(32).toString("hex"));

function cookieSecure(baseUrl: string): boolean {
  return baseUrl.startsWith("https://");
}

const MCP_TAG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** `mcp_tags` of a new token: up to 10 kebab-case tags of 1–32 chars, only with `mcp: true`; null when invalid. */
function parseMcpTags(raw: unknown, mcp: boolean): string[] | null {
  if (raw === undefined) return [];
  if (!mcp || !Array.isArray(raw) || raw.length > 10) return null;
  const ok = raw.every(
    (t) => typeof t === "string" && t.length >= 1 && t.length <= 32 && MCP_TAG.test(t),
  );
  return ok ? (raw as string[]) : null;
}

export const authRoutes: FastifyPluginAsync<AuthPluginOpts> = async (app, opts) => {
  const { db, config } = opts;
  await app.register(oidcRoutes, { db, config });
  await app.register(ldapRoutes, { db, config });

  app.post("/api/v1/auth/login", async (request, reply) => {
    if (config.authMode === "local") {
      return reply.code(409).send({ error: "local_mode" });
    }
    const body = (request.body ?? {}) as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (username && isRateLimited(username)) {
      return reply.code(429).send({ error: "rate_limited" });
    }

    const user = username ? getUserByUsername(db, username) : null;
    if (!user) {
      verifyPassword(password, DUMMY_HASH);
      if (username) recordFailedLogin(username);
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    if (!verifyPassword(password, user.password_hash)) {
      if (username) recordFailedLogin(username);
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    if (user.disabled !== 0) {
      return reply.code(423).send({ error: "disabled" });
    }

    clearLoginFailures(username);
    const session = createSession(db, user.id, config.sessionTtlDays);
    const maxAge = config.sessionTtlDays * 24 * 60 * 60;
    reply.setCookie("sf_session", session.id, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge,
      secure: cookieSecure(config.baseUrl),
    });
    emitPluginEvent({
      type: "auth.login",
      at: new Date().toISOString(),
      user: { id: user.id, username: user.username, role: user.role },
    });
    return reply.code(200).send({ user: meUser(user) });
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    const cookieId =
      typeof request.cookies?.sf_session === "string" ? request.cookies.sf_session : undefined;
    if (cookieId) deleteSession(db, cookieId);
    reply.clearCookie("sf_session", { path: "/" });
    return reply.code(204).send();
  });

  app.get("/api/v1/me", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (typeof authHeader === "string" && /^Bearer\s+\S+/i.test(authHeader.trim())) {
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!resolveToken(db, token)) {
        return reply.code(401).send({ error: "unauthorized" });
      }
    }
    if (!requireUser(request, reply)) return;
    return reply.code(200).send({ user: request.user });
  });

  app.post("/api/v1/me/password", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    const body = (request.body ?? {}) as { current?: unknown; next?: unknown };
    const current = typeof body.current === "string" ? body.current : "";
    const next = typeof body.next === "string" ? body.next : "";
    if (!validatePassword(next)) {
      return reply.code(400).send({ error: "bad_request" });
    }
    const row = getUserByUsername(db, request.user.username);
    if (!row || !verifyPassword(current, row.password_hash)) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    setPassword(db, row.id, next);
    const cookieId =
      typeof request.cookies?.sf_session === "string" ? request.cookies.sf_session : "";
    if (cookieId) deleteOtherSessions(db, row.id, cookieId);
    else deleteOtherSessions(db, row.id, "");
    if (row.username === "admin") {
      deleteInitialAdminPasswordFile(config.dataDir);
    }
    return reply.code(204).send();
  });

  app.get("/api/v1/me/tokens", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    return reply.code(200).send({ items: listTokens(db, request.user.id) });
  });

  app.post("/api/v1/me/tokens", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    // Only a sign-in session mints tokens: a token minting tokens would outlive its own revocation.
    if (request.authVia !== "session" && request.authVia !== "local") {
      return reply.code(403).send({ error: "session_required" });
    }
    const body = (request.body ?? {}) as {
      name?: unknown;
      mcp?: unknown;
      mcp_tags?: unknown;
    };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return reply.code(400).send({ error: "bad_request" });
    }

    const mcp = body.mcp === true;
    const mcpTags = parseMcpTags(body.mcp_tags, mcp);
    if (!mcpTags) {
      return reply.code(400).send({ error: "bad_request" });
    }

    const created = createToken(db, request.user.id, name, { mcp, mcp_tags: mcpTags });
    return reply.code(201).send({
      id: created.row.id,
      name: created.row.name,
      prefix: created.row.prefix,
      token: created.token,
      mcp: created.row.mcp,
      mcp_tags: created.row.mcp_tags,
    });
  });

  app.delete<{ Params: { id: string } }>("/api/v1/me/tokens/:id", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    revokeToken(db, request.user.id, request.params.id);
    return reply.code(204).send();
  });
};
