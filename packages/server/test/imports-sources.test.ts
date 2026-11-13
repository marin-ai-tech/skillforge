import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  materialize,
  isGitUrlAllowed,
  stripUserinfo,
  stripCommonRoot,
  isSafeImportPath,
  isSafeImportRef,
  resolveUnderRoot,
} from "../src/imports/sources.ts";
import { DEFAULT_IMPORT_POLICY } from "../src/imports/policy.ts";
import type { AppConfig } from "../src/config.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const IMPORTS = join(ROOT, "tests", "fixtures", "imports");

const baseConfig = {
  port: 0,
  host: "127.0.0.1",
  dataDir: "/tmp",
  baseUrl: "http://127.0.0.1:0",
  webDir: "/tmp",
  adminPassword: null,
  publicRead: true,
  sessionTtlDays: 30,
  agingDays: 90,
  candidateTtlDays: 30,
  importGit: true,
  importAllowFileUrls: false,
  importTtlMinutes: 15,
  backupKeep: 10,
} as AppConfig;

test("zip: unsafe path rejected", async () => {
  const b64 = readFileSync(join(IMPORTS, "unsafe.zip")).toString("base64");
  const r = await materialize({ kind: "zip", content_base64: b64 }, baseConfig, "/tmp/x");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, "import_unsafe_path");
});

test("zip: bomb too large", async () => {
  const b64 = readFileSync(join(IMPORTS, "bomb.zip")).toString("base64");
  const r = await materialize({ kind: "zip", content_base64: b64 }, baseConfig, "/tmp/x");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, "import_too_large");
});

test("zip: plugin-sample ok and strips root", async () => {
  const b64 = readFileSync(join(IMPORTS, "plugin-sample.zip")).toString("base64");
  const r = await materialize({ kind: "zip", content_base64: b64 }, baseConfig, "/tmp/x");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.ok(r.files.some((f) => f.path === "skills/csv-tools/SKILL.md"));
  assert.ok(!r.files.some((f) => f.path.startsWith("plugin-sample/")));
});

