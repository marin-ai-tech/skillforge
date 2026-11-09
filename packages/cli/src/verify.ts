import { createHash, createPublicKey, verify } from "node:crypto";
import type { SkillforgeClient } from "./client.ts";
import { ApiError } from "./client.ts";
import { EXIT } from "./exit.ts";
import { storedSigningKeyId } from "./config.ts";

/**
 * Release signing on the client (release-signing): the files about to be installed must be exactly the ones the
 * registry signed. The manifest is built here the same way the server builds it, so a changed file, an extra file
 * or a changed signature all fail before anything is written.
 */
export type VersionMeta = {
  version: string;
  digest: string;
  files: Array<{ path: string; sha256: string }>;
  signature?: { alg: string; key_id: string; sig: string } | null;
};

type SigningInfo = { alg: string; key_id: string; public_key_pem: string };

const signingCache = new WeakMap<SkillforgeClient, SigningInfo | null>();

async function registrySigning(client: SkillforgeClient): Promise<SigningInfo | null> {
  if (signingCache.has(client)) return signingCache.get(client) ?? null;
  const res = await client.request("GET", "/api/v1/install-info");
  const info = res.ok ? ((res.data as { signing?: SigningInfo | null }).signing ?? null) : null;
  signingCache.set(client, info);
  return info;
}

/** The key id this registry has now, for `skillforge login` to remember. */
export async function currentSigningKeyId(client: SkillforgeClient): Promise<string | undefined> {
  return (await registrySigning(client))?.key_id;
}

export function manifestText(type: string, name: string, meta: VersionMeta): string {
  const files = meta.files
    .map((f) => ({ path: f.path, sha256: f.sha256 }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return JSON.stringify({ v: 1, type, name, version: meta.version, digest: meta.digest, files });
}

function fail(message: string): never {
  throw new ApiError(message, EXIT.VALIDATION);
}

function checkFiles(meta: VersionMeta, files: Array<{ path: string; content: Buffer }>): void {
  const expected = new Map(meta.files.map((f) => [f.path, f.sha256]));
  for (const f of files) {
    const sha = createHash("sha256").update(f.content).digest("hex");
    if (expected.get(f.path) !== sha) fail(`${f.path} does not match the signed release`);
    expected.delete(f.path);
  }
  if (expected.size > 0) fail(`missing from the bundle: ${[...expected.keys()].join(", ")}`);
}

/** Returns false for an unsigned version (installed with a warning), throws on any mismatch. */
export async function verifyBundle(
  client: SkillforgeClient,
  registryUrl: string,
  type: string,
  name: string,
  meta: VersionMeta,
  files: Array<{ path: string; content: Buffer }>,
): Promise<boolean> {
  checkFiles(meta, files);
  if (!meta.signature) return false;
  const signing = await registrySigning(client);
  if (!signing) fail("the registry does not publish a signing key");
  const remembered = storedSigningKeyId(registryUrl);
  if (remembered && remembered !== signing.key_id) {
    fail(
      `signing key changed (${remembered} -> ${signing.key_id}); run skillforge login again if this is expected`,
    );
  }
  if (meta.signature.key_id !== signing.key_id) fail("signature was made with another key");
  const ok = verify(
    null,
    Buffer.from(manifestText(type, name, meta)),
    createPublicKey(signing.public_key_pem),
    Buffer.from(meta.signature.sig, "base64"),
  );
  if (!ok) fail("signature does not match the release");
  return true;
}
