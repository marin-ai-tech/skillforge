// Copy of @skillforge/core artifact/secret-files.ts for the browser (the web app does not depend on core);
// tests/secret-files.test.mjs checks that both give the same answers.
/**
 * Files whose name says they hold a secret (publish-secret-files). Such a file never becomes part of a version: the
 * registry would hand it to everyone who installs the artifact. The check is by name, so a secret in any format is
 * caught without reading the file; the content of other files is checked by the security scan.
 */
const ENV_TEMPLATES = new Set([".env.example", ".env.sample", ".env.template", ".env.dist"]);
const KEY_EXTENSIONS = [".pem", ".key", ".p12", ".pfx", ".jks", ".keystore"];
const SSH_KEYS = new Set(["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"]);
const CREDENTIAL_FILES = new Set([
  ".credentials.json",
  "auth.json",
  ".netrc",
  ".npmrc",
  ".git-credentials",
]);

function baseName(path: string): string {
  const p = path.replace(/\\/g, "/");
  return p.slice(p.lastIndexOf("/") + 1).toLowerCase();
}

function envReason(name: string): string | null {
  if (name !== ".env" && !name.startsWith(".env.")) return null;
  return ENV_TEMPLATES.has(name) ? null : "an environment file with secrets";
}

function keyReason(name: string): string | null {
  if (SSH_KEYS.has(name)) return "a private SSH key";
  return KEY_EXTENSIONS.some((ext) => name.endsWith(ext)) ? "a private key or a key store" : null;
}

function credentialReason(name: string): string | null {
  if (CREDENTIAL_FILES.has(name)) return "a credentials file";
  if (/^credentials[^/]*\.json$/.test(name) || /[-_.]credentials[^/]*\.json$/.test(name))
    return "a credentials file";
  return name.endsWith(".local.json") ? "a local settings file, which usually holds secrets" : null;
}

/** Why the file at `path` is a secret file, or null when its name says nothing of the kind. Case does not matter. */
export function secretFileReason(path: string): string | null {
  const name = baseName(path);
  return envReason(name) ?? keyReason(name) ?? credentialReason(name);
}

/** The message of `E_SECRET_FILE` for one file: what it is and what to do instead. */
export function secretFileMessage(path: string, reason: string): string {
  return `${path} looks like ${reason}; it would be handed to everyone who installs the artifact. Remove it, or rename a template to .env.example.`;
}
