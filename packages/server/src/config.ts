import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LdapProviderConfig } from "./auth/ldap/types.ts";
import { resolveMarketplaceSource, type MarketplaceSource } from "./distribution/source-mode.ts";
export type { LdapProviderConfig };

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_SESSION_TTL_DAYS = 30;
const DEFAULT_AGING_DAYS = 90;
const DEFAULT_CANDIDATE_TTL_DAYS = 30;
const DEFAULT_IMPORT_TTL_MINUTES = 15;
const DEFAULT_RUN_OUTPUT_RETENTION_DAYS = 30;
const DEFAULT_RUN_OUTPUT_MAX_BYTES = 1024 * 1024;

/**
 * SKILLFORGE_DOWNLOADS_DIR (release-dist): files the registry hands out at /downloads (the CLI package). Default: the
 * `downloads` folder of the installation root (packages/server/dist → ../../../downloads).
 */
function parseDownloadsDir(raw: string | undefined): string {
  if (raw && raw.trim()) return path.resolve(raw.trim());
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../downloads");
}

function defaultWebDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../web/dist");
}

const envSchema = z.object({
  SKILLFORGE_PORT: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === "") return DEFAULT_PORT;
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) {
        ctx.addIssue({
          code: "custom",
          message: "Invalid SKILLFORGE_PORT",
          path: ["SKILLFORGE_PORT"],
        });
        return z.NEVER;
      }
      return n;
    }),
  SKILLFORGE_HOST: z.string().optional().default(DEFAULT_HOST),
  SKILLFORGE_DATA_DIR: z.string().optional().default("./data"),
  SKILLFORGE_BASE_URL: z.string().optional(),
  SKILLFORGE_WEB_DIR: z.string().optional(),
  SKILLFORGE_ADMIN_PASSWORD: z.string().optional(),
  SKILLFORGE_PUBLIC_READ: z.string().optional(),
  SKILLFORGE_SESSION_TTL_DAYS: z.string().optional(),
  SKILLFORGE_AGING_DAYS: z.string().optional(),
  SKILLFORGE_CANDIDATE_TTL_DAYS: z.string().optional(),
});

export type AuthMode = "password" | "local";

export type OidcProviderConfig = {
  id: string;
  label: string;
  issuer: string;
  client_id: string;
  client_secret: string;
  scopes: string;
  role_claim: string | null;
  role_map: Record<string, string> | null;
  default_role: string;
};

export type AppConfig = {
  port: number;
  host: string;
  dataDir: string;
  baseUrl: string;
  webDir: string;
  adminPassword: string | null;
  publicRead: boolean;
  sessionTtlDays: number;
  agingDays: number;
  candidateTtlDays: number;
  dataLifecycleEnabled: boolean;
  zombieIdleDays: number;
  zombieWindowDays: number;
  zombieMinUses: number;
  zombieMinReporters: number;
  zombieTransferRate: number;
  zombieRetireDays: number;
  ablationMinTasks: number;
  reviveWindowDays: number;
  reviveMinEvents: number;
  lifecycleMaxPerSweep: number;
  importGit: boolean;
  importAllowFileUrls: boolean;
  importTtlMinutes: number;
  marketplaceName: string;
  marketplaceOwner: string;
  /** SKILLFORGE_MARKETPLACE_SOURCE resolved against baseUrl: how marketplace.json points at plugins. */
  marketplaceSource: MarketplaceSource;
  backupKeep: number;
  pluginsDir: string;
  /** upstream-mirror: hours between background checks of every mirror; 0 turns them off. */
  mirrorIntervalHours: number;
  /** Plugins that ship with a release (llm-skill-validation); null when there is none or it is turned off. */
  bundledPluginsDir: string | null;
  pluginsDisabled: boolean;
  agentRoots: string[];
  starterPacksDir: string;
  authMode: AuthMode;
  publicUrl: string | null;
  oidcProviders: OidcProviderConfig[];
  ldapProviders: LdapProviderConfig[];
  evalRunnersFile: string | null;
  evalConcurrency: number;
  evalMaxRunsPerDay: number;
  evalAblationAuto: boolean;
  /** SKILLFORGE_RUN_OUTPUT_RETENTION_DAYS (default 30, 0 = keep forever). */
  runOutputRetentionDays: number;
  /** SKILLFORGE_RUN_OUTPUT_MAX_BYTES (default 1 MiB per stored stream). */
  runOutputMaxBytes: number;
  /** SKILLFORGE_ORCHESTRATION_ENABLED (default false): workflows/routines/hooks-runtime API + scheduler. */
  orchestrationEnabled: boolean;
  /** SKILLFORGE_ROUTINES_DISABLED (default false): no new scheduled routine fires. Parsed at startup. */
  routinesDisabled: boolean;
  /** SKILLFORGE_HOOKS_DISABLED (default false): hook evaluation answers allow without executing. Parsed at startup. */
  hooksDisabled: boolean;
  /** Production error mode (500 hides internals): NODE_ENV=production or SKILLFORGE_SAFE_ERRORS true. */
  safeErrors: boolean;
  /** SKILLFORGE_LLM_API_KEY (llm-help-assistant): LLM API key; only from the environment, never stored or returned. */
  llmApiKey: string | null;
  /** SKILLFORGE_LLM_KEY_ORIGINS: origins (scheme://host[:port]) the key may be sent to; empty = never sent. */
  llmKeyOrigins: string[];
  /**
   * SKILLFORGE_BUDGET_SOCKET (llm-budget-broker): absolute path of the Agent Space budget broker's Unix socket. When set,
   * every model call goes through it and never to the provider directly; null = no broker.
   */
  budgetSocket: string | null;
  /** SKILLFORGE_GITHUB_TOKEN (pr-rollout): only from the environment, sent only to githubApiUrl, never returned. */
  githubToken: string | null;
  /** SKILLFORGE_GITHUB_API_URL: GitHub REST API, default https://api.github.com; http only for loopback. */
  githubApiUrl: string;
  /** release-dist: folder with the CLI package served at /downloads. */
  downloadsDir: string;
};

