// Acceptance tests for artifact package validation.
// Requires `npm run build` (reads dist core).
// Checks the artifact-package contract against the fixtures in tests/fixtures/artifacts/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(ROOT, "packages", "core", "dist", "index.js");
const FIX = join(ROOT, "tests", "fixtures", "artifacts");

assert.ok(existsSync(CORE), `built core not found: ${CORE} — run npm run build`);
const core = await import(`file://${CORE.replace(/\\/g, "/")}`);
const { parseArtifact, detectArtifactType, bundleDigest } = core;
assert.equal(typeof parseArtifact, "function", "core does not export parseArtifact");
assert.equal(typeof detectArtifactType, "function", "core does not export detectArtifactType");

/** Reads a fixture directory into files[] with paths relative to the directory. */
function loadDir(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push({ path: relative(dir, p).replace(/\\/g, "/"), content: readFileSync(p) });
    }
  };
  walk(dir);
  return out;
}
const text = (files, path) => Buffer.from(files.find((f) => f.path === path).content).toString("utf8");
const codes = (issues) => issues.map((i) => i.code);
const paths = (artifact) => artifact.files.map((f) => f.path);
const HEX64 = /^[0-9a-f]{64}$/;

test("skill: standard SKILL.md with references — ok, canonical paths, digest", () => {
  const files = loadDir(join(FIX, "skill-standard")); // pdf-tools/SKILL.md, pdf-tools/references/REFERENCE.md
  const r = parseArtifact({ type: "skill", files });
  assert.equal(r.ok, true, JSON.stringify(r.errors ?? r));
  assert.equal(r.artifact.type, "skill");
  assert.equal(r.artifact.name, "pdf-tools");
  assert.match(r.artifact.description, /^Extracts text and tables/);
  assert.deepEqual(paths(r.artifact), ["skills/pdf-tools/SKILL.md", "skills/pdf-tools/references/REFERENCE.md"]);
  assert.match(r.artifact.digest, HEX64);
  assert.equal(r.artifact.digest, bundleDigest(r.artifact.files.map(({ path, sha256 }) => ({ path, sha256 }))));
  assert.ok(!codes(r.warnings).includes("W_UNKNOWN_FRONTMATTER_KEY"), `unexpected warnings: ${JSON.stringify(r.warnings)}`);
  assert.equal(r.artifact.frontmatter.metadata.author, "skillforge-team");
  for (const f of r.artifact.files) {
    assert.match(f.sha256, HEX64);
    assert.equal(typeof f.size, "number");
  }
  assert.ok(r.artifact.canonical.some((c) => c.path === "skills/pdf-tools/SKILL.md" && c.content instanceof Uint8Array));
});

test("skill: digest does not depend on the order of input files", () => {
  const files = loadDir(join(FIX, "skill-standard"));
  const a = parseArtifact({ type: "skill", files });
  const b = parseArtifact({ type: "skill", files: [...files].reverse() });
  assert.equal(a.ok && b.ok, true);
  assert.equal(a.artifact.digest, b.artifact.digest);
});

test("skill: frontmatter name does not match the directory → E_NAME_DIR_MISMATCH", () => {
  const original = loadDir(join(FIX, "skill-standard"));
  const files = original.map((f) =>
    f.path.endsWith("SKILL.md") ? { ...f, content: text(original, f.path).replace("name: pdf-tools", "name: pdf-utils") } : f,
  );
  const r = parseArtifact({ type: "skill", files });
  assert.equal(r.ok, false);
  assert.ok(codes(r.errors).includes("E_NAME_DIR_MISMATCH"), JSON.stringify(r.errors));
});

test("skill: invalid name → E_NAME_INVALID", () => {
  const r = parseArtifact({
    type: "skill",
    files: [{ path: "SKILL.md", content: "---\nname: PDF-Tools\ndescription: Handles PDFs.\n---\n\nBody.\n" }],
  });
  assert.equal(r.ok, false);
  assert.ok(codes(r.errors).includes("E_NAME_INVALID"), JSON.stringify(r.errors));
});

