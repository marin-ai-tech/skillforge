import readline from "node:readline";
import { resolveRegistry } from "../config.ts";
import type { AppContext } from "../context.ts";
import { EXIT } from "../exit.ts";

function extractErrorMessage(status: number, text: string): string {
  try {
    const body = JSON.parse(text) as { error?: unknown; message?: unknown };
    if (typeof body.error === "string") return body.error;
    if (body.error && typeof body.error === "object" && body.error !== null) {
      const err = body.error as { message?: unknown };
      if (typeof err.message === "string") return err.message;
    }
    if (typeof body.message === "string") return body.message;
  } catch {
    /* ignore */
  }
  return `HTTP ${status}`;
}

function writeRpcLine(obj: unknown): void {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function parseLineId(trimmed: string): { id: unknown; hasId: boolean } {
  try {
    const msg = JSON.parse(trimmed) as { id?: unknown };
    const hasId = Object.prototype.hasOwnProperty.call(msg, "id");
    return { hasId, id: hasId ? (msg.id ?? null) : null };
  } catch {
    return { id: null, hasId: false };
  }
}

function writeFetchError(hasId: boolean, id: unknown, msg: string): void {
  if (hasId) {
    writeRpcLine({ jsonrpc: "2.0", id, error: { code: -32001, message: msg } });
  } else {
    process.stderr.write(`mcp bridge: ${msg}\n`);
  }
}

async function writeHttpResult(res: Response, hasId: boolean, id: unknown): Promise<void> {
  if (res.status === 202) return;

  const text = await res.text();

  if (res.status === 200) {
    if (!text.trim()) return;
    try {
      writeRpcLine(JSON.parse(text));
    } catch {
      process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
    }
    return;
  }

  if (hasId && (res.status === 401 || res.status === 403 || res.status >= 400)) {
    writeRpcLine({
      jsonrpc: "2.0",
      id,
      error: { code: -32001, message: extractErrorMessage(res.status, text) },
    });
    return;
  }

  process.stderr.write(`mcp bridge: HTTP ${res.status}\n`);
}

async function forwardLine(baseUrl: string, token: string, line: string): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;

  const { id, hasId } = parseLineId(trimmed);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      },
      body: trimmed,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeFetchError(hasId, id, msg);
    return;
  }

  await writeHttpResult(res, hasId, id);
}

export async function runMcp(ctx: AppContext): Promise<void> {
  const resolved = resolveRegistry({
    url: ctx.globals.url,
    token: ctx.globals.token,
  });

  if (!resolved) {
    ctx.out.error(
      "No registry URL. Set --url, SKILLFORGE_URL, or run skillforge login --url <base>",
    );
    process.exitCode = EXIT.UNREACHABLE;
    return;
  }

  if (!resolved.token) {
    ctx.out.error("No API token. Set --token, SKILLFORGE_TOKEN, or run skillforge login");
    process.exitCode = EXIT.UNAUTHORIZED;
    return;
  }

  const baseUrl = resolved.url.replace(/\/$/, "");
  const token = resolved.token;

  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    await forwardLine(baseUrl, token, line);
  }

  process.exitCode = EXIT.OK;
}
