import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadConfig,
  normalizeRegistryUrl,
  resolveBridgeToken,
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

// cli-registry-resolve: the bridge and the other commands find the registry address and entry by one rule; only the
// token they take from the entry differs. One table goes through both resolvers.
type ResolveCase = {
  label: string;
  opts: { url?: string; token?: string };
  envUrl?: string;
  url: string;
  name: string;
  commands: string | undefined;
  bridge: string | undefined;
};

const A = "http://registry-a.example:8787";
const C = "https://registry-c.example";
const RESOLVE_CASES: ResolveCase[] = [
  { label: "default entry", opts: {}, url: A, name: "a", commands: "tok-A", bridge: "mcp-A" },
  {
    label: "same host, other case and a slash",
    opts: { url: "http://REGISTRY-A.example:8787/" },
    url: A,
    name: "a",
    commands: "tok-A",
    bridge: "mcp-A",
  },
  {
    label: "another host",
    opts: { url: "http://registry-b.example:9999" },
    url: "http://registry-b.example:9999",
    name: "a",
    commands: undefined,
    bridge: undefined,
  },
  {
    label: "same host, another port",
    opts: { url: "http://registry-a.example:9000" },
    url: "http://registry-a.example:9000",
    name: "a",
    commands: undefined,
    bridge: undefined,
  },
  {
    label: "an entry with only the MCP token",
    opts: { url: "https://registry-c.example/" },
    url: C,
    name: "c",
    commands: undefined,
    bridge: "mcp-C",
  },
  {
    label: "address from SKILLFORGE_URL",
    opts: {},
    envUrl: "https://REGISTRY-C.example",
    url: C,
    name: "c",
    commands: undefined,
    bridge: "mcp-C",
  },
  {
    label: "an explicit token wins for both",
    opts: { url: "http://registry-b.example:9999", token: "explicit" },
    url: "http://registry-b.example:9999",
    name: "a",
    commands: "explicit",
    bridge: "explicit",
  },
];

function checkResolveCase(c: ResolveCase): void {
  if (c.envUrl) process.env.SKILLFORGE_URL = c.envUrl;
  else delete process.env.SKILLFORGE_URL;
  const commands = resolveRegistry(c.opts);
  const bridge = resolveBridgeToken(c.opts);
  assert.equal(commands?.url, c.url, `${c.label}: commands url`);
  assert.equal(bridge?.url, c.url, `${c.label}: bridge url`);
  assert.equal(commands?.name, c.name, `${c.label}: commands entry name`);
  assert.equal(bridge?.name, c.name, `${c.label}: bridge entry name`);
  assert.equal(commands?.token, c.commands, `${c.label}: commands token`);
  assert.equal(bridge?.token, c.bridge, `${c.label}: bridge token`);
  // Negative: the commands never get an MCP token, whatever the address.
  assert.ok(
    !String(commands?.token ?? "").startsWith("mcp-"),
    `${c.label}: an MCP token reached the commands`,
  );
}

test("one address rule for the bridge and the commands", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-cfg-"));
  const cfgPath = path.join(dir, "config.json");
  saveConfig(
    {
      registries: {
        a: { url: A, token: "tok-A", mcp_token: "mcp-A" },
        c: { url: C, mcp_token: "mcp-C" },
      },
      default: "a",
    },
    cfgPath,
  );
  const saved = {
    SKILLFORGE_CONFIG: process.env.SKILLFORGE_CONFIG,
    SKILLFORGE_URL: process.env.SKILLFORGE_URL,
    SKILLFORGE_TOKEN: process.env.SKILLFORGE_TOKEN,
  };
  try {
    process.env.SKILLFORGE_CONFIG = cfgPath;
    delete process.env.SKILLFORGE_TOKEN;
    for (const c of RESOLVE_CASES) checkResolveCase(c);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