// fix-git-clone-line-endings: Git for Windows sets core.autocrlf=true system-wide, and the clone took CRLF.
test("git: files come as in the repository whatever the host's core.autocrlf", async () => {
  const work = mkdtempSync(join(tmpdir(), "sf-crlf-"));
  const repo = join(work, "repo");
  const md = "---\nname: x\ndescription: Line ends test.\n---\n\nLine one.\nLine two.\n";
  mkdirSync(join(repo, "skills", "x"), { recursive: true });
  writeFileSync(join(repo, "skills", "x", "SKILL.md"), md);
  const clean = join(work, "clean.gitconfig");
  writeFileSync(clean, "[user]\n\tname = t\n\temail = t@example.com\n[core]\n\tautocrlf = false\n");
  const env = { ...process.env, GIT_CONFIG_GLOBAL: clean, GIT_CONFIG_NOSYSTEM: "1" };
  for (const args of [
    ["init", "-q"],
    ["add", "."],
    ["commit", "-q", "-m", "x"],
  ])
    execFileSync("git", args, { cwd: repo, env, stdio: "pipe" });
  const host = join(work, "host.gitconfig");
  writeFileSync(host, "[core]\n\tautocrlf = true\n");
  const saved = {
    global: process.env.GIT_CONFIG_GLOBAL,
    nosystem: process.env.GIT_CONFIG_NOSYSTEM,
  };
  process.env.GIT_CONFIG_GLOBAL = host;
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  try {
    const r = await materialize(
      { kind: "git", url: pathToFileURL(repo).href, path: "skills/x" },
      { ...baseConfig, importAllowFileUrls: true },
      join(work, "clone"),
      DEFAULT_IMPORT_POLICY,
    );
    assert.equal(r.ok, true, JSON.stringify(r));
    if (!r.ok) return;
    const file = r.files.find((f) => f.path === "SKILL.md");
    assert.equal(Buffer.from(file!.content).toString("utf8"), md);
    r.cleanup();
  } finally {
    for (const [k, v] of [
      ["GIT_CONFIG_GLOBAL", saved.global],
      ["GIT_CONFIG_NOSYSTEM", saved.nosystem],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(work, { recursive: true, force: true });
  }
});

test("URL allowlist", () => {
  assert.equal(isGitUrlAllowed("https://example.com/r.git", { allowFileUrls: false }).ok, true);
  assert.equal(isGitUrlAllowed("ssh://git@host/r.git", { allowFileUrls: false }).ok, true);
  assert.equal(isGitUrlAllowed("git@host:path/r.git", { allowFileUrls: false }).ok, true);
  assert.equal(isGitUrlAllowed("http://example.com/r.git", { allowFileUrls: false }).ok, false);
  assert.equal(isGitUrlAllowed("file:///tmp/r", { allowFileUrls: false }).ok, false);
  assert.equal(isGitUrlAllowed("file:///tmp/r", { allowFileUrls: true }).ok, true);
});

test("stripUserinfo redacts credentials", () => {
  const s = stripUserinfo("https://user:s3cr3t-token@example.com/repo.git");
  assert.ok(!s.includes("s3cr3t-token"));
  assert.ok(s.includes("example.com"));
});

test("stripCommonRoot", () => {
  const files = stripCommonRoot([
    { path: "root/a.md", content: new Uint8Array([1]) },
    { path: "root/b.md", content: new Uint8Array([2]) },
  ]);
  assert.deepEqual(files.map((f) => f.path).sort(), ["a.md", "b.md"]);
});

test("isSafeImportPath rejects traversal and absolute forms", () => {
  for (const bad of [
    "../../..",
    "..",
    "skills/../..",
    "/etc",
    "C:\\Windows",
    "C:/Windows",
    "",
    "a/../../b",
  ]) {
    assert.equal(isSafeImportPath(bad), false, bad);
  }
  assert.equal(isSafeImportPath("skills"), true);
  assert.equal(isSafeImportPath("skills/csv-tools"), true);
  assert.equal(isSafeImportPath("a".repeat(201)), false);
});

test("isSafeImportRef rejects option-like and unsafe refs", () => {
  for (const bad of [
    "--upload-pack=calc",
    "-x",
    "main; rm -rf /",
    "a b",
    "",
    "/abs",
    "refs spaces",
  ]) {
    assert.equal(isSafeImportRef(bad), false, bad);
  }
  assert.equal(isSafeImportRef("main"), true);
  assert.equal(isSafeImportRef("feature/foo-1.2"), true);
  assert.equal(isSafeImportRef("v1.0.0"), true);
});

test("resolveUnderRoot catches skills/../.. escape", () => {
  const work = mkdtempSync(join(tmpdir(), "sf-resolve-lex-"));
  try {
    const root = join(work, "clone-root");
    mkdirSync(root, { recursive: true });
    const escape = resolveUnderRoot(root, "skills/../..");
    assert.equal(escape.ok, false);
    const ok = resolveUnderRoot(root, "skills");
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.ok(
        ok.resolved.startsWith(root) || ok.resolved.toLowerCase().startsWith(root.toLowerCase()),
      );
    }
    const same = resolveUnderRoot(root, ".");
    // "." may resolve to root itself — allowed as equal
    assert.equal(same.ok, true);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("resolveUnderRoot rejects outward dir symlink/junction and nested path through it", () => {
  const work = mkdtempSync(join(tmpdir(), "sf-resolve-out-"));
  try {
    const root = join(work, "root");
    const outside = join(work, "outside");
    mkdirSync(join(root, "real", "inner"), { recursive: true });
    mkdirSync(join(outside, "leaked"), { recursive: true });
    writeFileSync(join(outside, "leaked", "x.md"), "leak");
    symlinkSync(outside, join(root, "skills"), "junction");

    assert.equal(resolveUnderRoot(root, "real").ok, true);
    assert.equal(resolveUnderRoot(root, "real/inner").ok, true);
    assert.equal(resolveUnderRoot(root, "missing/dir").ok, true);
    assert.equal(resolveUnderRoot(root, "skills").ok, false);
    assert.equal(resolveUnderRoot(root, "skills/leaked").ok, false);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("resolveUnderRoot allows symlink/junction pointing inside root", () => {
  const work = mkdtempSync(join(tmpdir(), "sf-resolve-in-"));
  try {
    const root = join(work, "root");
    mkdirSync(join(root, "real", "inner"), { recursive: true });
    writeFileSync(join(root, "real", "inner", "ok.md"), "ok");
    symlinkSync(join(root, "real"), join(root, "alias"), "junction");

    assert.equal(resolveUnderRoot(root, "alias").ok, true);
    assert.equal(resolveUnderRoot(root, "alias/inner").ok, true);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("resolveUnderRoot returns ok false when realpath fails", () => {
  // Non-existent root: realpath(root) throws → must reject (never treat as success).
  const root = join(tmpdir(), "sf-resolve-missing-root-" + process.pid + "-" + Date.now());
  assert.equal(resolveUnderRoot(root, "skills").ok, false);
  assert.equal(resolveUnderRoot(root, ".").ok, false);
});
