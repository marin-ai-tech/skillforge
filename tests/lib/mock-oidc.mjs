// Test OpenID Connect provider. It does not depend on SkillForge code:
// discovery, JWKS, authorize (immediately "approves" the configured user), token (code exchange with PKCE and
// client checks), RS256 id_token signing. Attack modes are switched with `idp.mode` and yield deliberately bad tokens.
import { createServer } from "node:http";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

function makeKey(kid) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" };
  return { kid, privateKey, jwk };
}

function makeEcKey(kid) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "ES256", use: "sig" };
  return { kid, privateKey, jwk };
}

function signJwt(header, payload, privateKey) {
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  if (header.alg === "none") return `${input}.`;
  // ES256 in a JWT uses a "raw" r||s signature (IEEE P1363), not DER.
  const sig =
    header.alg === "ES256"
      ? sign("sha256", Buffer.from(input), { key: privateKey, dsaEncoding: "ieee-p1363" })
      : sign("sha256", Buffer.from(input), privateKey);
  return `${input}.${b64url(sig)}`;
}

/**
 * Starts the IdP on a free port of 127.0.0.1. Returns { issuer, clientId, clientSecret, user, mode, stop, codesIssued }.
 * `mode`: "ok" | "es256" | "wrong_aud" | "wrong_iss" | "expired" | "bad_nonce" | "alg_none" | "foreign_key" |
 * "alg_mismatch" | "deny".
 */
export async function startMockOidc({ clientId = "skillforge-test", clientSecret = "test-secret", user } = {}) {
  const key = makeKey("k1");
  const foreign = makeKey("k1"); // same kid, different key: the signature will not match
  const ec = makeEcKey("k2");
  const codes = new Map(); // code -> { nonce, challenge, redirectUri, used }
  const state = {
    mode: "ok",
    user: user ?? { sub: "idp-user-1", email: "dana@example.com", email_verified: true, name: "Dana Scully", preferred_username: "dana", groups: ["skillforge-reviewers"] },
    codesIssued: 0,
    tokenRequests: 0,
  };
  let issuer = "";

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, issuer);
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    };
    if (url.pathname === "/.well-known/openid-configuration") {
      return send(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
      });
    }
    if (url.pathname === "/jwks") return send(200, { keys: [key.jwk, ec.jwk] });
    if (url.pathname === "/authorize") {
      const p = url.searchParams;
      const redirectUri = p.get("redirect_uri");
      if (p.get("client_id") !== clientId || !redirectUri || p.get("response_type") !== "code") {
        return send(400, { error: "invalid_request" });
      }
      const back = new URL(redirectUri);
      if (p.get("state") !== null) back.searchParams.set("state", p.get("state"));
      if (state.mode === "deny") {
        back.searchParams.set("error", "access_denied");
      } else {
        const code = b64url(randomBytes(16));
        codes.set(code, { nonce: p.get("nonce"), challenge: p.get("code_challenge"), method: p.get("code_challenge_method"), redirectUri, used: false });
        state.codesIssued++;
        back.searchParams.set("code", code);
      }
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (url.pathname === "/token" && req.method === "POST") {
      state.tokenRequests++;
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const form = new URLSearchParams(raw);
      let id = form.get("client_id");
      let secret = form.get("client_secret");
      const basic = /^Basic\s+(.+)$/i.exec(req.headers.authorization ?? "");
      if (basic) {
        const [u, s] = Buffer.from(basic[1], "base64").toString().split(":");
        id = decodeURIComponent(u);
        secret = decodeURIComponent(s ?? "");
      }
      if (id !== clientId || secret !== clientSecret) return send(401, { error: "invalid_client" });
      const entry = codes.get(form.get("code") ?? "");
      if (!entry || entry.used || form.get("grant_type") !== "authorization_code" || form.get("redirect_uri") !== entry.redirectUri) {
        return send(400, { error: "invalid_grant" });
      }
      const verifier = form.get("code_verifier") ?? "";
      if (entry.method !== "S256" || b64url(createHash("sha256").update(verifier).digest()) !== entry.challenge) {
        return send(400, { error: "invalid_grant", error_description: "PKCE verification failed" });
      }
      entry.used = true;
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: state.mode === "wrong_iss" ? "https://evil.example" : issuer,
        aud: state.mode === "wrong_aud" ? "someone-else" : clientId,
        sub: state.user.sub,
        email: state.user.email,
        email_verified: state.user.email_verified,
        name: state.user.name,
        preferred_username: state.user.preferred_username,
        groups: state.user.groups,
        nonce: state.mode === "bad_nonce" ? "not-the-nonce" : entry.nonce,
        iat: state.mode === "expired" ? now - 7200 : now,
        exp: state.mode === "expired" ? now - 3600 : now + 300,
      };
      // "es256" is a valid ES256 token (key k2); "alg_mismatch" has an ES256 header but an RSA signature with key k1
      // (algorithm substitution: the check must compare alg with the key type).
      const header =
        state.mode === "es256"
          ? { alg: "ES256", kid: "k2", typ: "JWT" }
          : state.mode === "alg_mismatch"
            ? { alg: "ES256", kid: "k1", typ: "JWT" }
            : { alg: state.mode === "alg_none" ? "none" : "RS256", kid: "k1", typ: "JWT" };
      const signer = state.mode === "es256" ? ec.privateKey : state.mode === "foreign_key" ? foreign.privateKey : key.privateKey;
      const idToken =
        state.mode === "alg_mismatch"
          ? (() => {
              const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
              return `${input}.${b64url(sign("sha256", Buffer.from(input), key.privateKey))}`;
            })()
          : signJwt(header, payload, signer);
      return send(200, { access_token: b64url(randomBytes(16)), token_type: "Bearer", expires_in: 300, id_token: idToken });
    }
    send(404, { error: "not_found" });
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  issuer = `http://127.0.0.1:${server.address().port}`;
  return {
    issuer,
    clientId,
    clientSecret,
    get mode() {
      return state.mode;
    },
    set mode(m) {
      state.mode = m;
    },
    get user() {
      return state.user;
    },
    set user(u) {
      state.user = u;
    },
    get codesIssued() {
      return state.codesIssued;
    },
    get tokenRequests() {
      return state.tokenRequests;
    },
    stop: () => new Promise((r) => server.close(() => r())),
  };
}
