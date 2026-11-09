import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadConfig,
  normalizeRegistryUrl,
  resolveRegistry,
  saveConfig,
  upsertRegistry,
} from "../src/config.ts";

test("config write and load roundtrip", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-cfg-"));
  const cfgPath = path.join(dir, "config.json");
  saveConfig(
    {
      registries: { "127.0.0.1:8787": { url: "http://127.0.0.1:8787", token: "sf_test" } },
      default: "127.0.0.1:8787",
    },
    cfgPath,
  );
  const loaded = loadConfig(cfgPath);
  assert.equal(loaded.default, "127.0.0.1:8787");
  assert.equal(loaded.registries["127.0.0.1:8787"]?.token, "sf_test");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("resolveRegistry prefers env over config", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-cfg-"));
  const cfgPath = path.join(dir, "config.json");
  upsertRegistry("local", { url: "http://from-config:1", token: "tok-config" }, cfgPath);
  const prevCfg = process.env.SKILLFORGE_CONFIG;
  const prevUrl = process.env.SKILLFORGE_URL;
  const prevTok = process.env.SKILLFORGE_TOKEN;
  try {
    process.env.SKILLFORGE_CONFIG = cfgPath;
    delete process.env.SKILLFORGE_URL;
    delete process.env.SKILLFORGE_TOKEN;
    const fromCfg = resolveRegistry({});
    assert.equal(fromCfg?.url, "http://from-config:1");
    process.env.SKILLFORGE_URL = "http://from-env:9";
    process.env.SKILLFORGE_TOKEN = "tok-env";
    const fromEnv = resolveRegistry({});
    assert.equal(fromEnv?.url, "http://from-env:9");
    assert.equal(fromEnv?.token, "tok-env");
    const fromOpts = resolveRegistry({ url: "http://opts:3", token: "tok-opts" });
    assert.equal(fromOpts?.url, "http://opts:3");
    assert.equal(fromOpts?.token, "tok-opts");
  } finally {
    if (prevCfg === undefined) delete process.env.SKILLFORGE_CONFIG;
    else process.env.SKILLFORGE_CONFIG = prevCfg;
    if (prevUrl === undefined) delete process.env.SKILLFORGE_URL;
    else process.env.SKILLFORGE_URL = prevUrl;
    if (prevTok === undefined) delete process.env.SKILLFORGE_TOKEN;
    else process.env.SKILLFORGE_TOKEN = prevTok;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveRegistry does not issue token A for URL B", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-cfg-"));
  const cfgPath = path.join(dir, "config.json");
  upsertRegistry(
    "registry-a",
    { url: "http://registry-a.example:8787", token: "token-A-secret" },
    cfgPath,
  );
  const prevCfg = process.env.SKILLFORGE_CONFIG;
  const prevUrl = process.env.SKILLFORGE_URL;
  const prevTok = process.env.SKILLFORGE_TOKEN;
  try {
    process.env.SKILLFORGE_CONFIG = cfgPath;
    delete process.env.SKILLFORGE_URL;
    delete process.env.SKILLFORGE_TOKEN;

    const mismatch = resolveRegistry({ url: "http://registry-b.example:9999" });
    assert.equal(mismatch?.url, "http://registry-b.example:9999");
    assert.equal(mismatch?.token, undefined, "default token must not leak to other URL");

    process.env.SKILLFORGE_URL = "http://REGISTRY-B.example:9999/";
    const viaEnv = resolveRegistry({});
    assert.equal(viaEnv?.token, undefined);
    assert.equal(normalizeRegistryUrl(viaEnv!.url), "http://registry-b.example:9999");

    const match = resolveRegistry({ url: "http://REGISTRY-A.example:8787/" });
    assert.equal(match?.token, "token-A-secret");
    assert.equal(match?.url, "http://registry-a.example:8787");
  } finally {
    if (prevCfg === undefined) delete process.env.SKILLFORGE_CONFIG;
    else process.env.SKILLFORGE_CONFIG = prevCfg;
    if (prevUrl === undefined) delete process.env.SKILLFORGE_URL;
    else process.env.SKILLFORGE_URL = prevUrl;
    if (prevTok === undefined) delete process.env.SKILLFORGE_TOKEN;
    else process.env.SKILLFORGE_TOKEN = prevTok;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
