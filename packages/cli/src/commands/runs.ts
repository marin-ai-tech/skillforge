import { ApiError, type RequestResult } from "../client.ts";
import type { AppContext } from "../context.ts";
import { requireClient, setExit } from "../context.ts";
import { EXIT } from "../exit.ts";
import { parseTypeName } from "./info.ts";

/** `skillforge runs list|show` over the read-only run-outputs API (run-artifact-storage). */

function invalid(message: string): ApiError {
  return new ApiError(message, EXIT.INVALID_INPUT);
}

function parseSpec(spec: string): { type: string; name: string } {
  try {
    const ref = parseTypeName(spec);
    return { type: ref.type, name: ref.name };
  } catch (e) {
    throw invalid(e instanceof Error ? e.message : String(e));
  }
}

function pathOf(type: string, name: string, suffix = ""): string {
  return `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/run-outputs${suffix}`;
}

function parseId(raw: string): string {
  if (!/^[1-9]\d{0,15}$/u.test(raw)) throw invalid("<id> must be a positive integer");
  return raw;
}

type RunOutput = {
  id: number;
  run_id: string;
  run_kind: string;
  version: string;
  stream: string;
  name: string | null;
  sha256: string;
  size: number;
  truncated: boolean;
  exit_code: number | null;
  timed_out: boolean;
  duration_ms: number | null;
  created_by: string;
  created_at: string;
  expires_at: string | null;
};

export type RunsListFlags = { version?: string; run?: string; kind?: string; limit?: string };

export async function runRunsList(
  ctx: AppContext,
  spec: string,
  flags: RunsListFlags,
): Promise<void> {
  const { type, name } = parseSpec(spec);
  if (flags.limit !== undefined && !/^[1-9]\d*$/u.test(flags.limit)) {
    throw invalid("--limit must be a positive integer");
  }
  const query = new URLSearchParams();
  if (flags.version) query.set("version", flags.version);
  if (flags.run) query.set("run_id", flags.run);
  if (flags.kind) query.set("kind", flags.kind);
  if (flags.limit) query.set("limit", flags.limit);
  const qs = query.toString();
  const { client } = requireClient(ctx);
  const res = await client.request("GET", pathOf(type, name, qs ? `?${qs}` : ""));
  if (!res.ok) throw client.errorFromResult(res);
  const data = res.data as { items: RunOutput[] };
  if (ctx.out.json) {
    ctx.out.printJson(data);
  } else if (!data.items.length) {
    ctx.out.write("No run outputs.");
  } else {
    for (const o of data.items) {
      const exit = o.timed_out ? "timeout" : o.exit_code === null ? "-" : String(o.exit_code);
      const trunc = o.truncated ? " truncated" : "";
      ctx.out.write(
        `${o.id}  ${o.run_id}  ${o.stream}  exit=${exit}  size=${o.size}${trunc}  ${o.created_at}`,
      );
    }
  }
  setExit(EXIT.OK);
}

export type RunsShowFlags = { raw?: boolean };

/** Error body of a raw (Buffer) response, parsed so errorFromResult maps it like JSON. */
function rawError(res: RequestResult): RequestResult {
  const text = Buffer.isBuffer(res.data) ? res.data.toString("utf8") : "";
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { ...res, data, text };
}

export async function runRunsShow(
  ctx: AppContext,
  spec: string,
  rawId: string,
  flags: RunsShowFlags,
): Promise<void> {
  const { type, name } = parseSpec(spec);
  const id = parseId(rawId);
  const { client } = requireClient(ctx);
  if (flags.raw) {
    const res = await client.request("GET", pathOf(type, name, `/${id}/content`), { raw: true });
    if (!res.ok) throw client.errorFromResult(rawError(res));
    process.stdout.write(res.data as Buffer);
    setExit(EXIT.OK);
    return;
  }
  const res = await client.request("GET", pathOf(type, name, `/${id}`));
  if (!res.ok) throw client.errorFromResult(res);
  const data = res.data as { output: RunOutput };
  if (ctx.out.json) {
    ctx.out.printJson(data);
  } else {
    const o = data.output;
    ctx.out.write(`id: ${o.id}`);
    ctx.out.write(`run: ${o.run_id} (${o.run_kind})`);
    ctx.out.write(`version: ${o.version}`);
    ctx.out.write(`stream: ${o.stream}${o.name ? `  name: ${o.name}` : ""}`);
    ctx.out.write(
      `exit: ${o.exit_code ?? "-"}  timed_out: ${o.timed_out}  duration_ms: ${o.duration_ms ?? "-"}`,
    );
    ctx.out.write(`size: ${o.size}  truncated: ${o.truncated}  sha256: ${o.sha256}`);
    ctx.out.write(
      `created: ${o.created_at} by ${o.created_by}  expires: ${o.expires_at ?? "never"}`,
    );
  }
  setExit(EXIT.OK);
}
