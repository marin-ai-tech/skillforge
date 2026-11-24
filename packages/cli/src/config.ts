import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConfigError } from "./config-error.ts";
import { findProjectBinding } from "./profile-binding.ts";

export type RegistryEntry = {
  url: string;
  /** The regular API token; absent when the entry holds only the MCP token. */
  token?: string;
  token_id?: string;
  /** A token with MCP consent, used only by the stdio bridge (skillforge mcp). */
  mcp_token?: string;
  /** release-signing: the registry's key id seen at login; a different key later is refused. */
  signing_key_id?: string;
};

export type SkillforgeConfig = {
  registries: Record<string, RegistryEntry>;
  default?: string;
  /** context-hints: the person agreed that `skillforge suggest` reads file and dependency names. */
  hints_consent?: { accepted_at: string };
};

export type ProfileSource = "flag" | "env" | "project" | "default" | "url" | "none";

export type ProfileSelection = {
  name: string | undefined;
  source: ProfileSource;
  bindingPath?: string;
};

export type RegistryResolveOpts = {
  url?: string;
  token?: string;
  profile?: string;
  configPath?: string;
  cwd?: string;
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
  return findEntriesByUrl(cfg, url)[0];
}

function findEntriesByUrl(
  cfg: SkillforgeConfig,
  url: string,
): { name: string; entry: RegistryEntry }[] {
  const target = normalizeRegistryUrl(url);
  const matches: { name: string; entry: RegistryEntry }[] = [];
  for (const [name, entry] of Object.entries(cfg.registries)) {
    if (normalizeRegistryUrl(entry.url) === target) matches.push({ name, entry });
  }
  return matches;
}

export type ResolvedRegistry = {
  url: string;
  token: string | undefined;
  name: string | undefined;
  selection?: ProfileSelection;
};

function nonEmpty(v: string | undefined): string | undefined {
  return v && v.length > 0 ? v : undefined;
}

function envOrOpt(opt: string | undefined, envName: string): string | undefined {
  return nonEmpty(opt) ?? nonEmpty(process.env[envName]);
}

type RegistryAddress = {
  url: string;
  name: string | undefined;
  explicitToken: string | undefined;
  entry: RegistryEntry | undefined;
  selection: ProfileSelection;
};

export function isExplicitProfileSource(source: ProfileSource): boolean {
  return source === "flag" || source === "env" || source === "project";
}

/** Steps 1–3 of the selection rule: --profile, SKILLFORGE_PROFILE, then a project binding. */
export function readExplicitProfile(
  opts: { profile?: string; configPath?: string },
  cwd: string = process.cwd(),
): ProfileSelection | null {
  const flag = nonEmpty(opts.profile);
  if (flag) return { name: flag, source: "flag" };
  const fromEnv = nonEmpty(process.env.SKILLFORGE_PROFILE);
  if (fromEnv) return { name: fromEnv, source: "env" };
  const binding = findProjectBinding(cwd, opts.configPath ?? defaultConfigPath());
  if (binding) return { name: binding.name, source: "project", bindingPath: binding.path };
  return null;
}

function profileNames(cfg: SkillforgeConfig): string {
  return Object.keys(cfg.registries).join(", ");
}

export function profileNotFoundError(
  name: string,
  source: ProfileSource,
  configPath: string,
  cfg: SkillforgeConfig,
): ConfigError {
  const names = profileNames(cfg);
  const listed = names.length > 0 ? names : "(none)";
  return new ConfigError(
    "profile_not_found",
    `Profile ${name} (from ${source}) is not in ${configPath}. Profiles: ${listed}. Log in with: skillforge login --profile ${name} --url <base>`,
    3,
  );
}

function ambiguousError(url: string, names: string[]): ConfigError {
  return new ConfigError(
    "profile_ambiguous",
    `Several profiles use ${url}: ${names.join(", ")}. Choose one with --profile, SKILLFORGE_PROFILE or a .skillforge/profile file`,
    3,
    { names },
  );
}

