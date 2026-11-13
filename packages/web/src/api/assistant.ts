import { ApiError, parseError } from "./client.ts";

/** LLM settings and the help assistant (llm-help-assistant). */
export type LlmSettings = {
  enabled: boolean;
  base_url: string;
  model: string;
  temperature: number;
  max_output_tokens: number;
  timeout_s: number;
  daily_requests_per_user: number;
  context_topics: number;
  validation_enabled: boolean | null;
  validation_daily_requests: number;
  validation_max_output_tokens: number;
  validation_timeout_s: number;
};

export type UsageTotals = {
  requests: number;
  input_tokens: number;
  output_tokens: number;
  users: number;
};

export type TaskUsageTotals = { requests: number; input_tokens: number; output_tokens: number };

export type AdminLlmView = {
  settings: LlmSettings;
  key: {
    set: boolean;
    /** llm-budget-broker: the key lives in the Agent Space budget broker. */
    managed?: boolean;
    env: string;
    origins_env: string;
    allowed_for_base_url: boolean;
  };
  validation: {
    active: boolean;
    reason: "undecided" | "disabled" | "not_configured" | null;
    consumer_ready: boolean;
  };
  usage: {
    today: UsageTotals;
    last_30_days: UsageTotals;
    tasks: { skill_validation: { today: TaskUsageTotals; last_30_days: TaskUsageTotals } };
  };
};

export type LlmTestResult =
  { ok: true; model: string; latency_ms: number } | { ok: false; error: string };

export type AssistantStatus = {
  available: boolean;
  reason?: "disabled" | "not_configured" | "sign_in";
  remaining_today?: number | null;
  /** llm-budget-broker: the server has a budget broker, so the chat accepts a task budget grant. */
  budget_grant?: boolean;
};

export type AssistantMode = "onboarding" | "consult";
export type AssistantTurn = { role: "user" | "assistant"; content: string };

export async function getAdminLlm(): Promise<AdminLlmView> {
  const res = await fetch("/api/v1/admin/llm", { credentials: "include" });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as AdminLlmView;
}

export async function putAdminLlm(body: Partial<LlmSettings>): Promise<AdminLlmView> {
  const res = await fetch("/api/v1/admin/llm", {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as AdminLlmView;
}

/** Queues skills without a current model check; the route belongs to the review-assistant plugin. */
export async function backfillValidation(): Promise<{ queued: number; skipped: number }> {
  const res = await fetch("/api/v1/ext/review-assistant/validation/backfill", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { queued: number; skipped: number };
}

export async function testAdminLlm(): Promise<LlmTestResult> {
  const res = await fetch("/api/v1/admin/llm/test", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as LlmTestResult;
}

export async function getAssistantStatus(): Promise<AssistantStatus> {
  const res = await fetch("/api/v1/assistant/status", { credentials: "include" });
  if (!res.ok) throw await parseError(res, { redirect: false });
  return (await res.json()) as AssistantStatus;
}

type ChatArgs = {
  mode: AssistantMode;
  lang: string;
  pageTopic?: string | null;
  messages: AssistantTurn[];
  /** Agent Space task budget grant; sent with this request only, never stored in the browser. */
  budgetGrant?: string;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
};

/** Parses `event:`/`data:` blocks of the assistant SSE stream; throws ApiError on an `error` event. */
function handleBlock(block: string, onDelta: (t: string) => void): void {
  const event = /^event: (.+)$/m.exec(block)?.[1];
  const data = /^data: (.*)$/m.exec(block)?.[1];
  if (!event || data === undefined) return;
  const payload = JSON.parse(data) as { text?: string; code?: string };
  if (event === "delta" && typeof payload.text === "string") onDelta(payload.text);
  if (event === "error") throw new ApiError(502, payload.code ?? "llm_upstream_error");
}

/** Streams one assistant answer; resolves when the stream ends. */
export async function streamAssistantChat(args: ChatArgs): Promise<void> {
  const res = await fetch("/api/v1/assistant/chat", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: args.mode,
      lang: args.lang,
      page_topic: args.pageTopic ?? undefined,
      messages: args.messages,
      budget_grant: args.budgetGrant || undefined,
    }),
    signal: args.signal,
  });
  if (!res.ok || !res.body) throw await parseError(res, { redirect: false });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) !== -1) {
      handleBlock(buffer.slice(0, cut), args.onDelta);
      buffer = buffer.slice(cut + 2);
    }
  }
}
