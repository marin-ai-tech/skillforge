import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRootVersionArgs } from "../src/root-args.ts";

test("parses root version flags and global options", () => {
  assert.deepEqual(parseRootVersionArgs(["--version"]), { json: false });
  assert.deepEqual(parseRootVersionArgs(["--json", "-V"]), { json: true });
  assert.deepEqual(parseRootVersionArgs(["--url", "http://x", "--version"]), { json: false });
  assert.deepEqual(parseRootVersionArgs(["--version", "publish"]), { json: false });
  assert.deepEqual(parseRootVersionArgs(["-V", "--no-color"]), { json: false });
  assert.deepEqual(parseRootVersionArgs(["--url=http://x", "--json", "--version"]), {
    json: true,
  });
  assert.deepEqual(parseRootVersionArgs(["--token", "t", "--version"]), { json: false });
});

test("stops parsing at subcommands, positional arguments, and --", () => {
  assert.equal(parseRootVersionArgs([]), null);
  assert.equal(parseRootVersionArgs(["publish", "x", "--version", "9.9.9"]), null);
  assert.equal(parseRootVersionArgs(["agent", "publish", "skill/x", "--version", "1.0.0"]), null);
  assert.equal(parseRootVersionArgs(["--"]), null);
  assert.equal(parseRootVersionArgs(["--", "--version"]), null);
});
