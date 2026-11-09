import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockedArchiveHost,
  resolveMarketplaceSource,
  shellSafeEntry,
} from "../src/distribution/source-mode.ts";

test("blockedArchiveHost mirrors Claude Code: loopback, link-local, metadata blocked; public hosts allowed", () => {
  for (const h of [
    "localhost",
    "LOCALHOST.",
    "sf.localhost",
    "127.0.0.1",
    "127.8.9.10",
    "0.0.0.0",
    "169.254.169.254",
    "[::1]",
    "::",
    "fe80::1",
    "::ffff:127.0.0.1",
    "metadata.google.internal",
    "instance-data.eu-west-1.compute.internal",
    "100.100.100.200",
  ]) {
    assert.equal(blockedArchiveHost(h), true, h);
  }
  for (const h of [
    "skillforge.example.com",
    "10.0.0.5",
    "192.168.1.20",
    "sf.corp",
    "[2001:db8::1]",
  ]) {
    assert.equal(blockedArchiveHost(h), false, h);
  }
});

test("resolveMarketplaceSource: auto, explicit modes and refusals", () => {
  assert.equal(resolveMarketplaceSource(undefined, "https://sf.example.com"), "archive");
  assert.equal(resolveMarketplaceSource("auto", "http://127.0.0.1:8787"), "command");
  assert.equal(resolveMarketplaceSource("", "https://localhost:8443"), "command");
  // URL rewrites the mapped loopback to ::ffff:7f00:1 — still loopback, so no archive; brackets are not
  // command-safe either, so this base URL has no source at all (startup refused).
  assert.equal(resolveMarketplaceSource("archive", "https://[::ffff:127.0.0.1]:8443"), null);
  assert.equal(resolveMarketplaceSource("auto", "https://[::ffff:127.0.0.1]:8443"), null);
  assert.equal(resolveMarketplaceSource("auto", "https://[::ffff:10.0.0.5]"), "archive");
  assert.equal(resolveMarketplaceSource("command", "https://sf.example.com/"), "command");
  assert.equal(resolveMarketplaceSource("archive", "http://sf.example.com"), null);
  assert.equal(resolveMarketplaceSource("archive", "https://127.0.0.1"), null);
  assert.equal(resolveMarketplaceSource("command", "http://sf.example.com/a&b"), null);
  assert.equal(resolveMarketplaceSource("auto", "http://sf.example.com/x y"), null);
  assert.equal(resolveMarketplaceSource("tarball", "https://sf.example.com"), null);
});

test("shellSafeEntry: only kebab names and semver-charset versions reach the shell", () => {
  assert.equal(shellSafeEntry("skill", "pdf-tools", "1.0.0-beta.1+b2"), true);
  assert.equal(shellSafeEntry("skill", "pdf&tools", "1.0.0"), false);
  assert.equal(shellSafeEntry("skill", "pdf-tools", "1.0.0|calc"), false);
  assert.equal(shellSafeEntry("skill", "pdf-tools", "1.0.0 x"), false);
  assert.equal(shellSafeEntry("sk ill", "pdf-tools", "1.0.0"), false);
});
