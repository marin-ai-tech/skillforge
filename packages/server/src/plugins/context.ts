import { clearBadge, parseBadge, setBadge } from "./badges.ts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  spawnIsolated,
  type SpawnIsolatedOptions,
  type SpawnIsolatedResult,
} from "@skillforge/core";
import type { Database } from "../db.ts";
import { requireRole as guardRequireRole } from "../auth/guard.ts";
import type { Role } from "../auth/users.ts";
import {
  addVersionEvidence,
  getArtifactByTypeName,
  getVersion,
  listArtifacts,
  rowToSummary,
  type ArtifactSummary,
  type VersionDetail,
} from "../repo.ts";
import { readBlob } from "../blobs.ts";
import type { AppConfig } from "../config.ts";
import type { ChatMessage } from "../llm/client.ts";
import {
  completeTask,
  parsePurpose,
  registerConsumer,
  taskStatus,
  type LlmTaskStatus,
  type TaskResult,
} from "../llm/tasks.ts";
import { applyDefaults } from "./config-schema.ts";
import { subscribePluginEvent, type PluginEvent } from "./events.ts";
import type { PluginState } from "./registry.ts";
import type { ConfigSchema } from "./manifest.ts";
import {
  insertNotification,
  emitNotifications,
  preferenceEnabled,
} from "../notifications/notify.ts";
import { canView } from "../visibility/index.ts";

export type PluginLogger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export type PluginTabAction = {
  id: string;
  label: string;
  path: string;
  body?: Record<string, unknown>;
  confirm?: string;
};

export type PluginTabSection = {
  id: string;
  markdown: string;
  actions?: PluginTabAction[];
};

export type PluginTabUser = { username: string; role: string } | null;

export type PluginTabResult = {
  markdown: string;
  sections?: PluginTabSection[];
  actions?: PluginTabAction[];
  refresh_ms?: number;
};

export type PluginContext = {
  name: string;
  version: string;
  dir: string;
  logger: PluginLogger;
  config: { get: () => Record<string, unknown> };
  routes: {
    register: (fn: (app: FastifyInstance) => unknown | Promise<unknown>) => void;
    public: (path: string) => void;
  };
  auth: {
    requireRole: (request: FastifyRequest, reply: FastifyReply, role: Role) => boolean;
  };
  events: {
    on: (type: string, handler: (evt: PluginEvent) => void | Promise<void>) => void;
  };
  notifications: {
    send: (input: {
      users: string[];
      title: string;
      text?: string;
      url?: string;
      artifact?: { type: string; name: string };
      version?: string;
    }) => number;
  };
  db: {
    migrate: (migrations: Array<{ id: string; sql: string }>) => void;
    prepare: (sql: string) => ReturnType<Database["prepare"]>;
    exec: (sql: string) => void;
  };
  registry: {
    listArtifacts: (opts?: { type?: string; status?: string; limit?: number; offset?: number }) => {
      items: ArtifactSummary[];
      total: number;
    };
    getArtifact: (type: string, name: string) => ArtifactSummary | null;
    getVersion: (type: string, name: string, version: string) => VersionDetail | null;
    readFile: (type: string, name: string, version: string, filePath: string) => Uint8Array | null;
    addEvidence: (
      type: string,
      name: string,
      version: string,
      evidence: { kind: string; url: string },
    ) => Array<{ kind: string; url: string }> | null;
    /** plugin-artifact-badges: a badge of this plugin on the artifact card; the same id replaces it. */
    setBadge: (type: string, name: string, badge: unknown) => void;
    clearBadge: (type: string, name: string, id: string) => void;
  };
  ui: {
    nav: (opts: { id: string; label: string; page: string }) => void;
    page: (
      id: string,
      handler: () =>
        { title: string; markdown: string } | Promise<{ title: string; markdown: string }>,
    ) => void;
    artifactTab: (
      opts: { id: string; label: string },
      handler: (args: {
        artifact: ArtifactSummary;
        version: VersionDetail | null;
        user: PluginTabUser;
      }) => PluginTabResult | Promise<PluginTabResult>,
    ) => void;
  };
  process: {
    spawnIsolated: (
      command: string[],
      options?: SpawnIsolatedOptions,
    ) => Promise<SpawnIsolatedResult>;
  };
  /** Model access by purpose, with the "llm" capability; the key stays in the server. */
  llm: {
    status: (purpose: string) => LlmTaskStatus;
    complete: (args: { purpose: string; messages: ChatMessage[] }) => Promise<TaskResult>;
    registerConsumer: (purpose: string) => void;
  };
};

