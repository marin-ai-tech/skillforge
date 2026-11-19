import { EXIT } from "../exit.ts";
import type { AppContext } from "../context.ts";
import { requireClient, setExit } from "../context.ts";
import { ApiError, type RequestResult, type SkillforgeClient } from "../client.ts";

export type NewsFlags = {
  since?: string;
  unread?: boolean;
  kind?: string;
  limit?: string;
};

type NewsRef = { type: string; name: string };

type NewsItem = {
  id: string;
  kind: string;
  at: string;
  actor?: string | null;
  artifact: NewsRef | null;
  version: string | null;
  from: string | null;
  to: string | null;
  replacement?: NewsRef | null;
  post: { title: string; important?: boolean } | null;
};

type NewsList = { items?: NewsItem[]; pinned?: NewsItem[] };

/** The registry refuses REST to an MCP token (lessons #107, #108); the CLI says what to use instead. */
const MCP_TOKEN_MESSAGE =
  "skillforge news needs a personal API token; an MCP token works only for agents. Create a personal token on the API tokens page (/me/tokens) or run skillforge login";

const TYPE_LABELS: Record<string, string> = {
  settings: "settings profile",
  "mcp-server": "MCP server",
};

function invalid(message: string): ApiError {
  return new ApiError(message, EXIT.INVALID_INPUT);
}

/** An MCP token gets a message on stderr only (no body), so `--json` keeps stdout clean. */
function newsError(client: SkillforgeClient, res: RequestResult): ApiError {
  const code = (res.data as { error?: unknown } | undefined)?.error;
  if (res.status === 403 && code === "mcp_token_forbidden") {
    return new ApiError(MCP_TOKEN_MESSAGE, EXIT.UNAUTHORIZED, res.status);
  }
  return client.errorFromResult(res);
}

export function newsQuery(flags: NewsFlags): string {
  const p = new URLSearchParams();
  if (flags.since !== undefined) {
    if (!flags.since.trim() || Number.isNaN(Date.parse(flags.since))) {
      throw invalid(
        "--since must be an ISO 8601 date or date-time, e.g. 2026-11-01 or 2026-11-01T09:00:00Z",
      );
    }
    p.set("since", flags.since);
  }
  // Boolean flags go to the API as `true`, never `1`: the server refuses other values.
  if (flags.unread) p.set("unread", "true");
  if (flags.kind !== undefined) {
    const kinds = flags.kind
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    if (kinds.length === 0) throw invalid("--kind needs one or more kinds, e.g. new_artifact,post");
    p.set("kind", kinds.join(","));
  }
  if (flags.limit !== undefined) {
    if (!/^[1-9]\d*$/.test(flags.limit)) throw invalid("--limit must be a positive whole number");
    p.set("limit", flags.limit);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD HH:MM` in the terminal's local time. */
export function newsDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A status change in words, as the web feed says it. */
function statusText(item: NewsItem, name: string): string {
  if (item.to === "retired") {
    return item.replacement
      ? `${name} retired, replacement — ${item.replacement.name}`
      : `${name} retired`;
  }
  if (item.to === "zombie") return `${name} became zombie`;
  if (item.to === "active") return `${name} is active again`;
  return `${name}: ${item.from ?? ""} → ${item.to ?? ""}`;
}

/** English text of a news item, the same templates as the web feed. */
export function newsText(item: NewsItem): string {
  const name = item.artifact?.name ?? "";
  switch (item.kind) {
    case "post":
      return item.post?.title ?? "";
    case "new_artifact": {
      const type = item.artifact?.type ?? "";
      return `New ${TYPE_LABELS[type] ?? type} ${name}`;
    }
    case "new_version":
      return `${name} ${item.version ?? ""} — stable version`;
    case "status_change":
      return statusText(item, name);
    default:
      return name || item.kind;
  }
}

export function newsLink(base: string, item: NewsItem): string {
  const root = base.replace(/\/$/, "");
  if (item.artifact) {
    return `${root}/artifacts/${encodeURIComponent(item.artifact.type)}/${encodeURIComponent(item.artifact.name)}`;
  }
  return `${root}/news`;
}

/** Pinned posts first, then the feed; an item listed in both is shown once. */
function rowsOf(data: NewsList): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const item of [...(data.pinned ?? []), ...(data.items ?? [])]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

export async function runNews(ctx: AppContext, flags: NewsFlags): Promise<void> {
  const query = newsQuery(flags);
  const { client, url } = requireClient(ctx);
  const res = await client.request("GET", `/api/v1/news${query}`);
  if (!res.ok) throw newsError(client, res);
  if (ctx.out.json) {
    // The API answer unchanged: scripts read it as is.
    ctx.out.printJson(res.data);
    setExit(EXIT.OK);
    return;
  }
  const items = rowsOf(res.data as NewsList);
  if (items.length === 0) {
    ctx.out.write(flags.unread ? "No unread news." : "No news.");
  } else {
    const rows = items.map((i) => [newsDate(i.at), i.kind, newsText(i), newsLink(url, i)]);
    ctx.out.printTable(["date", "kind", "text", "link"], rows);
  }
  setExit(EXIT.OK);
}

export async function runNewsSeen(ctx: AppContext): Promise<void> {
  const { client } = requireClient(ctx);
  const res = await client.request("POST", "/api/v1/news/seen", { body: {} });
  if (!res.ok) throw newsError(client, res);
  if (ctx.out.json) ctx.out.printJson(res.data ?? { ok: true });
  else ctx.out.write("News marked as seen.");
  setExit(EXIT.OK);
}