export class ConfigError extends Error {
  variable: string;
  constructor(variable: string) {
    super(`Invalid configuration: ${variable}`);
    this.variable = variable;
  }
}

function parseSessionTtlDays(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_SESSION_TTL_DAYS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 365) {
    throw new ConfigError("SKILLFORGE_SESSION_TTL_DAYS");
  }
  return n;
}

function parseNonNegIntDays(raw: string | undefined, fallback: number, variable: string): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new ConfigError(variable);
  }
  return n;
}

function parseAdminPassword(raw: string | undefined): string | null {
  if (raw === undefined || raw === "") return null;
  return raw;
}

/**
 * The single rule for every boolean SKILLFORGE_* variable: "true"|"1" → true, "false"|"0" → false,
 * empty/unset → fallback, anything else → ConfigError(variable) (startup refused).
 */
function parseBoolEnv(raw: string | undefined, fallback: boolean, variable: string): boolean {
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new ConfigError(variable);
}

/**
 * Production error mode: NODE_ENV=production or SKILLFORGE_SAFE_ERRORS true. The flag is parsed
 * even under production so an invalid value always refuses startup.
 */
function parseSafeErrors(env: NodeJS.ProcessEnv): boolean {
  const flag = parseBoolEnv(env.SKILLFORGE_SAFE_ERRORS, false, "SKILLFORGE_SAFE_ERRORS");
  return env.NODE_ENV === "production" || flag;
}

function parseImportTtlMinutes(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_IMPORT_TTL_MINUTES;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 120) {
    throw new ConfigError("SKILLFORGE_IMPORT_TTL_MINUTES");
  }
  return n;
}

const MARKETPLACE_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function parseMarketplaceName(raw: string | undefined): string {
  if (raw === undefined || raw === "") return "skillforge";
  if (raw.length < 1 || raw.length > 64 || !MARKETPLACE_NAME_RE.test(raw)) {
    throw new ConfigError("SKILLFORGE_MARKETPLACE_NAME");
  }
  return raw;
}

function parseMarketplaceOwner(raw: string | undefined): string {
  if (raw === undefined || raw === "") return "SkillForge";
  if (raw.length < 1 || raw.length > 120) {
    throw new ConfigError("SKILLFORGE_MARKETPLACE_OWNER");
  }
  return raw;
}

function parseMarketplaceSource(raw: string | undefined, baseUrl: string): MarketplaceSource {
  const source = resolveMarketplaceSource(raw, baseUrl);
  if (!source) throw new ConfigError("SKILLFORGE_MARKETPLACE_SOURCE");
  return source;
}

function parseBackupKeep(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 10;
  if (!/^\d+$/.test(raw)) {
    throw new ConfigError("SKILLFORGE_BACKUP_KEEP");
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new ConfigError("SKILLFORGE_BACKUP_KEEP");
  }
  return n;
}

