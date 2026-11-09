import { ApiError } from "../client.ts";
import type { AppContext } from "../context.ts";
import { requireClient, setExit } from "../context.ts";
import { EXIT } from "../exit.ts";
import { parseTypeName } from "./info.ts";

function invalid(message: string): ApiError {
  return new ApiError(message, EXIT.VALIDATION);
}

function parseSpec(spec: string): { type: string; name: string } {
  try {
    const ref = parseTypeName(spec);
    return { type: ref.type, name: ref.name };
  } catch (e) {
    throw invalid(e instanceof Error ? e.message : String(e));
  }
}

type CommentItem = {
  id: string;
  version: string | null;
  parent_id: string | null;
  author: string;
  body: string;
  ref: string | null;
  mentions: string[];
  created_at: string;
  edited_at: string | null;
  deleted: boolean;
  replies?: CommentItem[];
};

type NotificationItem = {
  id: string;
  kind: string;
  artifact: { type: string; name: string } | null;
  version: string | null;
  actor: string | null;
  title: string;
  text: string | null;
  url: string;
  created_at: string;
  read: boolean;
};

function formatCommentLine(c: CommentItem, indent: string): string {
  if (c.deleted) {
    return `${indent}[deleted] ${c.author} ${c.id}`;
  }
  const ver = c.version ? ` @${c.version}` : "";
  const ref = c.ref ? ` [${c.ref}]` : "";
  const edited = c.edited_at ? " (edited)" : "";
  const body = c.body.replace(/\r?\n/g, " ");
  return `${indent}${c.author}${ver}${ref}${edited}: ${body}`;
}

export async function runComments(
  ctx: AppContext,
  spec: string,
  flags: { version?: string },
): Promise<void> {
  const { type, name } = parseSpec(spec);
  const { client } = requireClient(ctx);
  const qs = new URLSearchParams();
  if (flags.version) qs.set("version", flags.version);
  const q = qs.toString() ? `?${qs}` : "";
  const res = await client.request(
    "GET",
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/comments${q}`,
  );
  if (!res.ok) throw client.errorFromResult(res);
  const data = res.data as { items: CommentItem[]; next_cursor: string | null };
  if (ctx.out.json) {
    ctx.out.printJson(data);
  } else {
    if (data.items.length === 0) {
      ctx.out.write("No comments.");
    } else {
      for (const root of data.items) {
        ctx.out.write(formatCommentLine(root, ""));
        for (const reply of root.replies ?? []) {
          ctx.out.write(formatCommentLine(reply, "  "));
        }
      }
    }
  }
  setExit(EXIT.OK);
}

export async function runComment(
  ctx: AppContext,
  spec: string,
  flags: { body?: string; version?: string; reply?: string },
): Promise<void> {
  const { type, name } = parseSpec(spec);
  const body = flags.body;
  if (body === undefined || body.trim() === "") {
    throw invalid("--body is required and must not be empty");
  }
  const payload: Record<string, unknown> = { body };
  if (flags.version !== undefined) payload.version = flags.version;
  if (flags.reply !== undefined) payload.parent_id = flags.reply;

  const { client } = requireClient(ctx);
  const res = await client.request(
    "POST",
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/comments`,
    { body: payload },
  );
  if (!res.ok) throw client.errorFromResult(res);
  if (ctx.out.json) {
    ctx.out.printJson(res.data);
  } else {
    const data = res.data as { comment: CommentItem };
    ctx.out.write(`comment ${data.comment.id} by ${data.comment.author}`);
  }
  setExit(EXIT.OK);
}

export async function runNotifications(
  ctx: AppContext,
  flags: { unread?: boolean },
): Promise<void> {
  const { client } = requireClient(ctx);
  const qs = new URLSearchParams();
  if (flags.unread) qs.set("unread", "1");
  const q = qs.toString() ? `?${qs}` : "";
  const res = await client.request("GET", `/api/v1/me/notifications${q}`);
  if (!res.ok) throw client.errorFromResult(res);
  const data = res.data as {
    items: NotificationItem[];
    unread_count: number;
    next_cursor: string | null;
  };
  if (ctx.out.json) {
    ctx.out.printJson(data);
  } else {
    ctx.out.write(`unread: ${data.unread_count}`);
    for (const n of data.items) {
      const art = n.artifact ? ` ${n.artifact.type}/${n.artifact.name}` : "";
      const mark = n.read ? "" : "*";
      ctx.out.write(`${mark}[${n.kind}] ${n.title}${art} (${n.id})`);
    }
  }
  setExit(EXIT.OK);
}

export async function runNotificationsRead(
  ctx: AppContext,
  flags: { all?: boolean; ids: string[] },
): Promise<void> {
  const { client } = requireClient(ctx);
  let body: Record<string, unknown>;
  if (flags.all) {
    body = { all: true };
  } else if (flags.ids.length > 0) {
    body = { ids: flags.ids };
  } else {
    throw invalid("notifications read requires --all or at least one id");
  }
  const res = await client.request("POST", "/api/v1/me/notifications/read", { body });
  if (!res.ok) throw client.errorFromResult(res);
  if (ctx.out.json) {
    ctx.out.printJson(res.data);
  } else {
    const data = res.data as { updated: number };
    ctx.out.write(`updated ${data.updated}`);
  }
  setExit(EXIT.OK);
}

export async function runWatch(
  ctx: AppContext,
  spec: string,
  flags: { off?: boolean },
): Promise<void> {
  const { type, name } = parseSpec(spec);
  const watching = !flags.off;
  const { client } = requireClient(ctx);
  const res = await client.request(
    "PUT",
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/watch`,
    { body: { watching } },
  );
  if (!res.ok) throw client.errorFromResult(res);
  if (ctx.out.json) {
    ctx.out.printJson(res.data);
  } else {
    const data = res.data as { watching: boolean };
    ctx.out.write(data.watching ? "watching" : "not watching");
  }
  setExit(EXIT.OK);
}
