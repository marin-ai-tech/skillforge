import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanServerDir } from "../src/agents/scan.ts";

// The server agent scan must walk the verified real path and never read directories
// whose realpath leaves the scan root (junction on Windows, directory symlink elsewhere).
const LINK_TYPE = process.platform === "win32" ? "junction" : "dir";
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sf-agent-scan-real-")));

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function skill(name: string): string {
  return `---\nname: ${name}\ndescription: Test skill ${name}. Use when testing the agent scan.\n---\n\nBody.\n`;
}

function write(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function makeTree(name: string): { base: string; agent: string; outside: string } {
  const base = path.join(tmp, name);
  const agent = path.join(base, "root", "agent");
  const outside = path.join(base, "outside");
  write(path.join(agent, "skills", "inside-ok", "SKILL.md"), skill("inside-ok"));
  write(path.join(outside, "skills", "outside-secret", "SKILL.md"), skill("outside-secret"));
  write(path.join(outside, "secret.txt"), "outside secret\n");
  return { base, agent, outside };
}

function samePathForTest(a: string, b: string): boolean {
  const norm = (p: string) =>
    process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p);
  return norm(a) === norm(b);
}

function leaked(files: Array<{ content: Uint8Array }>): boolean {
  return files.some((f) => Buffer.from(f.content).toString("utf8").includes("outside secret"));
}

test("scanServerDir: link inside the tree to a directory outside the root is not followed", () => {
  const { agent, outside } = makeTree("static");
  fs.symlinkSync(outside, path.join(agent, "linked"), LINK_TYPE);
  fs.symlinkSync(outside, path.join(agent, "skills", "linked-skills"), LINK_TYPE);

  const r = scanServerDir(agent, { expectRealPath: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  assert.deepEqual(
    r.files.map((f) => f.path),
    ["skills/inside-ok/SKILL.md"],
  );
  assert.equal(leaked(r.files), false);
});

test("scanServerDir: directory swapped for a junction after listing its parent is not read", (t) => {
  const { base, agent, outside } = makeTree("race");
  const sub = path.join(agent, "sub");
  write(path.join(sub, "skills", "sub-ok", "SKILL.md"), skill("sub-ok"));

  // Deterministic stand-in for the check -> walk race: right after the agent root is listed
  // (and "sub" is reported as a real directory), "sub" is replaced by a link to the outside.
  const realReaddir = fs.readdirSync;
  let swapped = false;
  t.mock.method(fs, "readdirSync", ((...args: unknown[]) => {
    const out = (realReaddir as (...a: unknown[]) => unknown).apply(fs, args);
    if (!swapped && samePathForTest(String(args[0]), agent)) {
      swapped = true;
      fs.renameSync(sub, path.join(base, "sub-moved"));
      fs.symlinkSync(outside, sub, LINK_TYPE);
    }
    return out;
  }) as typeof fs.readdirSync);

  const r = scanServerDir(agent, { expectRealPath: true });
  assert.equal(swapped, true, "the swap hook must have run");
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  assert.deepEqual(
    r.files.map((f) => f.path),
    ["skills/inside-ok/SKILL.md"],
  );
  assert.equal(leaked(r.files), false);
  assert.deepEqual(r.skipped, [{ path: "sub", reason: "outside_scan_root" }]);
});

test("scanServerDir: verified real path that became a link is refused", () => {
  const { base, agent, outside } = makeTree("root-swap");
  const verified = fs.realpathSync(agent);
  fs.renameSync(agent, path.join(base, "agent-moved"));
  fs.symlinkSync(outside, agent, LINK_TYPE);

  const r = scanServerDir(verified, { expectRealPath: true });
  assert.deepEqual(r, {
    ok: false,
    error: "path_outside_roots",
    message: "agent path changed after the roots check",
  });
});
