import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeForeign } from "../src/runtimes/import.ts";
import type { ScanCandidate } from "../src/artifact/scan.ts";
import { ISSUE_CODES } from "../src/artifact/types.ts";
import { parseArtifact } from "../src/artifact/index.ts";

function candidate(
  type: "agent" | "command",
  path: string,
  content: string,
  root = ".codex",
): ScanCandidate {
  return {
    id: `${type}/placeholder`,
    type,
    root,
    files: [{ path, content }],
    nameHint: "placeholder",
    provenance: { source: "local", ref: null },
  };
}

function text(c: ScanCandidate): string {
  const f = c.files[0]!;
  return typeof f.content === "string" ? f.content : new TextDecoder().decode(f.content);
}

test("normalizeForeign: valid TOML agent becomes markdown that parses", () => {
  const toml =
    'name = "code-reviewer"\ndescription = "Reviews code"\ndeveloper_instructions = "Review the diff."\n';
  const r = normalizeForeign(candidate("agent", "agents/reviewer.toml", toml));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.candidate.id, "agent/code-reviewer");
  assert.equal(r.candidate.nameHint, "code-reviewer");
  assert.equal(r.candidate.files.length, 1);
  assert.equal(r.candidate.files[0]!.path, "agents/reviewer.md");
  const md = text(r.candidate);
  assert.match(md, /^---\n/);
  assert.match(md, /Review the diff\./);
  const parsed = parseArtifact({ type: "agent", files: [{ path: "reviewer.md", content: md }] });
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  if (parsed.ok) assert.equal(parsed.artifact.name, "code-reviewer");
});

test("normalizeForeign: TOML agent without name falls back to the file name", () => {
  const toml = 'developer_instructions = "Do things."\n';
  const r = normalizeForeign(candidate("agent", "agents/helper.toml", toml));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.candidate.id, "agent/helper");
});

test("normalizeForeign: TOML agent missing developer_instructions is invalid", () => {
  const toml = 'name = "helper"\ndescription = "x"\n';
  const r = normalizeForeign(candidate("agent", "agents/helper.toml", toml));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.root, ".codex");
  assert.equal(r.errors[0]!.code, "E_DEVELOPER_INSTRUCTIONS_MISSING");
  assert.equal(r.errors[0]!.path, ".codex/agents/helper.toml");
});

test("normalizeForeign: TOML agent with invalid name is E_NAME_INVALID, not an id", () => {
  for (const bad of ["../../Evil Name", "Evil", "", "a/b"]) {
    const toml = `name = ${JSON.stringify(bad)}\ndeveloper_instructions = "y"\n`;
    const r = normalizeForeign(candidate("agent", "agents/evil.toml", toml));
    assert.equal(r.ok, false, bad);
    if (r.ok) continue;
    assert.equal(r.errors.length, 1);
    assert.equal(r.errors[0]!.code, ISSUE_CODES.E_NAME_INVALID);
    assert.equal(r.errors[0]!.path, ".codex/agents/evil.toml");
  }
  const nonString = normalizeForeign(
    candidate("agent", "agents/evil.toml", 'name = 42\ndeveloper_instructions = "y"\n'),
  );
  assert.equal(nonString.ok, false);
  if (!nonString.ok) assert.equal(nonString.errors[0]!.code, ISSUE_CODES.E_NAME_INVALID);
});

test("normalizeForeign: broken TOML is E_TOML_PARSE and never throws", () => {
  const r = normalizeForeign(
    candidate("agent", "agents/broken.toml", 'name = "x\ndeveloper_instructions = \n'),
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.errors[0]!.code, "E_TOML_PARSE");
  assert.equal(r.errors[0]!.path, ".codex/agents/broken.toml");
});

test("normalizeForeign: TOML command rewrites {{args}} to $ARGUMENTS", () => {
  const toml = 'description = "Greets"\nprompt = "Say hi to {{args}} and {{args}}"\n';
  const r = normalizeForeign(candidate("command", "commands/greet.toml", toml, ".qwen"), "qwen");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.candidate.id, "command/greet");
  assert.equal(r.candidate.files[0]!.path, "commands/greet.md");
  const md = text(r.candidate);
  assert.ok(!md.includes("{{args}}"), md);
  assert.match(md, /Say hi to \$ARGUMENTS and \$ARGUMENTS/);
  assert.match(md, /description: Greets/);
});

test("normalizeForeign: nameless markdown agent gets its name from the file", () => {
  const md = "---\ndescription: Helps\n---\nBody text.\n";
  const r = normalizeForeign(candidate("agent", "agents/helper-bot.md", md, ".cursor"));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.candidate.id, "agent/helper-bot");
  assert.equal(r.candidate.nameHint, "helper-bot");
  const out = text(r.candidate);
  assert.match(out, /name: helper-bot/);
  assert.match(out, /description: Helps/);
  assert.match(out, /Body text\./);
});
