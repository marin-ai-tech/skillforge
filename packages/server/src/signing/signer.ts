import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Database } from "../repo.ts";

/**
 * Release signing: the registry signs the exact files of every version it
 * publishes, and clients check that what they install is what the registry stored. It proves integrity and
 * origin from this registry, not review: the lifecycle status says whether a version was approved.
 */
export type Signer = { keyId: string; publicKeyPem: string; privateKey: KeyObject };

export type VersionSignature = { alg: "ed25519"; key_id: string; sig: string };

export type ManifestInput = {
  type: string;
  name: string;
  version: string;
  digest: string;
  files: Array<{ path: string; sha256: string }>;
};

let current: Signer | null = null;

export function setSigner(signer: Signer | null): void {
  current = signer;
}

export function getSigner(): Signer | null {
  return current;
}

/** key_id: the first 16 hex characters of sha256 over the public key in DER (SPKI). */
function keyIdOf(publicKey: KeyObject): string {
  return createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex")
    .slice(0, 16);
}

/** key_id of a private key file, without loading it as the signer of this server (backup-signing-key). */
export function signingKeyIdOfPem(pem: Buffer | string): string {
  return keyIdOf(createPublicKey(createPrivateKey(pem)));
}

function signerFrom(privateKey: KeyObject): Signer {
  const publicKey = createPublicKey(privateKey);
  return {
    keyId: keyIdOf(publicKey),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey,
  };
}

/** The key lives in `<data>/signing/ed25519.pem`, readable by the server's user only; created on first start. */
export function loadSigner(dataDir: string): Signer {
  const dir = path.join(dataDir, "signing");
  const file = path.join(dir, "ed25519.pem");
  if (fs.existsSync(file)) {
    return signerFrom(createPrivateKey(fs.readFileSync(file)));
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { privateKey } = generateKeyPairSync("ed25519");
  fs.writeFileSync(file, privateKey.export({ type: "pkcs8", format: "pem" }), {
    mode: 0o600,
    flag: "wx",
  });
  return signerFrom(privateKey);
}

/** The canonical text that is signed: field order fixed, files sorted by path (code unit order). */
export function manifestOf(input: ManifestInput): string {
  const files = input.files
    .map((f) => ({ path: f.path, sha256: f.sha256 }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return JSON.stringify({
    v: 1,
    type: input.type,
    name: input.name,
    version: input.version,
    digest: input.digest,
    files,
  });
}

export function signManifest(signer: Signer, input: ManifestInput): VersionSignature {
  const sig = sign(null, Buffer.from(manifestOf(input)), signer.privateKey);
  return { alg: "ed25519", key_id: signer.keyId, sig: sig.toString("base64") };
}

/** Signs one stored version with the current key; a no-op when no key is loaded. */
export function signStoredVersion(db: Database, versionId: string, input: ManifestInput) {
  const signer = getSigner();
  if (!signer) return null;
  const signature = signManifest(signer, input);
  db.prepare("UPDATE artifact_versions SET signature = ? WHERE id = ?").run(
    JSON.stringify(signature),
    versionId,
  );
  return signature;
}

/** Versions published before signing existed, or whose key was replaced, get signed at startup. */
export function backfillSignatures(db: Database): number {
  const signer = getSigner();
  if (!signer) return 0;
  const rows = db
    .prepare(
      `SELECT v.id, a.type, a.name, v.version, v.digest, v.files, v.signature
       FROM artifact_versions v JOIN artifacts a ON a.id = v.artifact_id
       WHERE v.purged_at IS NULL`,
    )
    .all() as Array<{
    id: string;
    type: string;
    name: string;
    version: string;
    digest: string;
    files: string;
    signature: string | null;
  }>;
  let signed = 0;
  for (const r of rows) {
    const old = r.signature ? (JSON.parse(r.signature) as VersionSignature) : null;
    if (old?.key_id === signer.keyId) continue;
    const files = JSON.parse(r.files) as Array<{ path: string; sha256: string }>;
    signStoredVersion(db, r.id, { ...r, files });
    signed += 1;
  }
  return signed;
}
