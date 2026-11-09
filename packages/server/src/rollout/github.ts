/**
 * Minimal GitHub REST client for pr-rollout. The base URL and token come from the operator's environment only;
 * redirects are not followed, so the token never reaches another host.
 */
const TIMEOUT_MS = 20_000;

export class GitHubError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type GitHub = {
  request<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }>;
};

export function gitHubClient(apiUrl: string, token: string): GitHub {
  const base = apiUrl.replace(/\/+$/, "");
  return {
    async request<T>(method: string, path: string, body?: unknown) {
      const res = await fetch(`${base}${path}`, {
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const text = await res.text();
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      return { status: res.status, data: data as T };
    },
  };
}

/** The request must succeed; otherwise a short, token-free reason. */
export async function expectOk<T>(
  gh: GitHub,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const r = await gh.request<T & { message?: string }>(method, path, body);
  if (r.status < 200 || r.status >= 300) {
    const message = typeof r.data?.message === "string" ? r.data.message.slice(0, 200) : "";
    throw new GitHubError(
      r.status,
      `${method} ${path.split("?")[0]}: ${r.status} ${message}`.trim(),
    );
  }
  return r.data;
}

/** Path segments of a repository-relative file path, each URL-encoded. */
export function contentsPath(repo: string, file: string): string {
  return `/repos/${repo}/contents/${file.split("/").map(encodeURIComponent).join("/")}`;
}
