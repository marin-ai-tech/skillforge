import { verify, type KeyObject } from "node:crypto";
import { getKeyByKid } from "./jwks.ts";

function b64urlDecode(input: string): Buffer {
  const pad = "=".repeat((4 - (input.length % 4)) % 4);
  return Buffer.from((input + pad).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export type JwtClaims = Record<string, unknown> & {
  iss?: string;
  aud?: string | string[];
  azp?: string;
  sub?: string;
  exp?: number;
  iat?: number;
  nonce?: string;
};

export type VerifyJwtOpts = {
  jwksUri: string;
  issuer: string;
  clientId: string;
  nonce: string;
  nowSec?: number;
};

function audOk(aud: string | string[] | undefined, clientId: string, azp: unknown): boolean {
  if (typeof aud === "string") return aud === clientId;
  if (Array.isArray(aud)) {
    if (!aud.includes(clientId)) return false;
    if (aud.length > 1) return azp === clientId;
    return true;
  }
  return false;
}

function keyMatchesAlg(alg: string, key: KeyObject): boolean {
  if (alg === "RS256") {
    return key.asymmetricKeyType === "rsa";
  }
  if (alg === "ES256") {
    return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1";
  }
  return false;
}

type JwtHeader = { alg?: string; kid?: string; typ?: string };

function parseHeader(part: string): JwtHeader {
  try {
    return JSON.parse(b64urlDecode(part).toString("utf8")) as JwtHeader;
  } catch {
    throw new Error("bad_header");
  }
}

/** Header checks before kid lookup: reject none, HS256, etc. and a missing kid. */
function assertHeader(header: JwtHeader): asserts header is JwtHeader & {
  alg: "RS256" | "ES256";
  kid: string;
} {
  if (header.alg !== "RS256" && header.alg !== "ES256") {
    throw new Error("bad_alg");
  }
  if (typeof header.kid !== "string" || !header.kid) {
    throw new Error("missing_kid");
  }
}

function signatureOk(alg: string, parts: string[], key: KeyObject): boolean {
  const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = b64urlDecode(parts[2] ?? "");
  return alg === "ES256"
    ? verify("sha256", signingInput, { key, dsaEncoding: "ieee-p1363" }, signature)
    : verify("sha256", signingInput, key, signature);
}

function parseClaims(part: string): JwtClaims {
  try {
    return JSON.parse(b64urlDecode(part).toString("utf8")) as JwtClaims;
  } catch {
    throw new Error("bad_payload");
  }
}

function assertClaims(claims: JwtClaims, opts: VerifyJwtOpts): void {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (claims.iss !== opts.issuer) throw new Error("bad_iss");
  if (!audOk(claims.aud, opts.clientId, claims.azp)) throw new Error("bad_aud");
  if (typeof claims.exp !== "number" || claims.exp <= now) throw new Error("expired");
  if (typeof claims.iat !== "number" || claims.iat > now + 60) throw new Error("bad_iat");
  if (claims.nonce !== opts.nonce) throw new Error("bad_nonce");
  if (typeof claims.sub !== "string" || !claims.sub) throw new Error("missing_sub");
}

export async function verifyIdToken(token: string, opts: VerifyJwtOpts): Promise<JwtClaims> {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1]) {
    throw new Error("malformed");
  }

  const header = parseHeader(parts[0]);
  assertHeader(header);

  const key: KeyObject | null = await getKeyByKid(opts.jwksUri, header.kid);
  if (!key) throw new Error("unknown_kid");

  if (!keyMatchesAlg(header.alg, key)) {
    throw new Error("alg_mismatch");
  }

  if (!signatureOk(header.alg, parts, key)) throw new Error("bad_sig");

  const claims = parseClaims(parts[1]);
  assertClaims(claims, opts);

  return claims;
}