export type ContextDeps = {
  db: Database;
  dataDir: string;
  getConfig: () => Record<string, unknown>;
  configSchema: ConfigSchema | undefined;
  appConfig: AppConfig;
};

const CREATE_RE =
  /CREATE\s+(?:VIRTUAL\s+|UNIQUE\s+|TEMP(?:ORARY)?\s+)?(TABLE|INDEX|VIEW|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([A-Za-z0-9_-]+)/gi;

export class PluginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginError";
  }
}

/** Manifest capability that unlocks ctx.process (the only enforced one; the rest are informative). */
export const PROCESS_CAPABILITY = "process";

/**
 * ctx.process: thin wrapper over core spawnIsolated, so all isolation stays in one place.
 * The server resolves @skillforge/core from its own tree, so the plugin directory location does not
 * matter. Without the "process" capability the call is rejected before any process is spawned.
 */
export function createProcessApi(state: PluginState): PluginContext["process"] {
  const allowed = (state.manifest?.capabilities ?? []).includes(PROCESS_CAPABILITY);
  return {
    spawnIsolated: (command, options) => {
      if (!allowed) {
        return Promise.reject(
          new PluginError(
            `capability "${PROCESS_CAPABILITY}" is not declared in skillforge-plugin.json`,
          ),
        );
      }
      return spawnIsolated(command, options);
    },
  };
}

/** Manifest capability that unlocks ctx.llm. */
export const LLM_CAPABILITY = "llm";

/** ctx.llm: only a status and a call by purpose; nothing here can return the key or the settings. */
export function createLlmApi(
  state: PluginState,
  db: Database,
  appConfig: AppConfig,
): PluginContext["llm"] {
  const allowed = (state.manifest?.capabilities ?? []).includes(LLM_CAPABILITY);
  const requireCapability = () => {
    if (!allowed) {
      throw new PluginError(
        `capability "${LLM_CAPABILITY}" is not declared in skillforge-plugin.json`,
      );
    }
  };
  return {
    status: (purpose) => {
      requireCapability();
      return taskStatus(db, parsePurpose(purpose));
    },
    complete: async ({ purpose, messages }) => {
      requireCapability();
      return completeTask(db, appConfig, { purpose: parsePurpose(purpose), messages });
    },
    registerConsumer: (purpose) => {
      requireCapability();
      registerConsumer(parsePurpose(purpose));
    },
  };
}

export function createLogger(name: string): PluginLogger {
  const prefix = `[plugin ${name}]`;
  return {
    info: (...args: unknown[]) => console.info(prefix, ...args),
    warn: (...args: unknown[]) => console.warn(prefix, ...args),
    error: (...args: unknown[]) => console.error(prefix, ...args),
  };
}

export function assertMigrationNames(pluginName: string, sql: string): void {
  const prefix = `ext_${pluginName}_`;
  const underscored = `ext_${pluginName.replaceAll("-", "_")}_`;
  CREATE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CREATE_RE.exec(sql)) !== null) {
    const ident = m[2]!;
    if (!ident.startsWith(prefix) && !ident.startsWith(underscored)) {
      throw new PluginError(`object must be prefixed with ${prefix} (got ${ident})`);
    }
  }
}

