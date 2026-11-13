// tracked-sources: edit rules of a source — delete by glob, replace an exact string — applied to downloaded files
// before parsing; a rule that finds nothing is an error, never a silent pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEdits, parseEdits } from "../src/tracked/edits.ts";

const files = () => [
  { path: "SKILL.md", content: Buffer.from("# pdf\nRead first.\nzeige meine Subagenten, grüße\n") },
  { path: "assets/cover.png", content: Buffer.from([0x89, 0x50]) },
  { path: "assets/logo.svg", content: Buffer.from("<svg/>") },
  { path: "ui/public/brand/mark.png", content: Buffer.from([1]) },
];

test("delete by glob and replace an exact string", () => {
  const edits = parseEdits([
    { op: "delete", glob: "assets/*.png" },
    { op: "delete", glob: "ui/**/*.png" },
    { op: "replace", file: "SKILL.md", find: "zeige meine Subagenten, grüße\n", with: "" },
  ]);
  assert.ok(edits.ok, JSON.stringify(edits));
  if (!edits.ok) return;
  const r = applyEdits(files(), edits.edits);
  assert.ok(r.ok, JSON.stringify(r));
  if (!r.ok) return;
  assert.deepEqual(r.files.map((f) => f.path).sort(), ["SKILL.md", "assets/logo.svg"]);
  assert.equal(
    r.files.find((f) => f.path === "SKILL.md")!.content.toString("utf8"),
    "# pdf\nRead first.\n",
  );
});

test("a rule that finds nothing stops with edits_outdated", () => {
  for (const rule of [
    { op: "delete", glob: "docs/*.png" },
    { op: "replace", file: "SKILL.md", find: "not there", with: "" },
    { op: "replace", file: "MISSING.md", find: "x", with: "" },
  ]) {
    const edits = parseEdits([rule]);
    assert.ok(edits.ok);
    if (!edits.ok) continue;
    const r = applyEdits(files(), edits.edits);
    assert.equal(r.ok, false, JSON.stringify(rule));
    assert.ok(!r.ok && r.error === "edits_outdated");
  }
});

test("rules are parsed at the boundary", () => {
  for (const bad of [
    "x",
    [{ op: "rename", from: "a", to: "b" }],
    [{ op: "delete" }],
    [{ op: "replace", file: "../SKILL.md", find: "a", with: "b" }],
    [{ op: "replace", file: "/etc/passwd", find: "a", with: "b" }],
    [{ op: "replace", file: "SKILL.md", find: "", with: "b" }],
    [{ op: "delete", glob: "../**" }],
    Array.from({ length: 51 }, () => ({ op: "delete", glob: "a/*" })),
  ]) {
    assert.equal(parseEdits(bad).ok, false, JSON.stringify(bad).slice(0, 80));
  }
  assert.deepEqual(parseEdits([]), { ok: true, edits: [] });
});
