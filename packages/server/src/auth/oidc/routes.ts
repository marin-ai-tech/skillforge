import type { FastifyPluginAsync } from "fastify";
import type { AppConfig } from "../../config.ts";
import type { Database } from "../../db.ts";
import { createSession } from "../sessions.ts";
import { provisionOidcUser } from "../identities.ts";
import { getDiscovery } from "./discovery.ts";
import { verifyIdToken } from "./jwt.ts";
import { createPkcePair, randomToken } from "./pkce.ts";
import { putPending, takePending } from "./state.ts";
import { safeNextPath } from "./next.ts";
import type { OidcProviderConfig } from "./types.ts";

export type OidcRoutesOpts = {
  db: Database;
  config: AppConfig;
};

const OIDC_COOKIE = "sf_oidc";
const OIDC_COOKIE_PATH = "/api/v1/auth/oidc";
const OIDC_COOKIE_MAX_AGE = 10 * 60;
const FETCH_TIMEOUT_MS = 10_000;

/** Secure when PUBLIC_URL is https; else fall back to baseUrl (prior behavior). */
function cookieSecure(config: AppConfig): boolean {
  if (config.publicUrl?.startsWith("https://")) return true;
  return config.baseUrl.startsWith("https://");
}

function findProvider(config: AppConfig, id: string): OidcProviderConfig | undefined {
  return config.oidcProviders.find((p) => p.id === id);
}

function redirectUri(config: AppConfig, id: string): string {
  const base = (config.publicUrl ?? "").replace(/\/+$/, "");
  return `${base}/api/v1/auth/oidc/${id}/callback`;
}

function loginError(reply: import("fastify").FastifyReply, code: string) {
  return reply.redirect(`/login?error=${encodeURIComponent(code)}`);
}

function clearOidcCookie(reply: import("fastify").FastifyReply, config: AppConfig): void {
  reply.clearCookie(OIDC_COOKIE, {
    path: OIDC_COOKIE_PATH,
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(config),
  });
}

type CallbackQuery = {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
};

type PendingLogin = NonNullable<ReturnType<typeof takePending>>;

type CallbackCheck =
  | { ok: true; provider: OidcProviderConfig; pending: PendingLogin; code: string }
  | { ok: false; error: string };

/** Provider, state (consumed once), cookie, IdP error and code checks, in that order. */
function checkCallback(
  config: AppConfig,
  provider: OidcProviderConfig | undefined,
  q: CallbackQuery,
  cookieState: string,
): CallbackCheck {
  const state = typeof q.state === "string" ? q.state : "";
  if (!provider || config.authMode === "local") {
    return { ok: false, error: "sso_provider" };
  }

  const pending = state ? takePending(state) : null;
  if (!pending || pending.providerId !== provider.id) {
    return { ok: false, error: "sso_state" };
  }
  if (!cookieState || cookieState !== state) {
    return { ok: false, error: "sso_state" };
  }

  if (typeof q.error === "string" && q.error) {
    return { ok: false, error: "sso_denied" };
  }

  const code = typeof q.code === "string" ? q.code : "";
  if (!code) {
    return { ok: false, error: "sso_token" };
  }
  return { ok: true, provider, pending, code };
}

/** Exchanges the authorization code; null on any token endpoint failure. */
async function exchangeCodeForIdToken(
  tokenEndpoint: string,
  body: URLSearchParams,
): Promise<string | null> {
  try {
    const tokenRes = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const tokenJson = (await tokenRes.json()) as { id_token?: string; error?: string };
    if (!tokenRes.ok || !tokenJson.id_token) {
      return null;
    }
    return tokenJson.id_token;
  } catch {
    return null;
  }
}

export const oidcRoutes: FastifyPluginAsync<OidcRoutesOpts> = async (app, opts) => {
  const { db, config } = opts;

  app.get("/api/v1/auth/providers", async (_request, reply) => {
    const mode = config.authMode === "local" ? "local" : "password";
    const providers = [
      ...config.oidcProviders.map((p) => ({
        id: p.id,
        label: p.label,
        type: "oidc" as const,
      })),
      ...config.ldapProviders.map((p) => ({
        id: p.id,
        label: p.label,
        type: "ldap" as const,
      })),
    ];
    return reply.code(200).send({
      mode,
      password: mode === "password",
      providers,
    });
  });

  app.get<{ Params: { id: string }; Querystring: { next?: string } }>(
    "/api/v1/auth/oidc/:id/start",
    async (request, reply) => {
      if (config.authMode === "local") {
        return reply.code(404).send({ error: "not_found" });
      }
      const provider = findProvider(config, request.params.id);
      if (!provider) {
        return reply.code(404).send({ error: "not_found" });
      }
      const next = safeNextPath(
        typeof request.query.next === "string" ? request.query.next : undefined,
      );
      let discovery;
      try {
        discovery = await getDiscovery(provider);
      } catch {
        return loginError(reply, "sso_provider");
      }
      const state = randomToken(32);
      const nonce = randomToken(32);
      const pkce = createPkcePair();
      putPending({
        providerId: provider.id,
        state,
        nonce,
        codeVerifier: pkce.verifier,
        next,
      });
      reply.setCookie(OIDC_COOKIE, state, {
        path: OIDC_COOKIE_PATH,
        httpOnly: true,
        sameSite: "lax",
        maxAge: OIDC_COOKIE_MAX_AGE,
        secure: cookieSecure(config),
      });
      const auth = new URL(discovery.authorization_endpoint);
      auth.searchParams.set("response_type", "code");
      auth.searchParams.set("client_id", provider.client_id);
      auth.searchParams.set("redirect_uri", redirectUri(config, provider.id));
      auth.searchParams.set("scope", provider.scopes);
      auth.searchParams.set("state", state);
      auth.searchParams.set("nonce", nonce);
      auth.searchParams.set("code_challenge", pkce.challenge);
      auth.searchParams.set("code_challenge_method", "S256");
      return reply.redirect(auth.toString());
    },
  );

  app.get<{
    Params: { id: string };
    Querystring: CallbackQuery;
  }>("/api/v1/auth/oidc/:id/callback", async (request, reply) => {
    const cookieState =
      typeof request.cookies?.[OIDC_COOKIE] === "string" ? request.cookies[OIDC_COOKIE] : "";

    clearOidcCookie(reply, config);

    const check = checkCallback(
      config,
      findProvider(config, request.params.id),
      request.query,
      cookieState,
    );
    if (!check.ok) {
      return loginError(reply, check.error);
    }
    const { provider, pending, code } = check;

    let discovery;
    try {
      discovery = await getDiscovery(provider);
    } catch {
      return loginError(reply, "sso_provider");
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(config, provider.id),
      client_id: provider.client_id,
      client_secret: provider.client_secret,
      code_verifier: pending.codeVerifier,
    });

    const idToken = await exchangeCodeForIdToken(discovery.token_endpoint, body);
    if (!idToken) {
      return loginError(reply, "sso_token");
    }

    let claims;
    try {
      claims = await verifyIdToken(idToken, {
        jwksUri: discovery.jwks_uri,
        issuer: provider.issuer,
        clientId: provider.client_id,
        nonce: pending.nonce,
      });
    } catch {
      return loginError(reply, "sso_invalid_token");
    }

    const provisioned = provisionOidcUser(db, provider, claims);
    if (!provisioned.ok) {
      return loginError(reply, "sso_account_disabled");
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
    return reply.redirect(safeNextPath(pending.next));
  });
};
