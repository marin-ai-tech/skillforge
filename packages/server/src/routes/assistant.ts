import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db.ts";
import { requireUser } from "../auth/guard.ts";
import { LlmError, streamChat, type ChatMessage } from "../llm/client.ts";
import { helpLangs, loadCorpus, type HelpLang } from "../llm/corpus.ts";
import { buildMessages, type AssistantMode } from "../llm/prompt.ts";
import { isBudgetGrant } from "../llm/broker.ts";
import {
  addTokens,
  isConfigured,
  loadSettings,
  requestsToday,
  reserveRequest,
} from "../llm/settings.ts";

/**
 * Read-only help assistant: signed-in users ask about SkillForge; the server
 * builds the context from the help and streams the model's answer as SSE. Nothing of the conversation is stored or
 * logged — only daily counters.
 */
export type AssistantOpts = { db: Database; config: AppConfig };

const MAX_TURNS = 20;
const MAX_CONTENT = 4000;
const MAX_TOTAL = 24000;
const TOPIC_ID = /^[A-Za-z0-9_/-]{1,120}$/;

type ChatRequest = {
  mode: AssistantMode;
  lang: HelpLang;
  pageTopic: string | null;
  messages: ChatMessage[];
  /** Agent Space task budget grant (llm-budget-broker): a secret, only for the broker call. */
  budgetGrant?: string;
};

class BadRequest extends Error {}

function parseMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw) || raw.length > MAX_TURNS)
    throw new BadRequest(`messages: up to ${MAX_TURNS} turns`);
  let total = 0;
  return raw.map((m: unknown) => {
    const { role, content } = (m ?? {}) as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant")
      throw new BadRequest("messages: role must be user or assistant");
    if (typeof content !== "string" || !content.trim() || content.length > MAX_CONTENT) {
      throw new BadRequest(`messages: content must be 1–${MAX_CONTENT} characters`);
    }
    total += content.length;
    if (total > MAX_TOTAL) throw new BadRequest(`messages: up to ${MAX_TOTAL} characters in total`);
    return { role, content };
  });
}

/** Untrusted request body → typed request (parse at the boundary). */
export function parseChatRequest(body: unknown): ChatRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.mode !== "onboarding" && b.mode !== "consult")
    throw new BadRequest("mode must be onboarding or consult");
  if (typeof b.lang !== "string" || !/^[a-z]{2,3}$/.test(b.lang)) {
    throw new BadRequest("lang must be a language code such as en");
  }
  const page = b.page_topic;
  if (page !== undefined && page !== null && (typeof page !== "string" || !TOPIC_ID.test(page))) {
    throw new BadRequest("page_topic must be a help topic id");
  }
  if (b.budget_grant !== undefined && !isBudgetGrant(b.budget_grant)) {
    throw new BadRequest("budget_grant must be an Agent Space task budget grant");
  }
  return {
    mode: b.mode,
    lang: b.lang,
    pageTopic: (page as string | undefined) ?? null,
    messages: parseMessages(b.messages),
    ...(isBudgetGrant(b.budget_grant) ? { budgetGrant: b.budget_grant } : {}),
  };
}

/** SSE writer that sends the headers lazily: an upstream error before any text can still be a plain JSON answer. */
function sseWriter(reply: FastifyReply) {
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    });
  };
  return {
    get started() {
      return started;
    },
    send(event: string, data: unknown) {
      start();
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
  };
}

export const assistantRoutes: FastifyPluginAsync<AssistantOpts> = async (app, opts) => {
  const { db, config } = opts;

  app.get("/api/v1/assistant/status", async (request, reply) => {
    const s = loadSettings(db);
    if (!s.enabled) return reply.send({ available: false, reason: "disabled" });
    if (!isConfigured(s)) return reply.send({ available: false, reason: "not_configured" });
    if (!request.user) return reply.send({ available: false, reason: "sign_in" });
    const limit = s.daily_requests_per_user;
    const remaining = limit > 0 ? Math.max(0, limit - requestsToday(db, request.user.id)) : null;
    return reply.send({
      available: true,
      remaining_today: remaining,
      ...(config.budgetSocket ? { budget_grant: true } : {}),
    });
  });

  app.post("/api/v1/assistant/chat", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    let req: ChatRequest;
    try {
      req = parseChatRequest(request.body);
    } catch (e) {
      if (e instanceof BadRequest)
        return reply.code(400).send({ error: "invalid_request", message: e.message });
      throw e;
    }
    if (req.budgetGrant && !config.budgetSocket) {
      return reply.code(400).send({ error: "budget_grant_unsupported" });
    }
    const langs = helpLangs(config);
    if (!langs.includes(req.lang)) {
      return reply
        .code(400)
        .send({ error: "invalid_request", message: `lang must be one of ${langs.join(", ")}` });
    }
    const settings = loadSettings(db);
    if (!settings.enabled) return reply.code(409).send({ error: "assistant_disabled" });
    if (!isConfigured(settings)) return reply.code(409).send({ error: "assistant_not_configured" });
    if (!reserveRequest(db, request.user.id, settings.daily_requests_per_user)) {
      return reply.code(429).send({ error: "assistant_daily_limit" });
    }

    const messages = buildMessages({
      mode: req.mode,
      lang: req.lang,
      role: request.user.role,
      pageTopic: req.pageTopic,
      messages: req.messages,
      corpus: loadCorpus(config, req.lang),
      contextTopics: settings.context_topics,
    });
    reply.hijack();
    const out = sseWriter(reply);
    const abort = new AbortController();
    reply.raw.on("close", () => {
      if (!reply.raw.writableFinished) abort.abort();
    });
    const started = Date.now();
    let code = "ok";
    try {
      const usage = await streamChat({
        config,
        settings,
        messages,
        budgetGrant: req.budgetGrant,
        signal: abort.signal,
        onDelta: (text) => out.send("delta", { text }),
      });
      addTokens(db, request.user.id, usage.input_tokens, usage.output_tokens);
      out.send("done", { usage });
    } catch (e) {
      code = e instanceof LlmError ? e.code : "llm_upstream_error";
      if (out.started) out.send("error", { code });
      else if (!abort.signal.aborted) {
        reply.raw.writeHead(code === "llm_timeout" ? 504 : 502, {
          "content-type": "application/json; charset=utf-8",
        });
        reply.raw.write(JSON.stringify({ error: code }));
      }
    } finally {
      reply.raw.end();
      // Counters and timing only: the conversation is never logged.
      request.log.info(
        { event: "assistant_chat", mode: req.mode, lang: req.lang, code, ms: Date.now() - started },
        "assistant chat",
      );
    }
  });
};
