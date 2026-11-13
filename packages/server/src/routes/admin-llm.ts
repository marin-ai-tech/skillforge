import { appendSystemEvent } from "../audit/journal.ts";
import type { FastifyPluginAsync } from "fastify";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db.ts";
import { requireRole } from "../auth/guard.ts";
import { testConnection } from "../llm/client.ts";
import {
  SettingsError,
  applyAdminPatch,
  keyAllowedFor,
  loadSettings,
  saveSettings,
  taskUsageSince,
  today,
  usageSince,
} from "../llm/settings.ts";
import { hasConsumer, taskStatus } from "../llm/tasks.ts";

/**
 * LLM access settings for admin. The API key comes only from the environment:
 * responses say whether it is set and allowed for the configured address, never its value.
 */
export type AdminLlmOpts = { db: Database; config: AppConfig };

function view(db: Database, config: AppConfig) {
  const settings = loadSettings(db);
  const monthAgo = today(new Date(Date.now() - 29 * 86_400_000));
  const status = taskStatus(db, "skill_validation");
  return {
    settings,
    key: {
      set: !!config.llmApiKey,
      /** llm-budget-broker: the key lives in the Agent Space budget broker; SkillForge never sends one. */
      managed: !!config.budgetSocket,
      env: "SKILLFORGE_LLM_API_KEY",
      origins_env: "SKILLFORGE_LLM_KEY_ORIGINS",
      allowed_for_base_url: keyAllowedFor(config, settings.base_url),
    },
    validation: {
      active: status.active,
      reason: status.reason,
      consumer_ready: hasConsumer("skill_validation"),
    },
    usage: {
      today: usageSince(db, today()),
      last_30_days: usageSince(db, monthAgo),
      tasks: {
        skill_validation: {
          today: taskUsageSince(db, "skill_validation", today()),
          last_30_days: taskUsageSince(db, "skill_validation", monthAgo),
        },
      },
    },
  };
}

export const adminLlmRoutes: FastifyPluginAsync<AdminLlmOpts> = async (app, opts) => {
  const { db, config } = opts;

  app.get("/api/v1/admin/llm", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    return reply.code(200).send(view(db, config));
  });

  app.put("/api/v1/admin/llm", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    let next;
    try {
      next = applyAdminPatch(loadSettings(db), request.body);
    } catch (e) {
      if (e instanceof SettingsError) {
        return reply
          .code(400)
          .send({ error: "invalid_settings", field: e.field, message: e.message });
      }
      throw e;
    }
    saveSettings(db, next, request.user.username);
    appendSystemEvent(db, {
      actor: request.user.username,
      action: "llm_settings_change",
      meta: { fields: Object.keys(request.body as object) },
    });
    request.log.info(
      {
        event: "llm_settings_change",
        actor: request.user.username,
        fields: Object.keys(request.body as object),
      },
      "llm settings changed",
    );
    return reply.code(200).send(view(db, config));
  });

  app.post("/api/v1/admin/llm/test", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    return reply.code(200).send(await testConnection(config, loadSettings(db)));
  });
};