function urlConflictError(
  name: string,
  source: ProfileSource,
  profileUrl: string,
  otherUrl: string,
  urlSource: "--url" | "SKILLFORGE_URL",
): ConfigError {
  return new ConfigError(
    "profile_url_conflict",
    `Profile ${name} (from ${source}) is for ${profileUrl}, but ${urlSource} is ${otherUrl}`,
    1,
  );
}

/** Refuse when an explicit profile's address and --url / SKILLFORGE_URL disagree. */
export function checkProfileUrl(
  name: string,
  source: ProfileSource,
  entry: RegistryEntry,
  opts: { url?: string },
): void {
  const profileUrl = normalizeRegistryUrl(entry.url);
  const urlFromFlag = nonEmpty(opts.url);
  const urlFromEnv = nonEmpty(process.env.SKILLFORGE_URL);
  const urlOpt = urlFromFlag ?? urlFromEnv;
  if (!urlOpt) return;
  const other = normalizeRegistryUrl(urlOpt);
  if (other !== profileUrl) {
    throw urlConflictError(
      name,
      source,
      profileUrl,
      other,
      urlFromFlag ? "--url" : "SKILLFORGE_URL",
    );
  }
}

function selectionFromUrl(cfg: SkillforgeConfig, url: string): ProfileSelection {
  const matches = findEntriesByUrl(cfg, url);
  const [only] = matches;
  if (matches.length === 1 && only) return { name: only.name, source: "url" };
  if (matches.length > 1) {
    const names = matches.map((m) => m.name);
    if (cfg.default && names.includes(cfg.default)) {
      return { name: cfg.default, source: "default" };
    }
    throw ambiguousError(normalizeRegistryUrl(url), names);
  }
  return { name: undefined, source: "none" };
}

export function selectProfile(
  opts: RegistryResolveOpts,
  cfg: SkillforgeConfig,
  cwd: string = process.cwd(),
): ProfileSelection {
  const explicit = readExplicitProfile(opts, cwd);
  if (explicit) return explicit;
  const url = envOrOpt(opts.url, "SKILLFORGE_URL");
  if (url) return selectionFromUrl(cfg, url);
  if (cfg.default && cfg.registries[cfg.default]) {
    return { name: cfg.default, source: "default" };
  }
  return { name: undefined, source: "none" };
}

function warnIgnoredEnvToken(name: string, source: ProfileSource): void {
  if (nonEmpty(process.env.SKILLFORGE_TOKEN)) {
    process.stderr.write(`SKILLFORGE_TOKEN is ignored: profile ${name} is selected by ${source}\n`);
  }
}

function resolveExplicit(
  opts: RegistryResolveOpts,
  cfg: SkillforgeConfig,
  selected: ProfileSelection,
  configPath: string,
): RegistryAddress {
  const name = selected.name;
  if (!name || !cfg.registries[name]) {
    throw profileNotFoundError(name ?? "", selected.source, configPath, cfg);
  }
  const entry = cfg.registries[name];
  checkProfileUrl(name, selected.source, entry, opts);
  const profileUrl = normalizeRegistryUrl(entry.url);
  warnIgnoredEnvToken(name, selected.source);
  return {
    url: profileUrl,
    name,
    explicitToken: nonEmpty(opts.token),
    entry,
    selection: selected,
  };
}

