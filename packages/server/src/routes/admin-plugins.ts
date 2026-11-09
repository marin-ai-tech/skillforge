import type { FastifyPluginAsync } from "fastify";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db.ts";
import { requireRole } from "../auth/guard.ts";
import { applyDefaults, validateConfig } from "../plugins/config-schema.ts";
import { pluginRegistry, type PluginState } from "../plugins/registry.ts";

export type AdminPluginsOpts = {
  db: Database;
  config: AppConfig;
};

function parseStoredConfig(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function itemView(db: Database, state: PluginState) {
  const row = db.prepare("SELECT enabled, config FROM plugins WHERE name = ?").get(state.name) as
    { enabled: number; config: string } | undefined;
  const enabled = row ? row.enabled !== 0 : state.enabled;
  const stored: Record<string, unknown> = row ? parseStoredConfig(row.config) : {};
  const schema = state.configSchema ?? state.manifest?.config_schema;
  return {
    name: state.name,
    version: state.manifest?.version ?? "0.0.0",
    description: state.manifest?.description ?? "",
    enabled,
    status: state.status,
    error: state.error,
    capabilities: state.manifest?.capabilities ?? [],
    contributions: {
      routes: state.contributions.routes,
      nav: state.contributions.nav,
      tabs: state.contributions.tabs,
      events: [...state.contributions.events],
    },
    config: applyDefaults(schema, stored),
    config_schema: schema ?? { type: "object", properties: {}, required: [] },
    restart_required: state.restartRequired,
  };
}

type PatchError = { code: number; payload: Record<string, unknown> };

function applyConfigPatch(
  db: Database,
  state: PluginState | undefined,
  name: string,
  value: unknown,
  now: string,
): PatchError | null {
  const schema = state?.configSchema ?? state?.manifest?.config_schema;
  const result = validateConfig(schema, value);
  if (!result.ok) {
    return { code: 422, payload: { error: "config_invalid", issues: result.issues } };
  }
  db.prepare("UPDATE plugins SET config = ?, updated_at = ? WHERE name = ?").run(
    JSON.stringify(result.value),
    now,
    name,
  );
  return null;
}

function applyEnabledPatch(
  db: Database,
  state: PluginState | undefined,
  name: string,
  value: unknown,
  now: string,
): PatchError | null {
  if (typeof value !== "boolean") {
    return { code: 400, payload: { error: "bad_request", message: "enabled must be boolean" } };
  }
  db.prepare("UPDATE plugins SET enabled = ?, updated_at = ? WHERE name = ?").run(
    value ? 1 : 0,
    now,
    name,
  );
  if (state) {
    state.enabled = value;
    state.restartRequired = true;
  }
  // Row without runtime state — still 200; synthesize minimal view below
  return null;
}

// Plugin known in DB but not in registry (e.g. kill-switch off mid-flight) — rare
function unregisteredPluginView(db: Database, name: string) {
  let stored: Record<string, unknown> = {};
  const updated = db.prepare("SELECT enabled, config FROM plugins WHERE name = ?").get(name) as {
    enabled: number;
    config: string;
  };
  try {
    stored = JSON.parse(updated.config) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return {
    name,
    version: "0.0.0",
    description: "",
    enabled: updated.enabled !== 0,
    status: "disabled",
    error: null,
    capabilities: [],
    contributions: { routes: 0, nav: 0, tabs: 0, events: [] },
    config: stored,
    config_schema: { type: "object", properties: {}, required: [] },
    restart_required: true,
  };
}

export const adminPluginsRoutes: FastifyPluginAsync<AdminPluginsOpts> = async (app, opts) => {
  const { db, config } = opts;

  app.get("/api/v1/admin/plugins", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    if (config.pluginsDisabled || pluginRegistry.disabled) {
      return reply.code(200).send({
        dir: config.pluginsDir,
        disabled: true,
        items: [],
      });
    }
    const items = pluginRegistry.list().map((s) => itemView(db, s));
    return reply.code(200).send({
      dir: config.pluginsDir,
      disabled: false,
      items,
    });
  });

  app.patch<{ Params: { name: string } }>("/api/v1/admin/plugins/:name", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    const name = request.params.name;
    const row = db.prepare("SELECT name, enabled, config FROM plugins WHERE name = ?").get(name) as
      { name: string; enabled: number; config: string } | undefined;
    if (!row) {
      return reply.code(404).send({ error: "not_found" });
    }

    const body = (request.body ?? {}) as { enabled?: unknown; config?: unknown };
    const state = pluginRegistry.get(name);
    const now = new Date().toISOString();

    if ("config" in body) {
      const err = applyConfigPatch(db, state, name, body.config, now);
      if (err) return reply.code(err.code).send(err.payload);
    }

    if ("enabled" in body) {
      const err = applyEnabledPatch(db, state, name, body.enabled, now);
      if (err) return reply.code(err.code).send(err.payload);
    }

    const refreshed = pluginRegistry.get(name);
    if (refreshed) {
      return reply.code(200).send(itemView(db, refreshed));
    }
    return reply.code(200).send(unregisteredPluginView(db, name));
  });
};
