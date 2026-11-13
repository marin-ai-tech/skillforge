import { request } from "node:http";
import { Readable } from "node:stream";

/**
 * The Agent Space budget broker (llm-budget-broker). When SKILLFORGE_BUDGET_SOCKET is set, every model call goes to
 * `POST /v1/chat/completions` on that Unix socket instead of the provider. The broker holds the provider key and the
 * task budgets; SkillForge sends only the provider name and, when it has one, the budget grant. The wire protocol is
 * the broker's (agent-space/src/model/skillforge-serve.ts), kept as is.
 */
export const BROKER_PATH = "/v1/chat/completions";
export const PROVIDER_HEADER = "x-agent-space-provider";
export const GRANT_HEADER = "x-agent-space-grant";

export type BrokerProvider = "deepseek" | "openai" | "gemini";

/** Provider API addresses the broker routes: origin and the accepted paths (without a trailing slash). */
const PROVIDERS: ReadonlyArray<{
  origin: string;
  paths: readonly string[];
  provider: BrokerProvider;
}> = [
  { origin: "https://api.deepseek.com", paths: ["", "/v1"], provider: "deepseek" },
  { origin: "https://api.openai.com", paths: ["/v1"], provider: "openai" },
  {
    origin: "https://generativelanguage.googleapis.com",
    paths: ["/v1beta/openai"],
    provider: "gemini",
  },
];

/** The broker's provider for an API address, or null for any other address (also with credentials, query or hash). */
export function brokerProvider(baseUrl: string): BrokerProvider | null {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  const path = url.pathname.replace(/\/$/, "");
  return PROVIDERS.find((p) => p.origin === url.origin && p.paths.includes(path))?.provider ?? null;
}

const GRANT_RE = /^as_sf_[A-Za-z0-9_-]{43}$/;

/** A task budget grant issued by Agent Space: `as_sf_` and 43 URL-safe characters. A bearer secret. */
export function isBudgetGrant(value: unknown): value is string {
  return typeof value === "string" && GRANT_RE.test(value);
}

/** The broker's answer as a fetch Response, so the client reads it exactly like a provider's. */
export function brokerFetch(
  socketPath: string,
  provider: BrokerProvider,
  body: string,
  signal: AbortSignal,
  grant?: string,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath,
        path: BROKER_PATH,
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
          [PROVIDER_HEADER]: provider,
          ...(grant ? { [GRANT_HEADER]: grant } : {}),
        },
      },
      (res) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (typeof value === "string") headers.set(key, value);
        }
        resolve(
          new Response(Readable.toWeb(res) as ReadableStream, {
            status: res.statusCode ?? 502,
            headers,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
