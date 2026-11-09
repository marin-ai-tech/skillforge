import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArtifact } from "../src/artifact/index.ts";
import {
  artifactBodyFingerprint,
  bodyFingerprint,
  descriptionSimilarity,
  descriptionWords,
  isBackupRoot,
  jaccard,
  mainFilePath,
  normalizeBody,
} from "../src/duplicates/index.ts";

test("normalizeBody: CRLF, trailing spaces, blank-line runs and edges", () => {
  const messy = "\r\n\r\n# Title  \r\n\r\n\r\n\r\nline one \t\r\nline two\r\n\r\n\r\n";
  assert.equal(normalizeBody(messy), "# Title\n\nline one\nline two");
  assert.equal(normalizeBody(""), "");
  assert.equal(normalizeBody("\n\n\n"), "");
  assert.equal(normalizeBody("a\n\n\nb"), "a\n\nb");
});

test("bodyFingerprint: ignores frontmatter and formatting noise", () => {
  const clean = "---\nname: a\ndescription: A\n---\n\n# Body\n\nText.\n";
  const noisy = "---\nname: b\ndescription: B\n---\r\n\r\n\r\n# Body  \r\n\r\n\r\nText.  \r\n\r\n";
  assert.equal(bodyFingerprint(clean), bodyFingerprint(noisy));
  assert.notEqual(bodyFingerprint(clean), bodyFingerprint(clean.replace("Text.", "Other.")));
  assert.notEqual(
    bodyFingerprint("# x\n", { withFrontmatter: false }),
    bodyFingerprint("---\na: 1\n---\n# x\n", { withFrontmatter: false }),
  );
});

test("artifactBodyFingerprint: main file per type; hook uses hooks/hooks.json verbatim", () => {
  assert.equal(mainFilePath("skill", "demo"), "skills/demo/SKILL.md");
  assert.equal(mainFilePath("command", "demo"), "commands/demo.md");
  assert.equal(mainFilePath("agent", "demo"), "agents/demo.md");
  assert.equal(mainFilePath("hook", "demo"), "hooks/hooks.json");

  const skill = parseArtifact({
    type: "skill",
    files: [
      {
        path: "demo/SKILL.md",
        content: "---\nname: demo\ndescription: Demo skill.\n---\n\n# Demo\n",
      },
      { path: "demo/references/x.md", content: "ref" },
    ],
  });
  assert.ok(skill.ok);
  assert.equal(artifactBodyFingerprint(skill.artifact), bodyFingerprint("# Demo\n"));

  const hookJson =
    '{"description":"Hook demo.","hooks":{"Stop":[{"hooks":[{"type":"command","command":"echo"}]}]}}';
  const hook = parseArtifact({
    type: "hook",
    name: "demo",
    files: [
      { path: "hooks.json", content: hookJson },
      { path: "README.md", content: "---\nname: demo\ndescription: Hook demo.\n---\n\n# Hook\n" },
    ],
  });
  assert.ok(hook.ok, JSON.stringify(hook));
  assert.equal(
    artifactBodyFingerprint(hook.artifact),
    bodyFingerprint(hookJson, { withFrontmatter: false }),
  );
});

test("descriptionWords: lower-case, alphanumerics only, length >= 3, stop words removed", () => {
  const words = descriptionWords("Use THIS when you write Notes-v12, and not for the PDF!");
  assert.deepEqual([...words].sort(), ["note", "pdf", "v12", "write"]);
  assert.equal(descriptionWords("").size, 0);
  assert.equal(descriptionWords("a an to").size, 0);
});

test("jaccard: empty sets give 0; identical give 1; partial overlap", () => {
  assert.equal(jaccard(new Set(), new Set()), 0);
  assert.equal(jaccard(new Set(["a"]), new Set()), 0);
  assert.equal(jaccard(new Set(["a", "b"]), new Set(["a", "b"])), 1);
  assert.equal(jaccard(new Set(["a", "b", "c"]), new Set(["b", "c", "d"])), 0.5);
});

test("descriptionSimilarity: rounded to two decimals", () => {
  const s = descriptionSimilarity(
    "Writes release notes from merged pull requests",
    "Writes release notes from merged pull requests quickly",
  );
  assert.equal(s, Math.round(s * 100) / 100);
  assert.ok(s >= 0.8 && s < 1, String(s));
  assert.equal(descriptionSimilarity("", ""), 0);
});

test("isBackupRoot: recognised suffixes on any segment; -old is a name", () => {
  for (const r of [
    ".claude/skills/note.bak",
    "skills/note.old",
    "skills/note.orig",
    "skills/note.backup",
    "skills/note-backup",
    "skills/note~",
    "skills/note.bak/",
    "skills.bak/note",
    "skills/note.old/sub",
  ]) {
    assert.ok(isBackupRoot(r), r);
  }
  for (const r of [
    ".claude/skills/note",
    "skills/backup",
    "skills/.bak",
    "skills/convert-old",
    "skills/note-old",
    "",
  ]) {
    assert.ok(!isBackupRoot(r), r);
  }
});

test("descriptionWords: plural stems unify writer/writers", () => {
  const s = descriptionSimilarity("Extracts data for writers", "Extracts data for writer");
  assert.equal(s, 1, `writer≈writers should count as identical, got ${s}`);
  assert.ok(descriptionWords("status").has("status"), "'status' keeps its s");
  assert.ok(descriptionWords("files").has("file"), "'files' stems to 'file'");
  assert.ok(descriptionWords("writers").has("writer"), "'writers' stems to 'writer'");
});
