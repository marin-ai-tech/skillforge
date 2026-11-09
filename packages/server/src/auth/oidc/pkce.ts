import { createHash, randomBytes } from "node:crypto";

export function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function randomToken(bytes = 32): string {
  return b64url(randomBytes(bytes));
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomToken(32);
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}
