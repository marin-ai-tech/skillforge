import type { FastifyPluginAsync } from "fastify";
import type { AppConfig } from "../../config.ts";
import type { Database } from "../../db.ts";
import { createSession } from "../sessions.ts";
import { provisionLdapUser } from "../identities.ts";
import { meUser } from "../users.ts";
import { emitPluginEvent } from "../../plugins/events.ts";
import { authenticateLdapUser } from "./client.ts";
import type { LdapProviderConfig } from "./types.ts";

export type LdapRoutesOpts = {
  db: Database;
  config: AppConfig;
};

function cookieSecure(config: AppConfig): boolean {
  if (config.publicUrl?.startsWith("https://")) return true;
  return config.baseUrl.startsWith("https://");
}

function findProvider(config: AppConfig, id: string): LdapProviderConfig | undefined {
  return config.ldapProviders.find((p) => p.id === id);
}

export const ldapRoutes: FastifyPluginAsync<LdapRoutesOpts> = async (app, opts) => {
  const { db, config } = opts;

  app.post<{ Params: { id: string } }>("/api/v1/auth/ldap/:id/login", async (request, reply) => {
    if (config.authMode === "local") {
      return reply.code(404).send({ error: "not_found" });
    }

    const provider = findProvider(config, request.params.id);
    if (!provider) {
      return reply.code(404).send({ error: "not_found" });
    }

    const body = (request.body ?? {}) as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";

    // Empty username or password: reject before any LDAP network call.
    if (!username || !password) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    const auth = await authenticateLdapUser(provider, username, password);
    if (!auth.ok) {
      if (auth.error === "ldap_unavailable") {
        return reply.code(503).send({ error: "ldap_unavailable" });
      }
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    const provisioned = provisionLdapUser(db, provider, auth);
    if (!provisioned.ok) {
      return reply.code(403).send({ error: "account_disabled" });
    }

    const session = createSession(db, provisioned.user.id, config.sessionTtlDays);
    const maxAge = config.sessionTtlDays * 24 * 60 * 60;
    reply.setCookie("sf_session", session.id, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge,
      secure: cookieSecure(config),
    });
    emitPluginEvent({
      type: "auth.login",
      at: new Date().toISOString(),
      user: {
        id: provisioned.user.id,
        username: provisioned.user.username,
        role: provisioned.user.role,
      },
    });
    return reply.code(200).send({ user: meUser(provisioned.user) });
  });
};