function resolveImplicit(
  opts: RegistryResolveOpts,
  cfg: SkillforgeConfig,
  selected: ProfileSelection,
): RegistryAddress | null {
  const defaultName = cfg.default;
  const defaultEntry = defaultName ? cfg.registries[defaultName] : undefined;
  const selectedEntry = selected.name ? cfg.registries[selected.name] : undefined;
  const url = envOrOpt(opts.url, "SKILLFORGE_URL") ?? selectedEntry?.url ?? defaultEntry?.url;
  if (!url || url.length === 0) return null;
  const normalizedUrl = normalizeRegistryUrl(url);
  const matchName = selected.name ?? findEntriesByUrl(cfg, normalizedUrl)[0]?.name;
  const matchEntry = matchName ? cfg.registries[matchName] : undefined;
  return {
    url: normalizedUrl,
    name: matchName ?? defaultName,
    explicitToken: envOrOpt(opts.token, "SKILLFORGE_TOKEN"),
    entry: matchEntry,
    selection: selected.name ? selected : { ...selected, name: defaultName },
  };
}

function resolveRegistryAddress(opts: RegistryResolveOpts): RegistryAddress | null {
  const configPath = opts.configPath ?? defaultConfigPath();
  const cfg = loadConfig(configPath);
  const selected = selectProfile(opts, cfg, opts.cwd ?? process.cwd());
  if (isExplicitProfileSource(selected.source)) {
    return resolveExplicit(opts, cfg, selected, configPath);
  }
  return resolveImplicit(opts, cfg, selected);
}

/** Resolve registry URL/token for commands (NOT health). */
export function resolveRegistry(opts: RegistryResolveOpts): ResolvedRegistry | null {
  const resolved = resolveRegistryAddress(opts);
  if (!resolved) return null;
  return {
    url: resolved.url,
    token: resolved.explicitToken ?? resolved.entry?.token,
    name: resolved.name,
    selection: resolved.selection,
  };
}

/**
 * Resolve registry URL/token for the stdio bridge only:
 * --token, then (unless a profile is explicit) SKILLFORGE_TOKEN, then mcp_token of the
 * entry with the same url, then its token.
 */
export function resolveBridgeToken(opts: RegistryResolveOpts): ResolvedRegistry | null {
  const resolved = resolveRegistryAddress(opts);
  if (!resolved) return null;
  return {
    url: resolved.url,
    token:
      resolved.explicitToken ??
      nonEmpty(resolved.entry?.mcp_token) ??
      nonEmpty(resolved.entry?.token),
    name: resolved.name,
    selection: resolved.selection,
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
  options?: { setDefault?: boolean },
): SkillforgeConfig {
  const p = configPath ?? defaultConfigPath();
  const cfg = loadConfig(p);
  const previous = cfg.registries[name];
  // The MCP token belongs to its host: keep it only when the entry keeps the same address.
  const keepMcp =
    entry.mcp_token === undefined &&
    previous?.mcp_token !== undefined &&
    normalizeRegistryUrl(previous.url) === normalizeRegistryUrl(entry.url);
  cfg.registries[name] = keepMcp ? { ...entry, mcp_token: previous.mcp_token } : entry;
  if (options?.setDefault ?? true) cfg.default = name;
  saveConfig(cfg, p);
  return cfg;
}

/**
 * Save an MCP token for the entry with this url (or the named entry), keeping its regular token.
 * Creates the entry when missing. setDefault (default true) makes it the default like any login.
 * Returns the entry name.
 */
export function saveMcpToken(
  url: string,
  mcpToken: string,
  name?: string,
  configPath?: string,
  options?: { setDefault?: boolean },
): string {
  const p = configPath ?? defaultConfigPath();
  const cfg = loadConfig(p);
  const target = normalizeRegistryUrl(url);
  const entryName =
    name && name.length > 0 ? name : (findEntryByUrl(cfg, target)?.name ?? entryNameFromUrl(url));
  const previous = cfg.registries[entryName];
  const sameHost = previous !== undefined && normalizeRegistryUrl(previous.url) === target;
  cfg.registries[entryName] = sameHost
    ? { ...previous, mcp_token: mcpToken }
    : { url, mcp_token: mcpToken };
  if (options?.setDefault ?? true) cfg.default = entryName;
  saveConfig(cfg, p);
  return entryName;
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