function parsePluginsDir(raw: string | undefined, dataDir: string): string {
  if (raw === undefined || raw === "") return path.join(dataDir, "plugins");
  return path.resolve(raw);
}

function parseMirrorInterval(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 24;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 24 * 30)
    throw new ConfigError("SKILLFORGE_MIRROR_INTERVAL_HOURS");
  return n;
}

/** Default: next to dist, a folder only release builds have. An empty value turns it off. */
function parseBundledPluginsDir(raw: string | undefined): string | null {
  if (raw === "") return null;
  if (raw !== undefined) return path.resolve(raw);
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../bundled-plugins");
}

function parseAgentRoots(raw: string | undefined): string[] {
  if (raw === undefined || raw === "") return [];
  const parts: string[] = [];
  for (const semi of raw.split(";")) {
    const fragment = semi.trim();
    if (!fragment) continue;
    // Chained Windows roots: C:\a:D:\b — split before each new drive path.
    if (/[A-Za-z]:[\\/]/.test(fragment) && /:[A-Za-z]:[\\/]/.test(fragment)) {
      for (const p of fragment.split(/:(?=[A-Za-z]:[\\/])/)) {
        const t = p.trim();
        if (t) parts.push(t);
      }
      continue;
    }
    // Single Windows root X:\... or X:/... — do not split on the drive colon.
    if (/^[A-Za-z]:[\\/]/.test(fragment)) {
      parts.push(fragment);
      continue;
    }
    for (const colon of fragment.split(":")) {
      const p = colon.trim();
      if (p) parts.push(p);
    }
  }
  const roots: string[] = [];
  for (const p of parts) {
    const resolved = path.resolve(p);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new ConfigError("SKILLFORGE_AGENT_ROOTS");
    }
    roots.push(resolved);
  }
  return roots;
}
function defaultStarterPacksDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../starter-packs");
}

function parseStarterPacksDir(raw: string | undefined): string {
  if (raw === undefined || raw === "") return defaultStarterPacksDir();
  return path.resolve(raw);
}

const OIDC_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const OIDC_ROLES = new Set(["viewer", "contributor", "reviewer", "admin"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

function parseAuthMode(raw: string | undefined): AuthMode {
  if (raw === undefined || raw === "") return "password";
  if (raw === "password" || raw === "local") return raw;
  throw new ConfigError("SKILLFORGE_AUTH_MODE");
}

function parsePublicUrl(raw: string | undefined): string | null {
  if (raw === undefined || raw === "") return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new ConfigError("SKILLFORGE_PUBLIC_URL");
    }
    return raw.replace(/\/+$/, "");
  } catch (e) {
    if (e instanceof ConfigError) throw e;
    throw new ConfigError("SKILLFORGE_PUBLIC_URL");
  }
}

function parseRoleMap(raw: unknown, variable: string): Record<string, string> | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigError(variable);
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== "string" || !OIDC_ROLES.has(v)) {
      throw new ConfigError(variable);
    }
    out[k] = v;
  }
  return out;
}

function providerObject(raw: unknown, variable: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ConfigError(variable);
  }
  return raw as Record<string, unknown>;
}

function stringField(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  return typeof v === "string" ? v : "";
}

function requiredStringField(o: Record<string, unknown>, key: string, variable: string): string {
  const v = stringField(o, key);
  if (!v) throw new ConfigError(variable);
  return v;
}

function providerId(o: Record<string, unknown>, variable: string): string {
  const id = stringField(o, "id");
  if (!OIDC_ID_RE.test(id)) throw new ConfigError(variable);
  return id;
}

function nonEmptyStringOr<T extends string | null>(
  o: Record<string, unknown>,
  key: string,
  fallback: T,
): string | T {
  const v = o[key];
  return typeof v === "string" && v ? v : fallback;
}

function parseDefaultRole(raw: unknown, variable: string): string {
  if (raw === undefined) return "viewer";
  if (typeof raw !== "string" || !OIDC_ROLES.has(raw)) {
    throw new ConfigError(variable);
  }
  return raw;
}

