import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type RegistryEntry = {
  url: string;
  token: string;
  token_id?: string;
  /** release-signing: the registry's key id seen at login; a different key later is refused. */
  signing_key_id?: string;
};

export type SkillforgeConfig = {
  registries: Record<string, RegistryEntry>;
  default?: string;
  /** context-hints: the person agreed that `skillforge suggest` reads file and dependency names. */
  hints_consent?: { accepted_at: string };
};

export function defaultConfigPath(): string {
  const fromEnv = process.env.SKILLFORGE_CONFIG;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return path.join(os.homedir(), ".skillforge", "config.json");
}

export function loadConfig(configPath: string = defaultConfigPath()): SkillforgeConfig {
  try {
    if (!fs.existsSync(configPath)) {
      return { registries: {} };
    }
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as SkillforgeConfig;
    if (!parsed || typeof parsed !== "object") return { registries: {} };
    if (!parsed.registries || typeof parsed.registries !== "object") {
      return { registries: {} };
    }
    return {
      registries: parsed.registries,
      ...(parsed.default !== undefined ? { default: parsed.default } : {}),
      ...(parsed.hints_consent?.accepted_at ? { hints_consent: parsed.hints_consent } : {}),
    };
  } catch {
    return { registries: {} };
  }
}

export function saveConfig(cfg: SkillforgeConfig, configPath: string = defaultConfigPath()): void {
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  const body = `${JSON.stringify(cfg, null, 2)}\n`;
  fs.writeFileSync(configPath, body, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(configPath, 0o600);
  } catch {
    // Windows may ignore mode; login emits a warning.
  }
}

export function entryNameFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  }
}

/** Strip trailing slash; host compared case-insensitively. */
export function normalizeRegistryUrl(url: string): string {
  const stripped = url.replace(/\/+$/, "");
  try {
    const u = new URL(stripped);
    const host = u.hostname.toLowerCase();
    const auth = u.username ? `${u.username}${u.password ? `:${u.password}` : ""}@` : "";
    const port = u.port ? `:${u.port}` : "";
    const pathPart = u.pathname === "/" ? "" : u.pathname.replace(/\/+$/, "");
    const search = u.search ?? "";
    return `${u.protocol}//${auth}${host}${port}${pathPart}${search}`;
  } catch {
    return stripped;
  }
}

function findEntryByUrl(
  cfg: SkillforgeConfig,
  url: string,
): { name: string; entry: RegistryEntry } | undefined {
  const target = normalizeRegistryUrl(url);
  for (const [name, entry] of Object.entries(cfg.registries)) {
    if (normalizeRegistryUrl(entry.url) === target) {
      return { name, entry };
    }
  }
  return undefined;
}

export type ResolvedRegistry = {
  url: string;
  token: string | undefined;
  name: string | undefined;
};

function nonEmpty(v: string | undefined): string | undefined {
  return v && v.length > 0 ? v : undefined;
}

function envOrOpt(opt: string | undefined, envName: string): string | undefined {
  return nonEmpty(opt) ?? nonEmpty(process.env[envName]);
}

/** Resolve registry URL/token for commands (NOT health). */
export function resolveRegistry(opts: {
  url?: string;
  token?: string;
  configPath?: string;
}): ResolvedRegistry | null {
  const cfg = loadConfig(opts.configPath ?? defaultConfigPath());
  const defaultName = cfg.default;
  const defaultEntry = defaultName ? cfg.registries[defaultName] : undefined;

  const url = envOrOpt(opts.url, "SKILLFORGE_URL") ?? defaultEntry?.url;
  if (!url || url.length === 0) return null;

  const normalizedUrl = normalizeRegistryUrl(url);
  const explicitToken = envOrOpt(opts.token, "SKILLFORGE_TOKEN");
  const match = findEntryByUrl(cfg, normalizedUrl);

  return {
    url: normalizedUrl,
    token: explicitToken ?? match?.entry.token,
    name: match?.name ?? defaultName,
  };
}

/** The signing key id remembered at login for this registry address, if any. */
export function storedSigningKeyId(url: string, configPath?: string): string | undefined {
  const cfg = loadConfig(configPath ?? defaultConfigPath());
  return findEntryByUrl(cfg, normalizeRegistryUrl(url))?.entry.signing_key_id;
}

export function upsertRegistry(
  name: string,
  entry: RegistryEntry,
  configPath?: string,
): SkillforgeConfig {
  const p = configPath ?? defaultConfigPath();
  const cfg = loadConfig(p);
  cfg.registries[name] = entry;
  cfg.default = name;
  saveConfig(cfg, p);
  return cfg;
}

export function removeRegistry(name: string | undefined, configPath?: string): SkillforgeConfig {
  const p = configPath ?? defaultConfigPath();
  const cfg = loadConfig(p);
  if (name && cfg.registries[name]) {
    delete cfg.registries[name];
  }
  if (cfg.default === name) {
    const keys = Object.keys(cfg.registries);
    if (keys.length > 0) cfg.default = keys[0];
    else delete cfg.default;
  }
  saveConfig(cfg, p);
  return cfg;
}
