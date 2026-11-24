import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig, ConfigError } from "../src/config.ts";
import {
  compareNumericRelease,
  isPreRelease,
  isUpstreamNewer,
  npmLatestUrl,
  npmPackagePath,
  parseRegistryVersion,
} from "../src/mcp-registry/release-check.ts";

test("parseRegistryVersion: npm and pypi fields, the 128-character set, rejects junk", () => {
  assert.equal(parseRegistryVersion(JSON.stringify({ version: "1.7.0" }), "npm"), "1.7.0");
  assert.equal(
    parseRegistryVersion(JSON.stringify({ info: { version: "1.1.0" } }), "pypi"),
    "1.1.0",
  );
  assert.equal(parseRegistryVersion("not json {", "npm"), null);
  assert.equal(parseRegistryVersion(JSON.stringify({ version: "1.7.0; rm -rf /" }), "npm"), null);
  assert.equal(parseRegistryVersion(JSON.stringify({ version: 1 }), "npm"), null);
  assert.equal(parseRegistryVersion(JSON.stringify({}), "npm"), null);
});

test("isUpstreamNewer: pre-releases and older versions are not newer; unparsed differs", () => {
  assert.equal(isUpstreamNewer("1.7.0", "1.6.4", "npm"), true);
  assert.equal(isUpstreamNewer("1.6.4", "1.6.4", "npm"), false);
  assert.equal(isUpstreamNewer("1.6.3", "1.6.4", "npm"), false);
  assert.equal(isUpstreamNewer("1.9.0-beta.1", "1.6.4", "npm"), false);
  assert.equal(isPreRelease("1.9.0-beta.1"), true);
  assert.equal(isPreRelease("1.0.0a1"), true);
  assert.equal(isPreRelease("1.0.0"), false);
  assert.equal(isUpstreamNewer("1.10.2", "1.9", "pypi"), true);
  assert.equal(isUpstreamNewer("1.9", "1.10.2", "pypi"), false);
  assert.equal(compareNumericRelease("1.10.2", "1.9")! > 0, true);
  assert.equal(isUpstreamNewer("weird+ok", "other", "npm"), true);
});

test("parseConfig: default registry URLs and the release-check switch", () => {
  const cfg = parseConfig({});
  assert.equal(cfg.npmRegistryUrl, "https://registry.npmjs.org");
  assert.equal(cfg.pypiUrl, "https://pypi.org");
  assert.equal(cfg.mcpReleaseCheck, true);
  const off = parseConfig({ SKILLFORGE_MCP_RELEASE_CHECK: "false" });
  assert.equal(off.mcpReleaseCheck, false);
  const custom = parseConfig({
    SKILLFORGE_NPM_REGISTRY_URL: "http://127.0.0.1:4873",
    SKILLFORGE_PYPI_URL: "https://pypi.example",
  });
  assert.equal(custom.npmRegistryUrl, "http://127.0.0.1:4873");
  assert.equal(custom.pypiUrl, "https://pypi.example");
});

test("parseConfig: a plain-http or credentialed registry address is a ConfigError naming the variable", () => {
  assert.throws(
    () => parseConfig({ SKILLFORGE_NPM_REGISTRY_URL: "http://registry.example.com" }),
    (e: unknown) => e instanceof ConfigError && e.variable === "SKILLFORGE_NPM_REGISTRY_URL",
  );
  assert.throws(
    () => parseConfig({ SKILLFORGE_PYPI_URL: "https://user:pass@pypi.org" }),
    (e: unknown) => e instanceof ConfigError && e.variable === "SKILLFORGE_PYPI_URL",
  );
  assert.throws(
    () => parseConfig({ SKILLFORGE_NPM_REGISTRY_URL: "https://registry.npmjs.org?x=1" }),
    (e: unknown) => e instanceof ConfigError && e.variable === "SKILLFORGE_NPM_REGISTRY_URL",
  );
});

test("npm package path: unscoped is one encoded segment; scoped is @scope%2Fname", () => {
  assert.equal(npmPackagePath("mcp-foo-bar"), "mcp-foo-bar");
  assert.equal(npmPackagePath("foo?bar#baz"), "foo%3Fbar%23baz");
  assert.equal(npmPackagePath("foo/../bar"), "foo%2F..%2Fbar");
  assert.equal(npmPackagePath("@scope/name"), "@scope%2Fname");
  assert.equal(npmPackagePath("@sc ope/na?me#x"), "@sc%20ope%2Fna%3Fme%23x");
  const base = "https://registry.npmjs.org";
  assert.equal(npmLatestUrl(base, "weird?x#y"), "https://registry.npmjs.org/weird%3Fx%23y/latest");
  assert.equal(
    npmLatestUrl(base, "@acme/pkg#1"),
    "https://registry.npmjs.org/@acme%2Fpkg%231/latest",
  );
  assert.equal(new URL(npmLatestUrl(base, "a?b#c/../d")).pathname, "/a%3Fb%23c%2F..%2Fd/latest");
});
