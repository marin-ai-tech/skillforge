import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConfigError } from "../src/config-error.ts";
import { findProjectBinding, parseProfileBinding } from "../src/profile-binding.ts";
import {
  checkProfileUrl,
  loadConfig,
  normalizeRegistryUrl,
  resolveBridgeToken,
  resolveRegistry,
  saveConfig,
  upsertRegistry,
} from "../src/config.ts";
import { createContext } from "../src/context.ts";
import { runDoctor } from "../src/commands/doctor.ts";
import { runLogout } from "../src/commands/logout.ts";
import { runProjectStatus } from "../src/commands/project.ts";

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

// cli-profiles: profile selection goes through both resolvers; a binding is parsed on the boundary.
type ProfileCase = {
  label: string;
  opts: { url?: string; token?: string; profile?: string; cwd?: string };
  env?: { SKILLFORGE_URL?: string; SKILLFORGE_TOKEN?: string; SKILLFORGE_PROFILE?: string };
  url?: string;
  name?: string;
  commands?: string;
  bridge?: string;
  throws?: string;
};

const PA = "http://registry-a.example:8787";
const PB = "http://registry-b.example:9999";

function withEnv(env: ProfileCase["env"], fn: () => void): void {
  const keys = ["SKILLFORGE_URL", "SKILLFORGE_TOKEN", "SKILLFORGE_PROFILE"] as const;
  const saved: Record<string, string | undefined> = {};
  for (const k of keys) saved[k] = process.env[k];
  try {
    for (const k of keys) {
      const v = env?.[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

function checkProfileCase(c: ProfileCase, configPath: string): void {
  const opts = { ...c.opts, configPath };
  withEnv(c.env, () => {
    if (c.throws) {
      const failed = (fn: () => unknown, wrapper: string) => {
        try {
          fn();
          assert.fail(`${c.label}: ${wrapper} should throw ${c.throws}`);
        } catch (err) {
          assert.ok(err instanceof ConfigError, `${c.label}: ${wrapper} ${String(err)}`);
          assert.equal(err.code, c.throws, `${c.label}: ${wrapper} code`);
        }
      };
      failed(() => resolveRegistry(opts), "commands");
      failed(() => resolveBridgeToken(opts), "bridge");
      return;
    }
    const commands = resolveRegistry(opts);
    const bridge = resolveBridgeToken(opts);
    assert.equal(commands?.url, c.url, `${c.label}: commands url`);
    assert.equal(bridge?.url, c.url, `${c.label}: bridge url`);
    assert.equal(commands?.name, c.name, `${c.label}: commands name`);
    assert.equal(bridge?.name, c.name, `${c.label}: bridge name`);
    assert.equal(commands?.token, c.commands, `${c.label}: commands token`);
    assert.equal(bridge?.token, c.bridge, `${c.label}: bridge token`);
    assert.ok(
      !String(commands?.token ?? "").startsWith("mcp-"),
      `${c.label}: an MCP token reached the commands`,
    );
  });
}

test("profile selection goes through both resolvers", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-prof-"));
  const cfgPath = path.join(dir, "config.json");
  const bound = path.join(dir, "proj", "src");
  fs.mkdirSync(path.join(dir, "proj", ".skillforge"), { recursive: true });
  fs.mkdirSync(bound, { recursive: true });
  fs.writeFileSync(path.join(dir, "proj", ".skillforge", "profile"), "station\n");
  saveConfig(
    {
      registries: {
        admin: { url: PA, token: "tok-admin", mcp_token: "mcp-admin" },
        station: { url: PA, token: "tok-station", mcp_token: "mcp-station" },
        other: { url: PB, token: "tok-other" },
      },
      default: "admin",
    },
    cfgPath,
  );
  const savedCfg = process.env.SKILLFORGE_CONFIG;
  const cases: ProfileCase[] = [
    {
      label: "default without a choice",
      opts: {},
      url: PA,
      name: "admin",
      commands: "tok-admin",
      bridge: "mcp-admin",
    },
    {
      label: "--profile station",
      opts: { profile: "station" },
      url: PA,
      name: "station",
      commands: "tok-station",
      bridge: "mcp-station",
    },
    {
      label: "SKILLFORGE_PROFILE",
      opts: {},
      env: { SKILLFORGE_PROFILE: "station" },
      url: PA,
      name: "station",
      commands: "tok-station",
      bridge: "mcp-station",
    },
    {
      label: "explicit profile ignores SKILLFORGE_TOKEN",
      opts: { profile: "station" },
      env: { SKILLFORGE_TOKEN: "tok-env" },
      url: PA,
      name: "station",
      commands: "tok-station",
      bridge: "mcp-station",
    },
    {
      label: "--token wins over an explicit profile",
      opts: { profile: "station", token: "explicit" },
      env: { SKILLFORGE_TOKEN: "tok-env" },
      url: PA,
      name: "station",
      commands: "explicit",
      bridge: "explicit",
    },
    {
      label: "without an explicit profile SKILLFORGE_TOKEN still wins",
      opts: {},
      env: { SKILLFORGE_TOKEN: "tok-env" },
      url: PA,
      name: "admin",
      commands: "tok-env",
      bridge: "tok-env",
    },
    {
      label: "--profile other uses its address",
      opts: { profile: "other" },
      url: PB,
      name: "other",
      commands: "tok-other",
      bridge: "tok-other",
    },
    {
      label: "project binding from a subdirectory",
      opts: { cwd: bound },
      url: PA,
      name: "station",
      commands: "tok-station",
      bridge: "mcp-station",
    },
    {
      label: "URL matches default among several",
      opts: {},
      env: { SKILLFORGE_URL: PA },
      url: PA,
      name: "admin",
      commands: "tok-admin",
      bridge: "mcp-admin",
    },
    {
      label: "several profiles of one address, default not among them",
      opts: {},
      env: { SKILLFORGE_URL: PA, SKILLFORGE_PROFILE: undefined },
      // default is switched in a nested config below — see the second suite
      throws: undefined,
    },
    { label: "unknown profile", opts: { profile: "ghost" }, throws: "profile_not_found" },
    {
      label: "profile and a different --url",
      opts: { profile: "other", url: PA },
      throws: "profile_url_conflict",
    },
  ];
  try {
    process.env.SKILLFORGE_CONFIG = cfgPath;
    for (const c of cases.filter(
      (x) => x.label !== "several profiles of one address, default not among them",
    )) {
      checkProfileCase(c, cfgPath);
    }
    saveConfig(
      {
        registries: {
          admin: { url: PA, token: "tok-admin", mcp_token: "mcp-admin" },
          station: { url: PA, token: "tok-station", mcp_token: "mcp-station" },
          other: { url: PB, token: "tok-other" },
        },
        default: "other",
      },
      cfgPath,
    );
    checkProfileCase(
      {
        label: "several profiles of one address, default not among them",
        opts: {},
        env: { SKILLFORGE_URL: PA },
        throws: "profile_ambiguous",
      },
      cfgPath,
    );
  } finally {
    if (savedCfg === undefined) delete process.env.SKILLFORGE_CONFIG;
    else process.env.SKILLFORGE_CONFIG = savedCfg;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function writeBinding(dir: string, body: string | Buffer): string {
  const file = path.join(dir, ".skillforge", "profile");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

test("profile binding parse: BOM, CRLF, blank lines, size and names", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-bind-"));
  try {
    const bom = writeBinding(
      path.join(dir, "bom"),
      Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from("station\n", "utf8")]),
    );
    assert.equal(parseProfileBinding(bom), "station");

    const crlf = writeBinding(path.join(dir, "crlf"), "station\r\n");
    assert.equal(parseProfileBinding(crlf), "station");

    const blanks = writeBinding(path.join(dir, "blanks"), "\n  \nstation\n\n");
    assert.equal(parseProfileBinding(blanks), "station");

    const v6 = writeBinding(path.join(dir, "v6"), "[::1]:8787\n");
    assert.equal(parseProfileBinding(v6), "[::1]:8787");

    const hostport = writeBinding(path.join(dir, "hp"), "127.0.0.1:8787\n");
    assert.equal(parseProfileBinding(hostport), "127.0.0.1:8787");

    const tooBig = writeBinding(path.join(dir, "big"), "x".repeat(1025));
    assert.throws(
      () => parseProfileBinding(tooBig),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.equal(err.code, "profile_binding_invalid");
        assert.ok(String(err.message).includes(tooBig));
        assert.ok(!String(err.message).includes("xxx"));
        return true;
      },
    );

    const badNames: [string, string][] = [
      ["space", "a b\n"],
      ["slash", "hello/world\n"],
      ["dotdot", "../x\n"],
      ["url", "https://evil.example/x\n"],
      ["two", "station\nadmin\n"],
      ["empty", ""],
    ];
    for (const [label, body] of badNames) {
      const file = writeBinding(path.join(dir, label), body);
      assert.throws(
        () => parseProfileBinding(file),
        (err: unknown) => {
          assert.ok(err instanceof ConfigError, label);
          assert.equal(err.code, "profile_binding_invalid", label);
          assert.ok(String(err.message).includes(file), label);
          assert.ok(!String(err.message).includes("hello/world"), label);
          assert.ok(!String(err.message).includes("https://evil.example"), label);
          assert.ok(!String(err.message).includes("../x"), label);
          return true;
        },
        label,
      );
    }

    const home = path.join(dir, "home");
    const cfgDir = path.join(home, ".skillforge");
    fs.mkdirSync(cfgDir, { recursive: true });
    const cfgPath = path.join(cfgDir, "config.json");
    fs.writeFileSync(cfgPath, "{}\n");
    fs.writeFileSync(path.join(cfgDir, "profile"), "station\n");
    const work = path.join(home, "work");
    fs.mkdirSync(work, { recursive: true });
    assert.equal(findProjectBinding(work, cfgPath), null);

    const proj = path.join(dir, "tree", "proj");
    const deep = path.join(proj, "src", "deep");
    fs.mkdirSync(deep, { recursive: true });
    writeBinding(proj, "station\n");
    const found = findProjectBinding(deep, cfgPath);
    assert.equal(found?.name, "station");
    assert.ok(found?.path.endsWith(path.join(".skillforge", "profile")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("profile binding rejects a symlink to another file", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-bind-filelink-"));
  try {
    const secretBody = "sf_unit_test_secret_token";
    const secret = path.join(dir, "secret.txt");
    fs.writeFileSync(secret, secretBody + "\n");

    const parent = path.join(dir, "tree", "proj");
    const child = path.join(parent, "child");
    fs.mkdirSync(path.join(child, ".skillforge"), { recursive: true });
    writeBinding(parent, "station\n");
    const fileLink = path.join(child, ".skillforge", "profile");
    try {
      fs.symlinkSync(secret, fileLink);
    } catch {
      t.skip("symlink creation needs privileges");
      return;
    }

    const cfgPath = path.join(dir, "cfg", "config.json");
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(cfgPath, "{}\n");

    assert.throws(
      () => parseProfileBinding(fileLink),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.equal(err.code, "profile_binding_invalid");
        assert.ok(String(err.message).includes(fileLink));
        assert.ok(!String(err.message).includes(secretBody));
        return true;
      },
    );
    assert.throws(
      () => findProjectBinding(child, cfgPath),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.equal(err.code, "profile_binding_invalid");
        assert.ok(String(err.message).includes(fileLink));
        assert.ok(!String(err.message).includes(secretBody));
        return true;
      },
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("profile binding rejects a symlinked .skillforge directory", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-bind-dirlink-"));
  try {
    const secretBody = "sf_unit_test_secret_token";
    const realDir = path.join(dir, "real-skillforge");
    fs.mkdirSync(realDir);
    fs.writeFileSync(path.join(realDir, "profile"), secretBody + "\n");

    const parent = path.join(dir, "tree", "proj");
    const child = path.join(parent, "child");
    fs.mkdirSync(child, { recursive: true });
    writeBinding(parent, "station\n");
    const linkDir = path.join(child, ".skillforge");
    try {
      fs.symlinkSync(realDir, linkDir, "dir");
    } catch {
      t.skip("symlink creation needs privileges");
      return;
    }

    const cfgPath = path.join(dir, "cfg", "config.json");
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(cfgPath, "{}\n");

    const filePath = path.join(linkDir, "profile");
    assert.throws(
      () => parseProfileBinding(filePath),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.equal(err.code, "profile_binding_invalid");
        assert.ok(String(err.message).includes(linkDir));
        assert.ok(!String(err.message).includes(secretBody));
        return true;
      },
    );
    assert.throws(
      () => findProjectBinding(child, cfgPath),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.equal(err.code, "profile_binding_invalid");
        assert.ok(String(err.message).includes(linkDir));
        assert.ok(!String(err.message).includes(secretBody));
        return true;
      },
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("checkProfileUrl, logout, doctor and project status honour the profile flag", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-r2-"));
  const work = path.join(dir, "work");
  fs.mkdirSync(work, { recursive: true });
  const cfgPath = path.join(dir, "config.json");
  const filled = {
    registries: {
      admin: { url: PA, token: "tok-admin" },
      other: { url: PB, token: "tok-other" },
    },
    default: "admin",
  };
  const saved = {
    SKILLFORGE_CONFIG: process.env.SKILLFORGE_CONFIG,
    SKILLFORGE_URL: process.env.SKILLFORGE_URL,
    SKILLFORGE_TOKEN: process.env.SKILLFORGE_TOKEN,
    SKILLFORGE_PROFILE: process.env.SKILLFORGE_PROFILE,
    cwd: process.cwd(),
    exitCode: process.exitCode,
  };
  const write = (chunk: unknown, enc?: unknown, cb?: unknown): boolean => {
    if (typeof enc === "function") (enc as () => void)();
    if (typeof cb === "function") (cb as () => void)();
    return true;
  };
  async function capture(
    fn: () => Promise<void>,
  ): Promise<{ stdout: string; stderr: string; exit: number | undefined }> {
    let stdout = "";
    let stderr = "";
    const out = process.stdout.write;
    const err = process.stderr.write;
    const prev = process.exitCode;
    process.stdout.write = ((chunk: unknown, enc?: unknown, cb?: unknown) => {
      stdout += String(chunk);
      return write(chunk, enc, cb);
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: unknown, enc?: unknown, cb?: unknown) => {
      stderr += String(chunk);
      return write(chunk, enc, cb);
    }) as typeof process.stderr.write;
    process.exitCode = undefined;
    try {
      await fn();
      return { stdout, stderr, exit: typeof process.exitCode === "number" ? process.exitCode : 0 };
    } finally {
      process.stdout.write = out;
      process.stderr.write = err;
      process.exitCode = prev;
    }
  }
  try {
    process.env.SKILLFORGE_CONFIG = cfgPath;
    delete process.env.SKILLFORGE_URL;
    delete process.env.SKILLFORGE_TOKEN;
    delete process.env.SKILLFORGE_PROFILE;
    process.chdir(work);

    const other = filled.registries.other;
    checkProfileUrl("other", "flag", other, {});
    checkProfileUrl("other", "flag", other, { url: PB });
    assert.throws(
      () => checkProfileUrl("other", "flag", other, { url: PA }),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.equal(err.code, "profile_url_conflict");
        assert.match(err.message, /other/);
        assert.ok(err.message.includes(PA) && err.message.includes(PB));
        return true;
      },
    );
    process.env.SKILLFORGE_URL = PA;
    assert.throws(
      () => checkProfileUrl("other", "env", other, {}),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.equal(err.code, "profile_url_conflict");
        assert.match(err.message, /SKILLFORGE_URL/);
        return true;
      },
    );
    delete process.env.SKILLFORGE_URL;

    saveConfig({ registries: {} }, cfgPath);
    const empty = await capture(async () => {
      await runLogout(createContext({ noColor: true }));
    });
    assert.equal(empty.exit, 0, empty.stderr);
    assert.match(empty.stdout, /Logged out/);
    assert.doesNotMatch(empty.stderr, /profile_not_found/);
    assert.doesNotMatch(empty.stderr, /\(from none\)/);
    assert.deepEqual(loadConfig(cfgPath).registries, {});

    saveConfig(filled, cfgPath);
    await assert.rejects(
      () => runLogout(createContext({ profile: "ghost", noColor: true })),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.equal(err.code, "profile_not_found");
        assert.match(String((err as ConfigError).message), /ghost/);
        return true;
      },
    );
    await assert.rejects(
      () => runLogout(createContext({ profile: "other", url: PA, noColor: true })),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.equal(err.code, "profile_url_conflict");
        return true;
      },
    );
    assert.equal(loadConfig(cfgPath).registries.other?.token, "tok-other");
    assert.equal(loadConfig(cfgPath).registries.admin?.token, "tok-admin");

    const project = await capture(async () => {
      await runProjectStatus(createContext({ profile: "ghost", json: true, noColor: true }), {});
    });
    assert.match(project.stdout + project.stderr, /profile_not_found/);
    assert.match(project.stdout + project.stderr, /ghost/);

    const doctor = await capture(async () => {
      await runDoctor(createContext({ profile: "ghost", json: true, noColor: true }), {});
    });
    const payload = JSON.parse(doctor.stdout) as {
      ok: boolean;
      checks: { id: string; ok: boolean; message: string; severity?: string }[];
    };
    const cliConfig = payload.checks.find((c) => c.id === "cli_config");
    assert.ok(cliConfig, doctor.stdout);
    assert.equal(cliConfig.ok, false);
    assert.equal(cliConfig.severity, "error");
    assert.match(cliConfig.message, /profile_not_found/);
    assert.match(cliConfig.message, /ghost/);
    assert.ok(payload.checks.some((c) => c.id === "registry_url"));
    assert.ok(payload.checks.some((c) => c.id === "credentials"));
    assert.ok(payload.checks.some((c) => c.id === "server_health"));
    assert.ok(payload.checks.some((c) => c.id === "node_runtime"));
    assert.equal(payload.ok, false);
    assert.equal(doctor.exit, 3);
    assert.doesNotMatch(doctor.stderr, /doctor checklist failed/);

    const conflict = await capture(async () => {
      await runDoctor(createContext({ profile: "other", url: PA, json: true, noColor: true }), {});
    });
    const conflictPayload = JSON.parse(conflict.stdout) as {
      ok: boolean;
      checks: { id: string; ok: boolean; message: string }[];
    };
    const conflictCfg = conflictPayload.checks.find((c) => c.id === "cli_config");
    assert.ok(conflictCfg, conflict.stdout);
    assert.equal(conflictCfg.ok, false);
    assert.match(conflictCfg.message, /profile_url_conflict/);
    assert.equal(conflictPayload.ok, false);
    assert.equal(conflict.exit, 3);
  } finally {
    process.chdir(saved.cwd);
    if (saved.SKILLFORGE_CONFIG === undefined) delete process.env.SKILLFORGE_CONFIG;
    else process.env.SKILLFORGE_CONFIG = saved.SKILLFORGE_CONFIG;
    if (saved.SKILLFORGE_URL === undefined) delete process.env.SKILLFORGE_URL;
    else process.env.SKILLFORGE_URL = saved.SKILLFORGE_URL;
    if (saved.SKILLFORGE_TOKEN === undefined) delete process.env.SKILLFORGE_TOKEN;
    else process.env.SKILLFORGE_TOKEN = saved.SKILLFORGE_TOKEN;
    if (saved.SKILLFORGE_PROFILE === undefined) delete process.env.SKILLFORGE_PROFILE;
    else process.env.SKILLFORGE_PROFILE = saved.SKILLFORGE_PROFILE;
    process.exitCode = saved.exitCode;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