type NotificationSendInput = Parameters<PluginContext["notifications"]["send"]>[0];
type NotificationArtifact = ReturnType<typeof getArtifactByTypeName> | null;

function validRecipients(users: unknown): boolean {
  return (
    Array.isArray(users) && users.length <= 20 && !users.some((u) => typeof u !== "string" || !u)
  );
}

function validTitle(title: unknown): boolean {
  return typeof title === "string" && !!title && title.length <= 120;
}

function validOptionalText(text: unknown): boolean {
  return text === undefined || (typeof text === "string" && text.length <= 500);
}

function optionalString(v: unknown): boolean {
  return v === undefined || typeof v === "string";
}

function validArtifactRef(artifact: NotificationSendInput["artifact"]): boolean {
  return (
    artifact === undefined ||
    (typeof artifact.type === "string" && typeof artifact.name === "string")
  );
}

function isValidSendInput(input: NotificationSendInput): boolean {
  return (
    !!input &&
    validRecipients(input.users) &&
    validTitle(input.title) &&
    validOptionalText(input.text) &&
    optionalString(input.url) &&
    optionalString(input.version) &&
    validArtifactRef(input.artifact)
  );
}

/** At most 200 sends per plugin per rolling hour. */
function takeSendSlot(sendTimes: number[]): void {
  const now = Date.now();
  while (sendTimes.length && sendTimes[0]! < now - 3600000) sendTimes.shift();
  if (sendTimes.length >= 200) throw new PluginError("rate_limited");
  sendTimes.push(now);
}

function pluginRecipient(
  db: ContextDeps["db"],
  username: string,
  artifact: NotificationArtifact,
): { username: string; role: Role; disabled: number } | null {
  const user = db
    .prepare("SELECT username, role, disabled FROM users WHERE username = ?")
    .get(username) as { username: string; role: Role; disabled: number } | undefined;
  if (
    !user ||
    user.disabled ||
    !preferenceEnabled(db, user.username, "plugin") ||
    (artifact && !canView(db, user, artifact))
  )
    return null;
  return user;
}

function notificationUrl(url: string | undefined, artifact: NotificationArtifact): string {
  return url ?? (artifact ? `/artifacts/${artifact.type}/${artifact.name}` : "/me/notifications");
}

