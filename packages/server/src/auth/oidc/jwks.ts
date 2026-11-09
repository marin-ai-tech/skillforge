import { createPublicKey, type KeyObject } from "node:crypto";

type Jwk = Record<string, unknown> & { kid?: string; kty?: string };

type CacheEntry = {
  keys: Map<string, KeyObject>;
  fetchedAt: number;
};

const cache = new Map<string, CacheEntry>();
const TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

async function fetchKeys(jwksUri: string): Promise<Map<string, KeyObject>> {
  const res = await fetch(jwksUri, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error("jwks_fetch_failed");
  const body = (await res.json()) as { keys?: Jwk[] };
  const map = new Map<string, KeyObject>();
  for (const jwk of body.keys ?? []) {
    if (!jwk.kid || typeof jwk.kid !== "string") continue;
    try {
      const key = createPublicKey({ key: jwk, format: "jwk" });
      map.set(jwk.kid, key);
    } catch {
      /* skip unusable keys */
    }
  }
  return map;
}

export async function getKeyByKid(jwksUri: string, kid: string): Promise<KeyObject | null> {
  let entry = cache.get(jwksUri);
  const fresh = entry && Date.now() - entry.fetchedAt < TTL_MS;
  if (!fresh) {
    const keys = await fetchKeys(jwksUri);
    entry = { keys, fetchedAt: Date.now() };
    cache.set(jwksUri, entry);
  }
  if (entry!.keys.has(kid)) return entry!.keys.get(kid)!;
  // One refresh on unknown kid
  const keys = await fetchKeys(jwksUri);
  entry = { keys, fetchedAt: Date.now() };
  cache.set(jwksUri, entry);
  return entry.keys.get(kid) ?? null;
}
