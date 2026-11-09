import type { FastifyPluginAsync } from "fastify";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db.ts";
import { getArtifactByTypeName, getVersion, rowToSummary } from "../repo.ts";
import { pluginRegistry } from "../plugins/registry.ts";

export type PluginsRoutesOpts = {
  db: Database;
  config: AppConfig;
};

function sanitizeAction(a: unknown): {
  id: string;
  label: string;
  path: string;
  body?: Record<string, unknown>;
  confirm?: string;
} | null {
  if (!a || typeof a !== "object") return null;
  const o = a as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.label !== "string" || typeof o.path !== "string")
    return null;
  if (!o.path.startsWith("/")) return null;
  const out: {
    id: string;
    label: string;
    path: string;
    body?: Record<string, unknown>;
    confirm?: string;
  } = {
    id: o.id,
    label: o.label,
    path: o.path,
  };
  if (
    o.body !== undefined &&
    o.body !== null &&
    typeof o.body === "object" &&
    !Array.isArray(o.body)
  ) {
    out.body = o.body as Record<string, unknown>;
  }
  if (typeof o.confirm === "string") out.confirm = o.confirm;
  return out;
}

function sanitizeSection(
  s: unknown,
): { id: string; markdown: string; actions: ReturnType<typeof sanitizeAction>[] } | null {
  if (!s || typeof s !== "object") return null;
  const o = s as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.markdown !== "string") return null;
  const actions: ReturnType<typeof sanitizeAction>[] = [];
  if (Array.isArray(o.actions)) {
    for (const a of o.actions) {
      const clean = sanitizeAction(a);
      if (clean) actions.push(clean);
    }
  }
  return { id: o.id, markdown: o.markdown, actions };
}

function sanitizeTabResult(result: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = { markdown: "" };
  if (!result || typeof result !== "object") return out;
  const o = result as Record<string, unknown>;
  if (typeof o.markdown === "string") out.markdown = o.markdown;
  if (Array.isArray(o.sections)) {
    const sections: ReturnType<typeof sanitizeSection>[] = [];
    for (const s of o.sections) {
      const clean = sanitizeSection(s);
      if (clean) sections.push(clean);
    }
    out.sections = sections;
  }
  if (Array.isArray(o.actions)) {
    const actions: ReturnType<typeof sanitizeAction>[] = [];
    for (const a of o.actions) {
      const clean = sanitizeAction(a);
      if (clean) actions.push(clean);
    }
    out.actions = actions;
  }
  if (typeof o.refresh_ms === "number" && Number.isInteger(o.refresh_ms) && o.refresh_ms >= 1000) {
    out.refresh_ms = o.refresh_ms;
  }
  return out;
}

export const pluginsRoutes: FastifyPluginAsync<PluginsRoutesOpts> = async (app, opts) => {
  const { db } = opts;

  app.get("/api/v1/plugins/ui", async (_request, reply) => {
    const nav: Array<{ plugin: string; id: string; label: string; path: string }> = [];
    const artifact_tabs: Array<{ plugin: string; id: string; label: string }> = [];
    for (const state of pluginRegistry.list()) {
      if (state.status !== "loaded") continue;
      for (const item of state.contributions.navItems) {
        nav.push({
          plugin: state.name,
          id: item.id,
          label: item.label,
          path: `/ext/${state.name}/${item.page}`,
        });
      }
      for (const tab of state.contributions.tabsHandlers.values()) {
        artifact_tabs.push({ plugin: state.name, id: tab.id, label: tab.label });
      }
    }
    return reply.code(200).send({ nav, artifact_tabs });
  });

  app.get<{ Params: { plugin: string; page: string } }>(
    "/api/v1/plugins/ui/pages/:plugin/:page",
    async (request, reply) => {
      const state = pluginRegistry.get(request.params.plugin);
      if (!state || state.status !== "loaded") {
        return reply.code(404).send({ error: "not_found" });
      }
      const handler = state.contributions.pages.get(request.params.page);
      if (!handler) {
        return reply.code(404).send({ error: "not_found" });
      }
      try {
        const result = await handler();
        return reply.code(200).send(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[plugin ${state.name}] ${msg}`);
        return reply.code(500).send({ error: "plugin_error" });
      }
    },
  );

  app.get<{ Params: { plugin: string; tab: string; type: string; name: string } }>(
    "/api/v1/plugins/ui/tabs/:plugin/:tab/:type/:name",
    async (request, reply) => {
      const state = pluginRegistry.get(request.params.plugin);
      if (!state || state.status !== "loaded") {
        return reply.code(404).send({ error: "not_found" });
      }
      const tab = state.contributions.tabsHandlers.get(request.params.tab);
      if (!tab) {
        return reply.code(404).send({ error: "not_found" });
      }
      const row = getArtifactByTypeName(db, request.params.type, request.params.name);
      if (!row) {
        return reply.code(404).send({ error: "not_found" });
      }
      const artifact = rowToSummary(db, row);
      const version = row.latest_version
        ? (getVersion(db, row.id, row.latest_version) ?? null)
        : null;
      const user = request.user
        ? { username: request.user.username, role: request.user.role }
        : null;
      try {
        const result = await tab.handler({ artifact, version, user });
        return reply.code(200).send(sanitizeTabResult(result));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[plugin ${state.name}] ${msg}`);
        return reply.code(500).send({ error: "plugin_error" });
      }
    },
  );

  // Fallback for unknown /api/v1/ext/* — registered by app.ts AFTER plugin load.
};
