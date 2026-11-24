import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizedPackageName,
  ociDigest,
  packageKey,
  packageVersion,
  registryTypeOfLauncher,
} from "../src/mcp-registry/package-key.ts";

test("packageKey: npm is unchanged, pypi follows PEP 503, OCI drops the digest", () => {
  assert.equal(packageKey("npm", "@colbymchenry/codegraph"), "npm:@colbymchenry/codegraph");
  assert.equal(packageKey("pypi", "Mcp_Foo.Bar"), "pypi:mcp-foo-bar");
  assert.equal(packageKey("pypi", "Foo---Bar__Baz"), "pypi:foo-bar-baz");
  assert.equal(
    packageKey("oci", "ghcr.io/acme/tool@sha256:" + "a".repeat(64)),
    "oci:ghcr.io/acme/tool",
  );
});

test("packageKey includes the registry type so npm and pypi of the same name do not collide", () => {
  assert.equal(packageKey("npm", "mcp-foo-bar"), "npm:mcp-foo-bar");
  assert.equal(packageKey("pypi", "mcp-foo-bar"), "pypi:mcp-foo-bar");
  assert.notEqual(packageKey("npm", "mcp-foo-bar"), packageKey("pypi", "mcp-foo-bar"));
  assert.notEqual(packageKey("npm", "Mcp_Foo.Bar"), packageKey("pypi", "Mcp_Foo.Bar"));
  assert.equal(normalizedPackageName("pypi", "Mcp_Foo.Bar"), "mcp-foo-bar");
  assert.equal(normalizedPackageName("npm", "mcp-foo-bar"), "mcp-foo-bar");
});

test("registryTypeOfLauncher and the OCI digest declared as the package version", () => {
  assert.equal(registryTypeOfLauncher("uvx"), "pypi");
  assert.equal(registryTypeOfLauncher("pipx"), "pypi");
  assert.equal(registryTypeOfLauncher("docker"), "oci");
  assert.equal(registryTypeOfLauncher("podman"), "oci");
  assert.equal(registryTypeOfLauncher("npx"), "npm");
  assert.equal(registryTypeOfLauncher(null), "npm");
  const digest = "sha256:" + "a".repeat(64);
  assert.equal(ociDigest("ghcr.io/acme/tool@" + digest), digest);
  assert.equal(packageVersion("oci", "ghcr.io/acme/tool@" + digest, null), digest);
  assert.equal(packageVersion("npm", "foo", "1.6.4"), "1.6.4");
});
