import type { OidcDiscovery, OidcProviderConfig } from "./types.ts";

const cache = new Map<string, { doc: OidcDiscovery; fetchedAt: number }>();
const TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

export async function getDiscovery(provider: OidcProviderConfig): Promise<OidcDiscovery> {
  const cached = cache.get(provider.id);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return cached.doc;
  }
  const url = `${provider.issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`oidc_discovery_failed:${provider.id}`);
  }
  const raw = (await res.json()) as Record<string, unknown>;
  const issuer = typeof raw.issuer === "string" ? raw.issuer : "";
  if (issuer !== provider.issuer) {
    throw new Error(`oidc_issuer_mismatch:${provider.id}`);
  }
  const doc: OidcDiscovery = {
    issuer,
    authorization_endpoint: String(raw.authorization_endpoint ?? ""),
    token_endpoint: String(raw.token_endpoint ?? ""),
    jwks_uri: String(raw.jwks_uri ?? ""),
  };
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
    throw new Error(`oidc_discovery_incomplete:${provider.id}`);
  }
  cache.set(provider.id, { doc, fetchedAt: Date.now() });
  return doc;
}