export function createContext(state: PluginState, deps: ContextDeps): PluginContext {
  const { db, dataDir, getConfig, configSchema } = deps;
  const name = state.name;
  const sendTimes: number[] = [];

  return {
    name,
    version: state.manifest?.version ?? "0.0.0",
    dir: state.dir,
    logger: createLogger(name),
    config: {
      get: () => applyDefaults(configSchema, getConfig()),
    },
    routes: {
      register: (fn) => {
        state.contributions.routeFns.push(fn as (app: unknown) => unknown);
        state.contributions.routes += 1;
      },
      public: (relPath) => {
        const p = relPath.startsWith("/") ? relPath : `/${relPath}`;
        state.contributions.publicPaths.push(p);
      },
    },
    auth: {
      requireRole: (request, reply, role) => guardRequireRole(request, reply, role),
    },
    events: {
      on: (type, handler) => {
        subscribePluginEvent(name, type, handler);
      },
    },
    notifications: {
      send: (input) => {
        if (!isValidSendInput(input)) throw new PluginError("notification_invalid");
        takeSendSlot(sendTimes);
        const artifact = input.artifact
          ? getArtifactByTypeName(db, input.artifact.type, input.artifact.name)
          : null;
        if (input.artifact && !artifact) throw new PluginError("notification_invalid");
        const created = [];
        db.exec("BEGIN IMMEDIATE");
        try {
          for (const username of new Set(input.users)) {
            const user = pluginRecipient(db, username, artifact);
            if (!user) continue;
            created.push(
              insertNotification(db, {
                username: user.username,
                kind: "plugin",
                artifactId: artifact?.id,
                version: input.version,
                actor: name,
                title: input.title,
                text: input.text,
                url: notificationUrl(input.url, artifact),
                meta: { plugin: name },
              }),
            );
          }
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
        emitNotifications(created);
        return created.length;
      },
    },
    db: {
      migrate: (migrations) => {
        for (const mig of migrations) {
          assertMigrationNames(name, mig.sql);
          const existing = db
            .prepare("SELECT 1 AS ok FROM plugin_migrations WHERE plugin = ? AND id = ?")
            .get(name, mig.id) as { ok: number } | undefined;
          if (existing) continue;
          db.exec("BEGIN");
          try {
            db.exec(mig.sql);
            db.prepare(
              "INSERT INTO plugin_migrations (plugin, id, applied_at) VALUES (?, ?, ?)",
            ).run(name, mig.id, new Date().toISOString());
            db.exec("COMMIT");
          } catch (e) {
            try {
              db.exec("ROLLBACK");
            } catch {
              /* ignore */
            }
            throw e;
          }
        }
      },
      prepare: (sql) => db.prepare(sql),
      exec: (sql) => {
        db.exec(sql);
      },
    },
    registry: {
      listArtifacts: (opts = {}) => {
        return listArtifacts(db, {
          type: opts.type,
          status: opts.status,
          limit: opts.limit ?? 50,
          offset: opts.offset ?? 0,
        });
      },
      getArtifact: (type, artifactName) => {
        const row = getArtifactByTypeName(db, type, artifactName);
        if (!row) return null;
        return rowToSummary(db, row);
      },
      getVersion: (type, artifactName, version) => {
        const row = getArtifactByTypeName(db, type, artifactName);
        if (!row) return null;
        const ver = version === "latest" ? (row.latest_version ?? "") : version;
        if (!ver) return null;
        return getVersion(db, row.id, ver) ?? null;
      },
      readFile: (type, artifactName, version, filePath) => {
        const row = getArtifactByTypeName(db, type, artifactName);
        if (!row) return null;
        const ver = version === "latest" ? (row.latest_version ?? "") : version;
        if (!ver) return null;
        const detail = getVersion(db, row.id, ver);
        if (!detail) return null;
        const file = detail.files.find((f) => f.path === filePath);
        if (!file) return null;
        try {
          return readBlob(dataDir, file.sha256);
        } catch {
          return null;
        }
      },
      addEvidence: (type, artifactName, version, evidence) => {
        const row = getArtifactByTypeName(db, type, artifactName);
        if (!row) return null;
        const ver = version === "latest" ? (row.latest_version ?? "") : version;
        if (!ver) return null;
        return addVersionEvidence(db, row.id, ver, evidence);
      },
      setBadge: (type, artifactName, badge) => {
        const row = getArtifactByTypeName(db, type, artifactName);
        if (!row || row.purged_at) throw new Error(`unknown artifact ${type}/${artifactName}`);
        setBadge(db, row.id, state.name, parseBadge(badge));
      },
      clearBadge: (type, artifactName, id) => {
        const row = getArtifactByTypeName(db, type, artifactName);
        if (row) clearBadge(db, row.id, state.name, id);
      },
    },
    ui: {
      nav: (opts) => {
        state.contributions.navItems.push(opts);
        state.contributions.nav += 1;
      },
      page: (id, handler) => {
        state.contributions.pages.set(id, handler);
      },
      artifactTab: (opts, handler) => {
        state.contributions.tabsHandlers.set(opts.id, {
          id: opts.id,
          label: opts.label,
          handler: handler as (args: {
            artifact: unknown;
            version: unknown;
            user: unknown;
          }) => PluginTabResult | Promise<PluginTabResult>,
        });
        state.contributions.tabs += 1;
      },
    },
    process: createProcessApi(state),
    llm: createLlmApi(state, db, deps.appConfig),
  };
}
