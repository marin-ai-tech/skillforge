// getting-started-walkthrough: «First steps» is the end-to-end path from starting SkillForge to checking that it works
// with agents — eleven numbered steps, each with a «Done when» sign of success and a link to the detailed topic, the
// last one a checklist; first in the «Getting started» section, in EN and RU. Negative: the topic must not teach the
// workarounds of 0.5 (SKILLFORGE_CONFIG per session, publishing a pack by raw POST, agent publish as a snapshot).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/client.mjs";

const HELP = join(ROOT, "packages", "web", "src", "help");
const topic = (lang) =>
  readFileSync(join(HELP, lang === "en" ? "topics" : "topics-ru", "getting-started", "first-steps.md"), "utf8");
// The RU sign of success as unicode escapes: the public tree keeps test sources free of Cyrillic.
const RU_DONE = String.fromCharCode(0x413, 0x43e, 0x442, 0x43e, 0x432, 0x43e, 0x2c, 0x20, 0x435, 0x441, 0x43b, 0x438);
const DONE = { en: /\*\*Done when\*\*/, ru: new RegExp(`\\*\\*${RU_DONE}\\*\\*`) };

function steps(text) {
  const body = text.replace(/^---[\s\S]*?---\r?\n/, "");
  const parts = body.split(/^## /m).slice(1);
  return parts
    .map((p) => ({ head: p.split("\n")[0], text: p }))
    .filter((s) => /^\d+\.\s/.test(s.head));
}

for (const lang of ["en", "ru"]) {
  test(`${lang}: eleven numbered steps, each with a sign of success and a link; the last is a checklist`, () => {
    const s = steps(topic(lang));
    assert.deepEqual(
      s.map((x) => Number(x.head.split(".")[0])),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      s.map((x) => x.head).join(" | "),
    );
    for (const step of s.slice(0, 10)) {
      assert.match(step.text, DONE[lang], `step without a sign of success: ${step.head}`);
      assert.match(step.text, /\]\((getting-started|pages|actions)\/[a-z0-9/-]+\)/, `step without a topic link: ${step.head}`);
    }
    const last = s[10].text;
    assert.ok((last.match(/^- \[ \] /gm) ?? []).length >= 10, "the last step is not a checklist of at least ten checks");
  });

  test(`${lang}: no workarounds of 0.5 and no internal task numbers`, () => {
    const t = topic(lang);
    assert.doesNotMatch(t, /SKILLFORGE_CONFIG/, "sessions are separated by CLI profiles now");
    assert.doesNotMatch(t, /POST \/api\/v1\/packs\b(?!\/check)/, "a pack is published with the form or pack publish");
    assert.doesNotMatch(t, /agent publish/, "a snapshot is sent with agent scan");
    assert.doesNotMatch(t, /#\d{2,}|backlog/i, "internal task numbers in a public topic");
    assert.match(t, /--profile/);
    assert.match(t, /agent scan --mcp/);
    assert.match(t, /pack publish/);
  });
}

test("first-steps is the first topic of the Getting started section", () => {
  const src = readFileSync(join(HELP, "sections.ts"), "utf8");
  const order = src.slice(src.indexOf("const GUIDE_ORDER"), src.indexOf("];", src.indexOf("const GUIDE_ORDER")));
  const first = /"([^"]+)"/.exec(order)?.[1];
  assert.equal(first, "getting-started/first-steps");
});

test("docs/en has the same path first in Start here", () => {
  const doc = readFileSync(join(ROOT, "docs", "en", "00-first-steps.md"), "utf8");
  assert.equal(steps(doc).length, 11);
  const readme = readFileSync(join(ROOT, "docs", "en", "README.md"), "utf8");
  const start = readme.slice(readme.search(/start here/i));
  const firstLink = /\]\(([^)]+)\)/.exec(start)?.[1];
  assert.equal(firstLink, "00-first-steps.md");
});
