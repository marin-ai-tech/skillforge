// publish-secret-files: a file whose name says it holds a secret never becomes part of a version.
import { test } from "node:test";
import assert from "node:assert/strict";
import { secretFileReason } from "../src/artifact/secret-files.ts";
import { parseArtifact } from "../src/artifact/index.ts";
import { artifactUploadPaths } from "../src/artifact/upload-paths.ts";

const SECRET = [
  ".env",
  "pdf/.env",
  ".env.local",
  ".env.production",
  "certs/server.pem",
  "certs/server.KEY",
  "store.p12",
  "store.pfx",
  "app.jks",
  "release.keystore",
  "id_rsa",
  "ssh/id_ed25519",
  "id_ecdsa",
  "id_dsa",
  "credentials.json",
  "gcp-credentials-prod.json",
  ".credentials.json",
  "auth.json",
  "settings.local.json",
  ".netrc",
  ".npmrc",
  ".git-credentials",
];
const NOT_SECRET = [
  ".env.example",
  ".env.sample",
  ".env.template",
  ".env.dist",
  "id_rsa.pub",
  "keys.md",
  "env.ts",
  "environment.md",
  "SKILL.md",
  "references/auth-flow.md",
  "scripts/keygen.py",
  "settings.json",
  "credentials.md",
];

test("secretFileReason: names that hold secrets; templates, public keys and look-alikes do not", () => {
  for (const p of SECRET) assert.ok(secretFileReason(p), `${p} should be a secret file`);
  for (const p of NOT_SECRET) assert.equal(secretFileReason(p), null, `${p} is not a secret file`);
});

test("parse: a secret file fails the bundle with E_SECRET_FILE and its path; a template passes", () => {
  const md =
    "---\nname: pdf\ndescription: Counts pages of PDF files. Use when a PDF is too long.\n---\n\nBody.\n";
  const bad = parseArtifact({
    type: "skill",
    files: [
      { path: "pdf/SKILL.md", content: md },
      { path: "pdf/.env", content: "KEY=1\n" },
    ],
  });
  assert.equal(bad.ok, false);
  const err = bad.errors.find((e) => e.code === "E_SECRET_FILE");
  assert.ok(err, JSON.stringify(bad.errors));
  assert.equal(err.path, "pdf/.env");
  const good = parseArtifact({
    type: "skill",
    files: [
      { path: "pdf/SKILL.md", content: md },
      { path: "pdf/.env.example", content: "KEY=\n" },
    ],
  });
  assert.equal(good.ok, true, JSON.stringify(good.ok ? [] : good.errors));
});

test("agent snapshot: a secret file inside a skill folder is not sent", () => {
  const { upload, notSent } = artifactUploadPaths([
    "skills/pdf/SKILL.md",
    "skills/pdf/.env",
    "skills/pdf/notes.md",
  ]);
  assert.deepEqual([...upload].sort(), ["skills/pdf/SKILL.md", "skills/pdf/notes.md"]);
  assert.ok(notSent.includes("skills/pdf/.env"), JSON.stringify(notSent));
});