function parseOneProvider(raw: unknown, variable: string): OidcProviderConfig {
  const o = providerObject(raw, variable);
  const id = providerId(o, variable);
  const label = requiredStringField(o, "label", variable);
  const issuer = requiredStringField(o, "issuer", variable);
  const client_id = requiredStringField(o, "client_id", variable);
  const client_secret = requiredStringField(o, "client_secret", variable);
  const scopes =
    typeof o.scopes === "string" && o.scopes.trim() ? o.scopes.trim() : "openid email profile";
  const role_claim = typeof o.role_claim === "string" ? o.role_claim : null;
  const role_map = parseRoleMap(o.role_map, variable);
  const default_role = parseDefaultRole(o.default_role, variable);
  return {
    id,
    label,
    issuer,
    client_id,
    client_secret,
    scopes,
    role_claim,
    role_map,
    default_role,
  };
}

function parseOidcProvidersJson(rawJson: string | undefined): OidcProviderConfig[] {
  const providers: OidcProviderConfig[] = [];
  if (rawJson === undefined || rawJson === "") return providers;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new ConfigError("SKILLFORGE_OIDC_PROVIDERS");
  }
  if (!Array.isArray(parsed)) throw new ConfigError("SKILLFORGE_OIDC_PROVIDERS");
  const seen = new Set<string>();
  for (const item of parsed) {
    const p = parseOneProvider(item, "SKILLFORGE_OIDC_PROVIDERS");
    if (seen.has(p.id)) throw new ConfigError("SKILLFORGE_OIDC_PROVIDERS");
    seen.add(p.id);
    providers.push(p);
  }
  return providers;
}

/** Google shortcut: both SKILLFORGE_GOOGLE_CLIENT_ID and _SECRET or neither. */
function parseGoogleProvider(env: NodeJS.ProcessEnv): OidcProviderConfig | null {
  const gId = env.SKILLFORGE_GOOGLE_CLIENT_ID;
  const gSecret = env.SKILLFORGE_GOOGLE_CLIENT_SECRET;
  const gIdSet = gId !== undefined && gId !== "";
  const gSecretSet = gSecret !== undefined && gSecret !== "";
  if (gIdSet !== gSecretSet) {
    throw new ConfigError(
      gIdSet ? "SKILLFORGE_GOOGLE_CLIENT_SECRET" : "SKILLFORGE_GOOGLE_CLIENT_ID",
    );
  }
  if (!gIdSet || !gSecretSet) return null;
  return {
    id: "google",
    label: "Google",
    issuer: "https://accounts.google.com",
    client_id: gId!,
    client_secret: gSecret!,
    scopes: "openid email profile",
    role_claim: null,
    role_map: null,
    default_role: "viewer",
  };
}

function parseOidcProviders(env: NodeJS.ProcessEnv): OidcProviderConfig[] {
  const authMode = parseAuthMode(env.SKILLFORGE_AUTH_MODE);
  if (authMode === "local") {
    return [];
  }

  const providers = parseOidcProvidersJson(env.SKILLFORGE_OIDC_PROVIDERS);
  const google = parseGoogleProvider(env);
  if (google) {
    if (providers.some((p) => p.id === "google")) {
      throw new ConfigError("SKILLFORGE_OIDC_PROVIDERS");
    }
    providers.push(google);
  }

  if (providers.length > 0) {
    const publicUrl = parsePublicUrl(env.SKILLFORGE_PUBLIC_URL);
    if (!publicUrl) throw new ConfigError("SKILLFORGE_PUBLIC_URL");
  }

  return providers;
}

function parseLdapTimeoutMs(raw: unknown, variable: string): number {
  if (raw === undefined) return 5000;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
    throw new ConfigError(variable);
  }
  return raw;
}

function parseOneLdapProvider(raw: unknown, variable: string): LdapProviderConfig {
  const o = providerObject(raw, variable);
  const id = providerId(o, variable);
  const label = requiredStringField(o, "label", variable);
  const url = stringField(o, "url");
  if (!url.startsWith("ldap://") && !url.startsWith("ldaps://")) {
    throw new ConfigError(variable);
  }
  const bind_dn = requiredStringField(o, "bind_dn", variable);
  const bind_password = requiredStringField(o, "bind_password", variable);
  const user_base = requiredStringField(o, "user_base", variable);
  const user_filter = stringField(o, "user_filter");
  if (!user_filter || !user_filter.includes("{username}")) {
    throw new ConfigError(variable);
  }
  const username_attribute = nonEmptyStringOr(o, "username_attribute", "uid");
  const display_name_attribute = nonEmptyStringOr(o, "display_name_attribute", null);
  const email_attribute = nonEmptyStringOr(o, "email_attribute", null);
  const group_attribute = nonEmptyStringOr(o, "group_attribute", "memberOf");
  const role_map = parseRoleMap(o.role_map, variable);
  const default_role = parseDefaultRole(o.default_role, variable);
  const timeout_ms = parseLdapTimeoutMs(o.timeout_ms, variable);
  const tls_ca_file = nonEmptyStringOr(o, "tls_ca_file", null);
  return {
    id,
    label,
    url,
    bind_dn,
    bind_password,
    user_base,
    user_filter,
    username_attribute,
    display_name_attribute,
    email_attribute,
    group_attribute,
    role_map,
    default_role,
    timeout_ms,
    tls_ca_file,
  };
}

