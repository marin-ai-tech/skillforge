import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { verifyIdToken } from "../src/auth/oidc/jwt.ts";

function b64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function signJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  privateKey: KeyObject,
): string {
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig =
    header.alg === "ES256"
      ? sign("sha256", Buffer.from(input), { key: privateKey, dsaEncoding: "ieee-p1363" })
      : sign("sha256", Buffer.from(input), privateKey);
  return `${input}.${b64url(sig)}`;
}

const ISSUER = "https://issuer.test";
const CLIENT_ID = "client-1";
const NONCE = "nonce-value-32chars-xxxxxxxx";

let rsaPriv: KeyObject;
let rsaPubJwk: Record<string, unknown>;
let ecPriv: KeyObject;
let ecPubJwk: Record<string, unknown>;
let jwksUri: string;
let server: Server;

before(async () => {
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  rsaPriv = rsa.privateKey;
  rsaPubJwk = { ...rsa.publicKey.export({ format: "jwk" }), kid: "rsa1", alg: "RS256", use: "sig" };

  const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
  ecPriv = ec.privateKey;
  ecPubJwk = { ...ec.publicKey.export({ format: "jwk" }), kid: "ec1", alg: "ES256", use: "sig" };

  server = createServer((req, res) => {
    if (req.url === "/jwks") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ keys: [rsaPubJwk, ecPubJwk] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no addr");
  jwksUri = `http://127.0.0.1:${addr.port}/jwks`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

function claims(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: ISSUER,
    aud: CLIENT_ID,
    sub: "user-1",
    exp: now + 300,
    iat: now,
    nonce: NONCE,
    ...extra,
  };
}

const opts = () => ({
  jwksUri,
  issuer: ISSUER,
  clientId: CLIENT_ID,
  nonce: NONCE,
});

test("RS256: valid token verifies", async () => {
  const token = signJwt({ alg: "RS256", kid: "rsa1", typ: "JWT" }, claims(), rsaPriv);
  const got = await verifyIdToken(token, opts());
  assert.equal(got.sub, "user-1");
});

test("ES256: valid token verifies (ieee-p1363)", async () => {
  const token = signJwt({ alg: "ES256", kid: "ec1", typ: "JWT" }, claims(), ecPriv);
  const got = await verifyIdToken(token, opts());
  assert.equal(got.sub, "user-1");
});

test("alg ES256 with RSA key rejected (alg_mismatch)", async () => {
  // Sign with RSA bytes but claim ES256 + rsa kid — key type check fails before verify
  const input = `${b64url(JSON.stringify({ alg: "ES256", kid: "rsa1", typ: "JWT" }))}.${b64url(JSON.stringify(claims()))}`;
  const sig = sign("sha256", Buffer.from(input), rsaPriv);
  const token = `${input}.${b64url(sig)}`;
  await assert.rejects(
    () => verifyIdToken(token, opts()),
    (e: Error) => e.message === "alg_mismatch",
  );
});

test("alg RS256 with EC key rejected (alg_mismatch)", async () => {
  const input = `${b64url(JSON.stringify({ alg: "RS256", kid: "ec1", typ: "JWT" }))}.${b64url(JSON.stringify(claims()))}`;
  const sig = sign("sha256", Buffer.from(input), { key: ecPriv, dsaEncoding: "ieee-p1363" });
  const token = `${input}.${b64url(sig)}`;
  await assert.rejects(
    () => verifyIdToken(token, opts()),
    (e: Error) => e.message === "alg_mismatch",
  );
});

test("alg HS256 rejected (bad_alg)", async () => {
  const header = b64url(JSON.stringify({ alg: "HS256", kid: "rsa1", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims()));
  const token = `${header}.${payload}.fakesig`;
  await assert.rejects(
    () => verifyIdToken(token, opts()),
    (e: Error) => e.message === "bad_alg",
  );
});
