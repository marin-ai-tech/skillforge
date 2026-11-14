// opencode-sessions: the OpenCode export adapter on its own — encodings, the check window, what is not a use.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodeExport, opencodeAdapter } from "../src/sessions/opencode.ts";

const T0 = Date.parse("2026-11-14T09:00:00.000Z");
const skill = (name: string, min: number, status = "completed") => ({
  type: "tool",
  tool: "skill",
  state: { status, input: { name }, time: { start: T0 + min * 60000 } },
});
const bash = (command: string, exit: number | undefined, status = "completed") => ({
  type: "tool",
  tool: "bash",
  state: { status, input: { command }, metadata: exit === undefined ? {} : { exit } },
});

function write(parts: unknown[], id = "ses_unit"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-oc-"));
  const file = path.join(dir, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify({ info: { id }, messages: [{ info: {}, parts }] }));
  return file;
}

test("decodeExport: UTF-8 with BOM, UTF-16 LE and BE give the same text", () => {
  const text = '{"a":"é"}';
  const be = Buffer.from(text, "utf16le");
  be.swap16();
  for (const buf of [
    Buffer.from(`\uFEFF${text}`, "utf8"),
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]),
    Buffer.concat([Buffer.from([0xfe, 0xff]), be]),
  ]) {
    assert.equal(decodeExport(buf), text);
  }
});

test("the last check in the window decides; a check without an exit code counts by status; failed calls are not uses", () => {
  const r = opencodeAdapter.parse(
    write([
      skill("a", 1),
      bash("npm test", 0),
      bash("npm test", 1),
      skill("b", 2),
      bash("npx playwright test", undefined, "error"),
      skill("c", 3, "error"),
      skill("d", 4),
      bash("echo npm", 0),
    ]),
  );
  assert.equal(r.sessions, 1);
  assert.deepEqual(
    r.facts.map((f) => [f.skill, f.verification]),
    [
      ["a", "fail"],
      ["b", "fail"],
      ["d", "none"],
    ],
  );
  assert.equal(r.facts[0]!.used_at, new Date(T0 + 60000).toISOString());
});

test("a file that is not a session export is skipped and counted", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-oc-"));
  const file = path.join(dir, "x.json");
  fs.writeFileSync(file, '{"mcp": {}}');
  assert.deepEqual(opencodeAdapter.parse(file), {
    facts: [],
    sessions: 0,
    invocations: 0,
    skipped_lines: 1,
  });
});