function parseLdapProviders(
  env: NodeJS.ProcessEnv,
  reservedIds: Set<string>,
): LdapProviderConfig[] {
  const authMode = parseAuthMode(env.SKILLFORGE_AUTH_MODE);
  if (authMode === "local") {
    return [];
  }

  const rawJson = env.SKILLFORGE_LDAP;
  if (rawJson === undefined || rawJson === "") {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new ConfigError("SKILLFORGE_LDAP");
  }
  if (!Array.isArray(parsed)) throw new ConfigError("SKILLFORGE_LDAP");

  const providers: LdapProviderConfig[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    const p = parseOneLdapProvider(item, "SKILLFORGE_LDAP");
    if (seen.has(p.id) || reservedIds.has(p.id)) {
      throw new ConfigError("SKILLFORGE_LDAP");
    }
    seen.add(p.id);
    providers.push(p);
  }
  return providers;
}

function parseDataLifecycle(raw: string | undefined): boolean {
  if (raw === undefined || raw === "") return true;
  if (raw === "on") return true;
  if (raw === "off") return false;
  throw new ConfigError("SKILLFORGE_DATA_LIFECYCLE");
}

function parsePosInt(raw: string | undefined, fallback: number, variable: string, min = 1): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    throw new ConfigError(variable);
  }
  return n;
}

function parseTransferRate(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 0.2;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new ConfigError("SKILLFORGE_ZOMBIE_TRANSFER_RATE");
  }
  return n;
}

function parseEvalRunnersFile(raw: string | undefined): string | null {
  if (raw === undefined || raw === "") return null;
  return path.resolve(raw);
}

function parseEvalConcurrency(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 2;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 8) {
    throw new ConfigError("SKILLFORGE_EVAL_CONCURRENCY");
  }
  return n;
}

function parseEvalMaxRunsPerDay(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 20;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new ConfigError("SKILLFORGE_EVAL_MAX_RUNS_PER_DAY");
  }
  return n;
}
function assertLocalModeHost(authMode: AuthMode, host: string): void {
  if (authMode !== "local") return;
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new ConfigError("SKILLFORGE_AUTH_MODE");
  }
}
/** SKILLFORGE_LLM_KEY_ORIGINS: comma-separated http(s) origins; anything else is a startup error. */
export function parseLlmKeyOrigins(raw: string | undefined): string[] {
  const out: string[] = [];
  for (const item of (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    let url: URL;
    try {
      url = new URL(item);
    } catch {
      throw new ConfigError("SKILLFORGE_LLM_KEY_ORIGINS");
    }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      throw new ConfigError("SKILLFORGE_LLM_KEY_ORIGINS");
    }
    out.push(url.origin);
  }
  return out;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** GitHub token and API address (pr-rollout): the address is the operator's, never a request's. */
function parseGitHubEnv(env: NodeJS.ProcessEnv): Pick<AppConfig, "githubToken" | "githubApiUrl"> {
  const raw = env.SKILLFORGE_GITHUB_API_URL?.trim() || "https://api.github.com";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError("SKILLFORGE_GITHUB_API_URL");
  }
  const secure =
    url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
  if (!secure || url.username || url.password || url.search || url.hash) {
    throw new ConfigError("SKILLFORGE_GITHUB_API_URL");
  }
  return {
    githubToken: env.SKILLFORGE_GITHUB_TOKEN?.trim() || null,
    githubApiUrl: url.toString().replace(/\/+$/, ""),
  };
}

/** SKILLFORGE_BUDGET_SOCKET: empty = no broker; otherwise an absolute path without NUL, else a startup error. */
export function parseBudgetSocket(raw: string | undefined): string | null {
  const value = raw?.trim() ?? "";
  if (value === "") return null;
  if (!path.isAbsolute(value) || value.includes(String.fromCharCode(0)))
    throw new ConfigError("SKILLFORGE_BUDGET_SOCKET");
  return value;
}