test("skill: reference to a missing file → W_REFERENCE_MISSING with path", () => {
  const r = parseArtifact({
    type: "skill",
    files: [{ path: "SKILL.md", content: "---\nname: linker\ndescription: Links things.\n---\n\nSee [guide](references/guide.md).\n" }],
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const w = r.warnings.find((i) => i.code === "W_REFERENCE_MISSING");
  assert.ok(w, JSON.stringify(r.warnings));
  assert.equal(w.path, "references/guide.md");
});

test("skill: Reckon learned-skill as a single file — ok, warnings about the single file and unknown keys", () => {
  const files = loadDir(join(FIX, "skill-reckon")); // nutrition-migration.md
  const r = parseArtifact({ type: "skill", files });
  assert.equal(r.ok, true, JSON.stringify(r.errors ?? r));
  assert.equal(r.artifact.name, "nutrition-migration");
  assert.deepEqual(paths(r.artifact), ["skills/nutrition-migration/SKILL.md"]);
  assert.ok(r.artifact.frontmatter.triggers !== undefined, "frontmatter.triggers lost");
  const w = codes(r.warnings);
  assert.ok(w.includes("W_SINGLE_FILE_SKILL"), JSON.stringify(r.warnings));
  assert.ok(r.warnings.some((i) => i.code === "W_UNKNOWN_FRONTMATTER_KEY" && /status/.test(i.message)), JSON.stringify(r.warnings));
});

test("frontmatter: invalid tool YAML is parsed in lenient mode", () => {
  const r = parseArtifact({
    type: "skill",
    files: [{ path: "SKILL.md", content: "---\nname: loose-skill\ndescription: migrate: nutrition subsystem\ntriggers: nutrition, hunger\n---\n\nBody.\n" }],
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors ?? r));
  assert.equal(r.artifact.description, "migrate: nutrition subsystem");
  assert.ok(codes(r.warnings).includes("W_FRONTMATTER_LOOSE"), JSON.stringify(r.warnings));
});

test("command: OpenSpec command — name from the file, displayName, tags, canonical path", () => {
  const files = loadDir(join(FIX, "command-propose")); // propose.md
  const r = parseArtifact({ type: "command", files });
  assert.equal(r.ok, true, JSON.stringify(r.errors ?? r));
  assert.equal(r.artifact.name, "propose");
  assert.equal(r.artifact.displayName, "OPSX: Propose");
  assert.ok(r.artifact.tags.includes("workflow"), JSON.stringify(r.artifact.tags));
  assert.ok(r.artifact.tags.includes("artifacts"));
  assert.equal(new Set(r.artifact.tags).size, r.artifact.tags.length, "tags contain duplicates");
  assert.deepEqual(paths(r.artifact), ["commands/propose.md"]);
});

test("command: no frontmatter and no description → E_DESCRIPTION_MISSING; with input.description → ok", () => {
  const files = [{ path: "deploy.md", content: "Deploy the current branch to staging and report the URL.\n" }];
  const bad = parseArtifact({ type: "command", files });
  assert.equal(bad.ok, false);
  assert.ok(codes(bad.errors).includes("E_DESCRIPTION_MISSING"), JSON.stringify(bad.errors));
  const good = parseArtifact({ type: "command", files, description: "Deploy to staging" });
  assert.equal(good.ok, true, JSON.stringify(good.errors ?? good));
  assert.equal(good.artifact.name, "deploy");
  assert.equal(good.artifact.description, "Deploy to staging");
  assert.equal(good.artifact.frontmatter, null);
});

test("command: two files → E_SINGLE_FILE_REQUIRED", () => {
  const r = parseArtifact({
    type: "command",
    files: [
      { path: "a.md", content: "---\ndescription: A\n---\nA body\n" },
      { path: "b.md", content: "---\ndescription: B\n---\nB body\n" },
    ],
  });
  assert.equal(r.ok, false);
  assert.ok(codes(r.errors).includes("E_SINGLE_FILE_REQUIRED"), JSON.stringify(r.errors));
});

test("agent: tools as a string → array, canonical path agents/<name>.md", () => {
  const files = loadDir(join(FIX, "agent-executor")); // handoff-executor.md
  const r = parseArtifact({ type: "agent", files });
  assert.equal(r.ok, true, JSON.stringify(r.errors ?? r));
  assert.equal(r.artifact.name, "handoff-executor");
  assert.deepEqual(r.artifact.frontmatter.tools, ["Bash", "PowerShell", "Write", "Read", "Glob", "Grep"]);
  assert.equal(r.artifact.frontmatter.model, "sonnet");
  assert.deepEqual(paths(r.artifact), ["agents/handoff-executor.md"]);
});

test("agent: no description → E_DESCRIPTION_MISSING; isolation: docker → E_AGENT_ISOLATION_INVALID", () => {
  const noDesc = parseArtifact({ type: "agent", files: [{ path: "x.md", content: "---\nname: x\n---\nPrompt.\n" }] });
  assert.equal(noDesc.ok, false);
  assert.ok(codes(noDesc.errors).includes("E_DESCRIPTION_MISSING"), JSON.stringify(noDesc.errors));
  const iso = parseArtifact({
    type: "agent",
    files: [{ path: "x.md", content: "---\nname: x\ndescription: X agent\nisolation: docker\n---\nPrompt.\n" }],
  });
  assert.equal(iso.ok, false);
  assert.ok(codes(iso.errors).includes("E_AGENT_ISOLATION_INVALID"), JSON.stringify(iso.errors));
});

test("hook: valid hooks.json + script + README — name from input, description from README", () => {
  const files = loadDir(join(FIX, "hook-guard")); // hooks.json, scripts/guard.sh, README.md
  const r = parseArtifact({ type: "hook", files, name: "destructive-guard" });
  assert.equal(r.ok, true, JSON.stringify(r.errors ?? r));
  assert.equal(r.artifact.name, "destructive-guard");
  assert.match(r.artifact.description, /^Asks for confirmation before catastrophic shell commands/);
  assert.deepEqual(paths(r.artifact), ["README.md", "hooks/hooks.json", "scripts/guard.sh"]);
  assert.ok(!codes(r.warnings).includes("W_SCRIPT_MISSING"), JSON.stringify(r.warnings));
  assert.ok(!codes(r.warnings).includes("W_HOOK_EVENT_UNKNOWN"), JSON.stringify(r.warnings));
});

test("hook: unknown event and missing script → warnings, but ok", () => {
  const hooks = {
    hooks: {
      OnCoffee: [{ hooks: [{ type: "command", command: "${CLAUDE_PLUGIN_ROOT}/scripts/none.sh" }] }],
    },
  };
  const r = parseArtifact({
    type: "hook",
    files: [{ path: "hooks.json", content: JSON.stringify(hooks) }],
    name: "coffee-hook",
    description: "Runs on coffee",
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors ?? r));
  const w = codes(r.warnings);
  assert.ok(w.includes("W_HOOK_EVENT_UNKNOWN"), JSON.stringify(r.warnings));
  assert.ok(w.includes("W_SCRIPT_MISSING"), JSON.stringify(r.warnings));
});

test("hook: entry without a command field → E_HOOK_ENTRY_INVALID; broken JSON → E_HOOKS_JSON_INVALID", () => {
  const broken = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", timeout: 5 }] }] } };
  const r = parseArtifact({
    type: "hook",
    files: [{ path: "hooks.json", content: JSON.stringify(broken) }],
    name: "broken-hook",
    description: "Broken",
  });
  assert.equal(r.ok, false);
  const e = r.errors.find((i) => i.code === "E_HOOK_ENTRY_INVALID");
  assert.ok(e, JSON.stringify(r.errors));
  assert.match(e.path ?? "", /PreToolUse\[0\]\.hooks\[0\]/);
  const bad = parseArtifact({ type: "hook", files: [{ path: "hooks.json", content: "{ not json" }], name: "x", description: "x" });
  assert.equal(bad.ok, false);
  assert.ok(codes(bad.errors).includes("E_HOOKS_JSON_INVALID"), JSON.stringify(bad.errors));
});

test("paths: directory traversal → E_PATH_UNSAFE with the original path; node_modules → E_PATH_FORBIDDEN", () => {
  const unsafe = parseArtifact({
    type: "skill",
    files: [
      { path: "SKILL.md", content: "---\nname: s\ndescription: S.\n---\nBody.\n" },
      { path: "../etc/passwd", content: "x" },
    ],
  });
  assert.equal(unsafe.ok, false);
  const e = unsafe.errors.find((i) => i.code === "E_PATH_UNSAFE");
  assert.ok(e, JSON.stringify(unsafe.errors));
  assert.equal(e.path, "../etc/passwd");
  const forbidden = parseArtifact({
    type: "skill",
    files: [
      { path: "SKILL.md", content: "---\nname: s\ndescription: S.\n---\nBody.\n" },
      { path: "node_modules/left-pad/index.js", content: "x" },
    ],
  });
  assert.equal(forbidden.ok, false);
  assert.ok(codes(forbidden.errors).includes("E_PATH_FORBIDDEN"), JSON.stringify(forbidden.errors));
});

test("limits: 1001 files → E_TOO_MANY_FILES", () => {
  const files = [{ path: "SKILL.md", content: "---\nname: big\ndescription: Big.\n---\nBody.\n" }];
  for (let i = 0; i < 1000; i++) files.push({ path: `assets/f${i}.txt`, content: "x" });
  const r = parseArtifact({ type: "skill", files });
  assert.equal(r.ok, false);
  assert.ok(codes(r.errors).includes("E_TOO_MANY_FILES"), JSON.stringify(r.errors.slice(0, 3)));
});

test("description longer than 1024 characters → E_DESCRIPTION_TOO_LONG; unknown type → E_TYPE_UNKNOWN", () => {
  const long = "x".repeat(1025);
  const r = parseArtifact({ type: "skill", files: [{ path: "SKILL.md", content: `---\nname: s\ndescription: ${long}\n---\nBody.\n` }] });
  assert.equal(r.ok, false);
  assert.ok(codes(r.errors).includes("E_DESCRIPTION_TOO_LONG"), JSON.stringify(r.errors));
  const t = parseArtifact({ type: "widget", files: [{ path: "a.md", content: "x" }] });
  assert.equal(t.ok, false);
  assert.ok(codes(t.errors).includes("E_TYPE_UNKNOWN"), JSON.stringify(t.errors));
});

test("detectArtifactType: hook / skill / agent / command / null", () => {
  assert.equal(detectArtifactType([{ path: "hooks.json", content: "{}" }]), "hook");
  assert.equal(detectArtifactType([{ path: "x/SKILL.md", content: "---\nname: x\ndescription: X\n---\nB" }]), "skill");
  assert.equal(detectArtifactType([{ path: "a.md", content: "---\nname: a\ndescription: A\nmodel: sonnet\n---\nPrompt" }]), "agent");
  assert.equal(detectArtifactType([{ path: "b.md", content: "Just a prompt body." }]), "command");
  assert.equal(detectArtifactType([{ path: "a.txt", content: "x" }, { path: "b.txt", content: "y" }]), null);
});
