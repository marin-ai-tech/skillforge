import { resetConsumers } from "../llm/tasks.ts";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db.ts";
import { applyDefaults } from "./config-schema.ts";
import { createContext } from "./context.ts";
import { emitPluginEvent, resetPluginEventHandlers, unsubscribePlugin } from "./events.ts";
import { ManifestError, parseManifest, resolveMainPath } from "./manifest.ts";
import { emptyContributions, pluginRegistry, type PluginState } from "./registry.ts";

export type LoadPluginsOpts = {
  config: AppConfig;
  db: Database;
  app: FastifyInstance;
  serverVersion: string;
};

function readStoredConfig(db: Database, name: string): Record<string, unknown> {
  const row = db.prepare("SELECT config FROM plugins WHERE name = ?").get(name) as
    { config: string } | undefined;
  if (!row) return {};
  try {
    const parsed = JSON.parse(row.config) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function upsertPluginRow(db: Database, name: string, now: string): { enabled: boolean } {
  const existing = db.prepare("SELECT enabled FROM plugins WHERE name = ?").get(name) as
    { enabled: number } | undefined;
  if (!existing) {
    db.prepare(
      "INSERT INTO plugins (name, enabled, config, first_seen, updated_at) VALUES (?, 1, '{}', ?, ?)",
    ).run(name, now, now);
    return { enabled: true };
  }
  return { enabled: existing.enabled !== 0 };
}

function pathOnly(url: string): string {
  return url.split("?")[0] ?? url;
}

async function registerPluginRoutes(app: FastifyInstance, state: PluginState): Promise<void> {
  if (state.status !== "loaded") return;
  const prefix = `/api/v1/ext/${state.name}`;
  const publicPaths = new Set(state.contributions.publicPaths.map((p) => `${prefix}${p}`));
  const fns = state.contributions.routeFns;
  if (fns.length === 0) return;

  await app.register(
    async (sub) => {
      sub.addHook("onRequest", async (request, reply) => {
        if (request.user) return;
        const routeUrl =
          typeof request.routeOptions?.url === "string" ? request.routeOptions.url : "";
        const reqPath = pathOnly(request.url);
        if (publicPaths.has(routeUrl) || publicPaths.has(reqPath)) return;
        return reply.code(401).send({ error: "unauthorized" });
      });
      for (const fn of fns) {
        await fn(sub);
      }
    },
    { prefix },
  );
}

async function loadOne(opts: LoadPluginsOpts, dirName: string, pluginDir: string): Promise<void> {
  const { config, db, app } = opts;
  const now = new Date().toISOString();
  const { enabled } = upsertPluginRow(db, dirName, now);

  const state: PluginState = {
    name: dirName,
    dir: pluginDir,
    manifest: null,
    status: enabled ? "error" : "disabled",
    error: null,
    enabled,
    contributions: emptyContributions(),
    restartRequired: false,
    configSchema: undefined,
  };
  pluginRegistry.set(state);

  if (!enabled) {
    state.status = "disabled";
    // Still try to read manifest for admin list fields
    try {
      const raw = JSON.parse(
        fs.readFileSync(path.join(pluginDir, "skillforge-plugin.json"), "utf8"),
      ) as unknown;
      const manifest = parseManifest(raw, dirName);
      state.manifest = manifest;
      state.configSchema = manifest.config_schema;
    } catch {
      /* keep null manifest */
    }
    return;
  }

  try {
    const manifestPath = path.join(pluginDir, "skillforge-plugin.json");
    if (!fs.existsSync(manifestPath)) {
      throw new ManifestError("skillforge-plugin.json not found");
    }
    const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;
    const manifest = parseManifest(raw, dirName);
    state.manifest = manifest;
    state.configSchema = manifest.config_schema;

    const mainPath = resolveMainPath(pluginDir, manifest.main);
    if (!fs.existsSync(mainPath)) {
      throw new ManifestError(`main module not found: ${manifest.main}`);
    }

    const mod = (await import(pathToFileURL(mainPath).href)) as {
      register?: (ctx: unknown) => unknown | Promise<unknown>;
    };
    if (typeof mod.register !== "function") {
      throw new ManifestError("plugin must export register(ctx)");
    }

    const ctx = createContext(state, {
      db,
      dataDir: config.dataDir,
      configSchema: manifest.config_schema,
      getConfig: () => readStoredConfig(db, dirName),
      appConfig: config,
    });

    await mod.register(ctx);
    state.status = "loaded";
    state.error = null;
    await registerPluginRoutes(app, state);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    state.status = "error";
    state.error = msg;
    unsubscribePlugin(dirName);
    state.contributions = emptyContributions();
    console.error(`[plugin ${dirName}] failed to load: ${msg}`);
  }
}

/** Subfolders of `dir` that hold a plugin manifest; a missing folder is not an error. */
function pluginDirsIn(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((name) => fs.existsSync(path.join(dir, name, "skillforge-plugin.json")))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export async function loadPlugins(opts: LoadPluginsOpts): Promise<void> {
  const { config, app, serverVersion } = opts;
  resetPluginEventHandlers();
  resetConsumers();
  pluginRegistry.reset();
  pluginRegistry.dir = config.pluginsDir;
  pluginRegistry.disabled = config.pluginsDisabled;

  if (config.pluginsDisabled) {
    return;
  }

  // The operator's folder first: a plugin there replaces the bundled one of the same name.
  const loaded = new Set<string>();
  for (const dir of [config.pluginsDir, config.bundledPluginsDir]) {
    if (!dir) continue;
    for (const name of pluginDirsIn(dir)) {
      if (loaded.has(name)) continue;
      loaded.add(name);
      await loadOne(opts, name, path.join(dir, name));
    }
  }

  app.addHook("onReady", async () => {
    emitPluginEvent({
      type: "server.started",
      at: new Date().toISOString(),
      version: serverVersion,
    });
  });
}

export function pluginConfigForAdmin(db: Database, state: PluginState): Record<string, unknown> {
  const stored = readStoredConfig(db, state.name);
  return applyDefaults(state.configSchema ?? state.manifest?.config_schema, stored);
}

export { readStoredConfig, applyDefaults };
