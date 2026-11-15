// rules-block: Codex, Gemini CLI and Qwen Code read rules from one shared file (AGENTS.md, GEMINI.md, QWEN.md), so
// SkillForge owns one block in it between its own markers. The block is built from the installed rules; everything
// outside it (a person's text, the sdlc process-rules block) stays byte for byte, and removing the block gives the
// file back as it was.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RULES_BLOCK_END as END,
  RULES_BLOCK_START as START,
  findRulesBlock,
  renderRulesBlock,
  replaceRulesBlock,
} from "../src/runtimes/rules-block.ts";

const SCOPED = `---\nname: api-style\ndescription: Style of the API handlers.\npaths:\n  - "src/api/**/*.ts"\n  - "tests/api/**"\n---\n\nValidate input at the boundary and return typed errors.\n`;
const ALWAYS = `---\nname: no-secrets-in-logs\ndescription: Keeps secrets out of logs.\n---\n\nNever write secrets, tokens or passwords to logs.\n`;
const SDLC = `<!-- sdlc:rules:start -->\n## Process rules (sdlc)\n\n- Run the tests before a commit.\n<!-- sdlc:rules:end -->\n`;
const HUMAN = `# Project\n\nUse pnpm, not npm.\n\n${SDLC}`;

const block = renderRulesBlock(
  [
    { name: "no-secrets-in-logs", text: ALWAYS },
    { name: "api-style", text: SCOPED },
  ],
  "codex",
);

test("the block: markers, a heading, the managing note, rules by name, paths as a line, bodies without frontmatter", () => {
  assert.equal(
    block,
    [
      START,
      "## Project rules from SkillForge",
      "",
      "<!-- Managed by SkillForge. Do not edit between the markers: change the rule in the registry, then run `skillforge sync --type rule --runtime codex`. -->",
      "",
      "### api-style",
      "",
      "Applies when working with files matching: `src/api/**/*.ts`, `tests/api/**`",
      "",
      "Validate input at the boundary and return typed errors.",
      "",
      "### no-secrets-in-logs",
      "",
      "Never write secrets, tokens or passwords to logs.",
      END,
    ].join("\n"),
  );
  assert.ok(
    renderRulesBlock([{ name: "api-style", text: SCOPED }], "qwen").includes("--runtime qwen"),
  );
  assert.equal(renderRulesBlock([], "codex"), "", "no rules, no block");
});

test("finding the block: none, one, and broken markers", () => {
  assert.deepEqual(findRulesBlock(HUMAN), { ok: true, found: null });
  assert.deepEqual(findRulesBlock(""), { ok: true, found: null });
  const text = `${HUMAN}\n${block}\n`;
  const f = findRulesBlock(text);
  assert.ok(f.ok && f.found);
  assert.equal(f.found.text, block);
  assert.equal(text.slice(f.found.start, f.found.end), block);
  // A marker is a whole line: one quoted in prose is not a block.
  assert.deepEqual(findRulesBlock(`Our block starts at \`${START}\`.\n`), {
    ok: true,
    found: null,
  });
  for (const broken of [
    `${START}\nA\n`,
    `A\n${END}\n`,
    `${END}\nA\n${START}\n`,
    `${START}\nA\n${START}\nB\n${END}\n`,
    `${block}\n\n${block}\n`,
  ]) {
    const r = findRulesBlock(broken);
    assert.equal(r.ok, false, broken);
    assert.ok(!r.ok && r.reason.length > 0);
  }
});

test("adding to a missing file, to the end of a file, and replacing in place", () => {
  assert.equal(replaceRulesBlock(null, block), `${block}\n`);
  assert.equal(replaceRulesBlock(HUMAN, block), `${HUMAN}\n${block}\n`);
  assert.equal(replaceRulesBlock("# Project", block), `# Project\n\n${block}\n`);
  const moved = `# A\n\n${block}\n\n# B\n`;
  const next = renderRulesBlock([{ name: "api-style", text: SCOPED }], "codex");
  assert.equal(replaceRulesBlock(moved, next), `# A\n\n${next}\n\n# B\n`);
  assert.equal(
    replaceRulesBlock(`${HUMAN}\n${block}\n`, block),
    `${HUMAN}\n${block}\n`,
    "idempotent",
  );
});

test("removing the block gives the file back byte for byte; an empty file goes away", () => {
  for (const original of [HUMAN, "# Project", "# Project\n\n\n"]) {
    const added = replaceRulesBlock(original, block);
    assert.ok(added !== null);
    const removed = replaceRulesBlock(added, "");
    assert.equal(
      removed,
      original.endsWith("\n") ? original : `${original}\n`,
      JSON.stringify(original),
    );
  }
  assert.equal(replaceRulesBlock(replaceRulesBlock(null, block), ""), null);
  assert.equal(replaceRulesBlock(`  \n\n${block}\n`, ""), null, "only whitespace is left");
  assert.equal(replaceRulesBlock(null, ""), null);
  assert.equal(replaceRulesBlock(HUMAN, ""), HUMAN, "no block, nothing to remove");
});

test("CRLF files get a CRLF block; a BOM stays", () => {
  const crlf = HUMAN.replace(/\n/g, "\r\n");
  const added = replaceRulesBlock(crlf, block);
  assert.ok(added !== null);
  assert.equal(added, `${crlf}\r\n${block.replace(/\n/g, "\r\n")}\r\n`);
  assert.equal(replaceRulesBlock(added, ""), crlf);
  const f = findRulesBlock(added);
  assert.ok(f.ok && f.found, "markers are found in a CRLF file");

  const BOM = String.fromCharCode(0xfeff);
  const bom = `${BOM}${HUMAN}`;
  const withBom = replaceRulesBlock(bom, block);
  assert.ok(withBom?.startsWith(`${BOM}# Project`));
  assert.equal(replaceRulesBlock(withBom, ""), bom);
});
