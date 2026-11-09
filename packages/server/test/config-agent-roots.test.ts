import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseConfig, ConfigError } from "../src/config.ts";

test("parseConfig: agentRoots empty by default", () => {
  const cfg = parseConfig({});
  assert.deepEqual(cfg.agentRoots, []);
});

test("parseConfig: agentRoots semicolon and colon; Windows drive not split", () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), "sf-ar-a-"));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), "sf-ar-b-"));
  try {
    const cfg = parseConfig({ SKILLFORGE_AGENT_ROOTS: `${a};${b}` });
    assert.equal(cfg.agentRoots.length, 2);
    assert.ok(
      cfg.agentRoots[0]!.includes(path.basename(a)) || cfg.agentRoots[0] === path.resolve(a),
    );
    assert.equal(cfg.agentRoots[0], path.resolve(a));
    assert.equal(cfg.agentRoots[1], path.resolve(b));

    const unixStyle = parseConfig({ SKILLFORGE_AGENT_ROOTS: `${a}:${b}` });
    assert.equal(unixStyle.agentRoots.length, 2);

    // Drive-letter path must not split on the colon after the letter.
    if (process.platform === "win32") {
      const drive = parseConfig({ SKILLFORGE_AGENT_ROOTS: a });
      assert.equal(drive.agentRoots.length, 1);
    }
  } finally {
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  }
});

test("parseConfig: missing agent root throws ConfigError naming variable", () => {
  assert.throws(
    () => parseConfig({ SKILLFORGE_AGENT_ROOTS: path.join(os.tmpdir(), "sf-missing-root-xyz") }),
    (err: unknown) => err instanceof ConfigError && err.variable === "SKILLFORGE_AGENT_ROOTS",
  );
});
