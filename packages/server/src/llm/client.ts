import type { AppConfig } from "../config.ts";
import { authHeaderFor, type LlmSettings } from "./settings.ts";
import { brokerFetch, brokerProvider } from "./broker.ts";

/**
 * Client of an OpenAI-compatible `POST {base_url}/chat/completions`.
 * Read-only by construction: the request never carries `tools`, `functions` or `tool_choice`, and `tool_calls` in the
 * answer are ignored. Provider error bodies are never passed on: callers get a code only.
 */
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type LlmErrorCode =
  | "llm_unauthorized"
  | "llm_rate_limited"
  | "llm_timeout"
  | "llm_upstream_error"
  | "llm_aborted"
  | "llm_disabled"
  | "llm_budget_exhausted"
  | "budget_grant_rejected"
  | "unknown_purpose";

export class LlmError extends Error {
  code: LlmErrorCode;
  constructor(code: LlmErrorCode) {
    super(code);
    this.code = code;
  }
}

export type Usage = { input_tokens: number; output_tokens: number };

type StreamOpts = {
  config: AppConfig;
  settings: LlmSettings;
  messages: ChatMessage[];
  maxTokens?: number;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  /** Agent Space task budget grant (llm-budget-broker): sent only to the budget broker, never in the messages. */
  budgetGrant?: string;
};

/**
 * Error code of a refused request. Through the budget broker with a grant, 401 and 403 are the broker refusing the
 * grant (as on its external port: `skillforge_grant_invalid`, `sdlc_claim_unconfirmed`), not a bad provider key.
 */
function statusCode(status: number, config: AppConfig, grant: string | undefined): LlmErrorCode {
  if (status === 401 || status === 403)
    return config.budgetSocket && grant ? "budget_grant_rejected" : "llm_unauthorized";
  if (status === 429) return "llm_rate_limited";
  return "llm_upstream_error";
}

function usageOf(obj: {
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}): Usage | null {
  const u = obj.usage;
  if (!u || typeof u !== "object") return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { input_tokens: n(u.prompt_tokens), output_tokens: n(u.completion_tokens) };
}

type Chunk = {
  choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
};

/** Text of one parsed chunk (stream `delta.content` or non-stream `message.content`); tool calls are ignored. */
function textOf(obj: Chunk): string {
  const choice = obj.choices?.[0];
  const content = choice?.delta?.content ?? choice?.message?.content;
  return typeof content === "string" ? content : "";
}

/** Reads `data:` lines of an SSE body; returns the usage the provider reported, if any. */
async function readStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (t: string) => void,
): Promise<Usage | null> {
  const decoder = new TextDecoder();
  let buffer = "";
  let usage: Usage | null = null;
  for await (const part of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(part, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return usage;
      let obj: Chunk;
      try {
        obj = JSON.parse(payload) as Chunk;
      } catch {
        continue;
      }
      const text = textOf(obj);
      if (text) onDelta(text);
      usage = usageOf(obj) ?? usage;
    }
  }
  return usage;
}

/**
 * One request to the model: through the budget broker when it is configured (no provider key, no fallback to the
 * provider), otherwise to the provider. A budget grant without a broker is refused before any request.
 */
function requestModel(
  config: AppConfig,
  settings: LlmSettings,
  payload: string,
  signal: AbortSignal,
  grant: string | undefined,
): Promise<Response> {
  if (config.budgetSocket) {
    const provider = brokerProvider(settings.base_url);
    if (!provider) throw new LlmError("llm_upstream_error");
    return brokerFetch(config.budgetSocket, provider, payload, signal, grant);
  }
  if (grant !== undefined) throw new LlmError("llm_upstream_error");
  return fetch(`${settings.base_url}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      ...authHeaderFor(config, settings.base_url),
    },
    body: payload,
    signal,
  });
}

/** Streams one chat completion; resolves with token usage (zeros when the provider does not report it). */
export async function streamChat(opts: StreamOpts): Promise<Usage> {
  const { config, settings } = opts;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), settings.timeout_s * 1000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout.signal]) : timeout.signal;
  try {
    const payload = JSON.stringify({
      model: settings.model,
      messages: opts.messages,
      temperature: settings.temperature,
      max_tokens: opts.maxTokens ?? settings.max_output_tokens,
      stream: true,
      stream_options: { include_usage: true },
    });
    const res = await requestModel(config, settings, payload, signal, opts.budgetGrant);
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => undefined);
      throw new LlmError(statusCode(res.status, config, opts.budgetGrant));
    }
    let usage: Usage | null;
    if ((res.headers.get("content-type") ?? "").includes("application/json")) {
      const obj = (await res.json()) as Chunk;
      const text = textOf(obj);
      if (text) opts.onDelta(text);
      usage = usageOf(obj);
    } else {
      usage = await readStream(res.body, opts.onDelta);
    }
    return usage ?? { input_tokens: 0, output_tokens: 0 };
  } catch (e) {
    if (e instanceof LlmError) throw e;
    if (timeout.signal.aborted) throw new LlmError("llm_timeout");
    if (opts.signal?.aborted) throw new LlmError("llm_aborted");
    throw new LlmError("llm_upstream_error");
  } finally {
    clearTimeout(timer);
  }
}

const COMPLETE_TEXT_MAX = 256 * 1024;

/** One whole answer for background tasks, over the same request and error handling as the stream. */
export async function completeChat(
  opts: Omit<StreamOpts, "onDelta">,
): Promise<{ text: string; usage: Usage }> {
  let text = "";
  const usage = await streamChat({
    ...opts,
    onDelta: (delta) => {
      if (text.length < COMPLETE_TEXT_MAX) text += delta;
    },
  });
  return { text: text.slice(0, COMPLETE_TEXT_MAX), usage };
}

/** Connection check for admin: a tiny request; the answer text is discarded. */
export async function testConnection(
  config: AppConfig,
  settings: LlmSettings,
): Promise<
  | { ok: true; model: string; latency_ms: number }
  | { ok: false; error: LlmErrorCode | "assistant_not_configured" }
> {
  if (!settings.base_url || !settings.model)
    return { ok: false, error: "assistant_not_configured" };
  const started = Date.now();
  try {
    await streamChat({
      config,
      settings,
      messages: [{ role: "user", content: "ping" }],
      maxTokens: 8,
      onDelta: () => undefined,
    });
    return { ok: true, model: settings.model, latency_ms: Date.now() - started };
  } catch (e) {
    return { ok: false, error: e instanceof LlmError ? e.code : "llm_upstream_error" };
  }
}