/** LLM key, the origins it may be sent to and the budget broker. */
function parseLlmEnv(
  env: NodeJS.ProcessEnv,
): Pick<AppConfig, "llmApiKey" | "llmKeyOrigins" | "budgetSocket"> {
  return {
    llmApiKey: env.SKILLFORGE_LLM_API_KEY?.trim() || null,
    llmKeyOrigins: parseLlmKeyOrigins(env.SKILLFORGE_LLM_KEY_ORIGINS),
    budgetSocket: parseBudgetSocket(env.SKILLFORGE_BUDGET_SOCKET),
  };
}

export function parseConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse({
    SKILLFORGE_PORT: env.SKILLFORGE_PORT,
    SKILLFORGE_HOST: env.SKILLFORGE_HOST,
    SKILLFORGE_DATA_DIR: env.SKILLFORGE_DATA_DIR,
    SKILLFORGE_BASE_URL: env.SKILLFORGE_BASE_URL,
    SKILLFORGE_WEB_DIR: env.SKILLFORGE_WEB_DIR,
    SKILLFORGE_ADMIN_PASSWORD: env.SKILLFORGE_ADMIN_PASSWORD,
    SKILLFORGE_PUBLIC_READ: env.SKILLFORGE_PUBLIC_READ,
    SKILLFORGE_SESSION_TTL_DAYS: env.SKILLFORGE_SESSION_TTL_DAYS,
    SKILLFORGE_AGING_DAYS: env.SKILLFORGE_AGING_DAYS,
    SKILLFORGE_CANDIDATE_TTL_DAYS: env.SKILLFORGE_CANDIDATE_TTL_DAYS,
  });

  if (!parsed.success) {
    let failed = "SKILLFORGE_PORT";
    for (const issue of parsed.error.issues) {
      const p = issue.path[0];
      if (typeof p === "string" && p.startsWith("SKILLFORGE_")) {
        failed = p;
        break;
      }
      if (issue.message.includes("SKILLFORGE_PORT")) {
        failed = "SKILLFORGE_PORT";
        break;
      }
    }
    throw new ConfigError(failed);
  }

  let publicRead: boolean;
  let sessionTtlDays: number;
  let adminPassword: string | null;
  let agingDays: number;
  let candidateTtlDays: number;
  let dataLifecycleEnabled: boolean;
  let zombieIdleDays: number;
  let zombieWindowDays: number;
  let zombieMinUses: number;
  let zombieMinReporters: number;
  let zombieTransferRate: number;
  let zombieRetireDays: number;
  let ablationMinTasks: number;
  let reviveWindowDays: number;
  let reviveMinEvents: number;
  let lifecycleMaxPerSweep: number;
  let importGit: boolean;
  let importAllowFileUrls: boolean;
  let importTtlMinutes: number;
  let marketplaceName: string;
  let marketplaceOwner: string;
  let backupKeep: number;
  let pluginsDisabled: boolean;
  let agentRoots: string[];
  let evalRunnersFile: string | null;
  let evalConcurrency: number;
  let evalMaxRunsPerDay: number;
  let evalAblationAuto: boolean;
  let runOutputRetentionDays: number;
  let runOutputMaxBytes: number;
  let orchestrationEnabled: boolean;
  let routinesDisabled: boolean;
  let hooksDisabled: boolean;
  let safeErrors: boolean;
  try {
    publicRead = parseBoolEnv(parsed.data.SKILLFORGE_PUBLIC_READ, true, "SKILLFORGE_PUBLIC_READ");
    sessionTtlDays = parseSessionTtlDays(parsed.data.SKILLFORGE_SESSION_TTL_DAYS);
    adminPassword = parseAdminPassword(parsed.data.SKILLFORGE_ADMIN_PASSWORD);
    agingDays = parseNonNegIntDays(
      parsed.data.SKILLFORGE_AGING_DAYS,
      DEFAULT_AGING_DAYS,
      "SKILLFORGE_AGING_DAYS",
    );
    candidateTtlDays = parseNonNegIntDays(
      parsed.data.SKILLFORGE_CANDIDATE_TTL_DAYS,
      DEFAULT_CANDIDATE_TTL_DAYS,
      "SKILLFORGE_CANDIDATE_TTL_DAYS",
    );
    dataLifecycleEnabled = parseDataLifecycle(env.SKILLFORGE_DATA_LIFECYCLE);
    zombieIdleDays = parseNonNegIntDays(
      env.SKILLFORGE_ZOMBIE_IDLE_DAYS,
      180,
      "SKILLFORGE_ZOMBIE_IDLE_DAYS",
    );
    zombieWindowDays = parsePosInt(
      env.SKILLFORGE_ZOMBIE_WINDOW_DAYS,
      60,
      "SKILLFORGE_ZOMBIE_WINDOW_DAYS",
    );
    zombieMinUses = parsePosInt(env.SKILLFORGE_ZOMBIE_MIN_USES, 20, "SKILLFORGE_ZOMBIE_MIN_USES");
    zombieMinReporters = parsePosInt(
      env.SKILLFORGE_ZOMBIE_MIN_REPORTERS,
      3,
      "SKILLFORGE_ZOMBIE_MIN_REPORTERS",
    );
    zombieTransferRate = parseTransferRate(env.SKILLFORGE_ZOMBIE_TRANSFER_RATE);
    zombieRetireDays = parseNonNegIntDays(
      env.SKILLFORGE_ZOMBIE_RETIRE_DAYS,
      30,
      "SKILLFORGE_ZOMBIE_RETIRE_DAYS",
    );
    ablationMinTasks = parsePosInt(
      env.SKILLFORGE_ABLATION_MIN_TASKS,
      10,
      "SKILLFORGE_ABLATION_MIN_TASKS",
    );
    reviveWindowDays = parsePosInt(
      env.SKILLFORGE_REVIVE_WINDOW_DAYS,
      14,
      "SKILLFORGE_REVIVE_WINDOW_DAYS",
    );
    reviveMinEvents = parsePosInt(
      env.SKILLFORGE_REVIVE_MIN_EVENTS,
      3,
      "SKILLFORGE_REVIVE_MIN_EVENTS",
    );
    lifecycleMaxPerSweep = parsePosInt(
      env.SKILLFORGE_LIFECYCLE_MAX_PER_SWEEP,
      20,
      "SKILLFORGE_LIFECYCLE_MAX_PER_SWEEP",
    );
    importGit = parseBoolEnv(env.SKILLFORGE_IMPORT_GIT, true, "SKILLFORGE_IMPORT_GIT");
    importAllowFileUrls = parseBoolEnv(
      env.SKILLFORGE_IMPORT_ALLOW_FILE_URLS,
      false,
      "SKILLFORGE_IMPORT_ALLOW_FILE_URLS",
    );
    importTtlMinutes = parseImportTtlMinutes(env.SKILLFORGE_IMPORT_TTL_MINUTES);
    marketplaceName = parseMarketplaceName(env.SKILLFORGE_MARKETPLACE_NAME);
    marketplaceOwner = parseMarketplaceOwner(env.SKILLFORGE_MARKETPLACE_OWNER);
    backupKeep = parseBackupKeep(env.SKILLFORGE_BACKUP_KEEP);
    pluginsDisabled = parseBoolEnv(
      env.SKILLFORGE_PLUGINS_DISABLED,
      false,
      "SKILLFORGE_PLUGINS_DISABLED",
    );
    agentRoots = parseAgentRoots(env.SKILLFORGE_AGENT_ROOTS);
    evalRunnersFile = parseEvalRunnersFile(env.SKILLFORGE_EVAL_RUNNERS_FILE);
    evalConcurrency = parseEvalConcurrency(env.SKILLFORGE_EVAL_CONCURRENCY);
    evalMaxRunsPerDay = parseEvalMaxRunsPerDay(env.SKILLFORGE_EVAL_MAX_RUNS_PER_DAY);
    evalAblationAuto = parseBoolEnv(
      env.SKILLFORGE_EVAL_ABLATION_AUTO,
      false,
      "SKILLFORGE_EVAL_ABLATION_AUTO",
    );
    runOutputRetentionDays = parseNonNegIntDays(
      env.SKILLFORGE_RUN_OUTPUT_RETENTION_DAYS,
      DEFAULT_RUN_OUTPUT_RETENTION_DAYS,
      "SKILLFORGE_RUN_OUTPUT_RETENTION_DAYS",
    );
    runOutputMaxBytes = parsePosInt(
      env.SKILLFORGE_RUN_OUTPUT_MAX_BYTES,
      DEFAULT_RUN_OUTPUT_MAX_BYTES,
      "SKILLFORGE_RUN_OUTPUT_MAX_BYTES",
    );
    orchestrationEnabled = parseBoolEnv(
      env.SKILLFORGE_ORCHESTRATION_ENABLED,
      false,
      "SKILLFORGE_ORCHESTRATION_ENABLED",
    );
    routinesDisabled = parseBoolEnv(
      env.SKILLFORGE_ROUTINES_DISABLED,
      false,
      "SKILLFORGE_ROUTINES_DISABLED",
    );
    hooksDisabled = parseBoolEnv(env.SKILLFORGE_HOOKS_DISABLED, false, "SKILLFORGE_HOOKS_DISABLED");
    safeErrors = parseSafeErrors(env);
  } catch (e) {
    if (e instanceof ConfigError) throw e;
    throw e;
  }

  const host = parsed.data.SKILLFORGE_HOST;
  const port = parsed.data.SKILLFORGE_PORT as number;
  const dataDir = path.resolve(parsed.data.SKILLFORGE_DATA_DIR);
  const webDir = parsed.data.SKILLFORGE_WEB_DIR
    ? path.resolve(parsed.data.SKILLFORGE_WEB_DIR)
    : defaultWebDir();
  const baseUrl =
    parsed.data.SKILLFORGE_BASE_URL && parsed.data.SKILLFORGE_BASE_URL.length > 0
      ? parsed.data.SKILLFORGE_BASE_URL
      : `http://${host}:${port}`;
  const marketplaceSource = parseMarketplaceSource(env.SKILLFORGE_MARKETPLACE_SOURCE, baseUrl);

  const pluginsDir = parsePluginsDir(env.SKILLFORGE_PLUGINS_DIR, dataDir);
  const bundledPluginsDir = parseBundledPluginsDir(env.SKILLFORGE_BUNDLED_PLUGINS_DIR);
  const mirrorIntervalHours = parseMirrorInterval(env.SKILLFORGE_MIRROR_INTERVAL_HOURS);

  let authMode: AuthMode;
  let oidcProviders: OidcProviderConfig[];
  let ldapProviders: LdapProviderConfig[];
  let publicUrl: string | null;
  try {
    authMode = parseAuthMode(env.SKILLFORGE_AUTH_MODE);
    assertLocalModeHost(authMode, host);
    oidcProviders = parseOidcProviders(env);
    const oidcIds = new Set(oidcProviders.map((p) => p.id));
    ldapProviders = parseLdapProviders(env, oidcIds);
    publicUrl =
      oidcProviders.length > 0
        ? parsePublicUrl(env.SKILLFORGE_PUBLIC_URL)
        : parsePublicUrl(env.SKILLFORGE_PUBLIC_URL);
  } catch (e) {
    if (e instanceof ConfigError) throw e;
    throw e;
  }

  return {
    port,
    host,
    dataDir,
    baseUrl,
    webDir,
    adminPassword,
    publicRead,
    sessionTtlDays,
    agingDays,
    candidateTtlDays,
    dataLifecycleEnabled,
    zombieIdleDays,
    zombieWindowDays,
    zombieMinUses,
    zombieMinReporters,
    zombieTransferRate,
    zombieRetireDays,
    ablationMinTasks,
    reviveWindowDays,
    reviveMinEvents,
    lifecycleMaxPerSweep,
    importGit,
    importAllowFileUrls,
    importTtlMinutes,
    marketplaceName,
    marketplaceOwner,
    marketplaceSource,
    backupKeep,
    pluginsDir,
    bundledPluginsDir,
    mirrorIntervalHours,
    pluginsDisabled,
    agentRoots,
    starterPacksDir: parseStarterPacksDir(env.SKILLFORGE_STARTER_PACKS_DIR),
    authMode,
    publicUrl,
    oidcProviders,
    ldapProviders,
    evalRunnersFile,
    evalConcurrency,
    evalMaxRunsPerDay,
    evalAblationAuto,
    runOutputRetentionDays,
    runOutputMaxBytes,
    orchestrationEnabled,
    routinesDisabled,
    hooksDisabled,
    safeErrors,
    ...parseLlmEnv(env),
    ...parseGitHubEnv(env),
    downloadsDir: parseDownloadsDir(env.SKILLFORGE_DOWNLOADS_DIR),
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  try {
    return parseConfig(env);
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
}
