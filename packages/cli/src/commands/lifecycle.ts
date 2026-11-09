import { ApiError, type RequestResult } from "../client.ts";
import type { AppContext } from "../context.ts";
import { requireClient, setExit } from "../context.ts";
import { EXIT } from "../exit.ts";
import { parseTypeName } from "./info.ts";

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

function fail(res: RequestResult, errorFromResult: (r: RequestResult) => ApiError): ApiError {
  if (res.status === 400 || res.status === 422) {
    const err = (res.data as { error?: unknown } | undefined)?.error;
    return new ApiError(
      typeof err === "string" ? err : `HTTP ${res.status}`,
      EXIT.VALIDATION,
      res.status,
      res.data,
    );
  }
  return errorFromResult(res);
}

type CleanupReason = { code: string; text: string; metrics: Record<string, unknown> };
type CleanupItem = {
  type: string;
  name: string;
  status: string;
  since: string;
  reasons: CleanupReason[];
  suggested_action: string;
};

function formatMetrics(metrics: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(metrics ?? {})) {
    if (v == null) continue;
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") {
      parts.push(`${k}=${String(v)}`);
    }
  }
  return parts.join(" ");
}

export async function runLifecycleBoard(ctx: AppContext): Promise<void> {
  const { client, token } = requireClient(ctx);
  if (!token) {
    throw new ApiError("not authenticated; run skillforge login", EXIT.UNAUTHORIZED);
  }
  const res = await client.request("GET", "/api/v1/lifecycle/board");
  if (!res.ok) throw client.errorFromResult(res);
  const data = res.data as { cleanup?: CleanupItem[] };
  const cleanup = data.cleanup ?? [];
  if (ctx.out.json) {
    ctx.out.printJson({ cleanup });
  } else if (cleanup.length === 0) {
    ctx.out.write("Cleanup board is empty.");
  } else {
    for (const item of cleanup) {
      const reasons = item.reasons
        .map((r) => {
          const m = formatMetrics(r.metrics);
          return m ? `${r.code} (${m})` : r.code;
        })
        .join(", ");
      ctx.out.write(
        `${item.type}/${item.name} status=${item.status} suggest=${item.suggested_action} reasons=${reasons}`,
      );
    }
  }
  setExit(EXIT.OK);
}

export type HoldFlags = {
  until?: string;
  reason?: string;
  off?: boolean;
};

export async function runLifecycleHold(
  ctx: AppContext,
  spec: string,
  flags: HoldFlags,
): Promise<void> {
  const { type, name } = parseSpec(spec);
  const { client } = requireClient(ctx);

  if (flags.off) {
    const res = await client.request(
      "DELETE",
      `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/lifecycle-hold`,
    );
    if (!res.ok) throw fail(res, (r) => client.errorFromResult(r));
    const data = res.data as { hold: null };
    if (ctx.out.json) ctx.out.printJson(data);
    else ctx.out.write(`${type}/${name}: hold cleared`);
    setExit(EXIT.OK);
    return;
  }

  if (!flags.until) throw invalid("--until is required (ISO date) unless --off");
  const untilMs = Date.parse(flags.until);
  if (!Number.isFinite(untilMs)) throw invalid("--until must be a valid ISO date");
  if (untilMs <= Date.now()) throw invalid("--until must be in the future");
  if (!flags.reason || flags.reason.trim().length < 5) {
    throw invalid("--reason is required and must be at least 5 characters");
  }

  const res = await client.request(
    "PUT",
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/lifecycle-hold`,
    { body: { until: new Date(untilMs).toISOString(), reason: flags.reason.trim() } },
  );
  if (!res.ok) throw fail(res, (r) => client.errorFromResult(r));
  const data = res.data as {
    hold: { until: string; reason: string; set_by: string; set_at: string };
  };
  if (ctx.out.json) {
    ctx.out.printJson(data);
  } else {
    ctx.out.write(
      `${type}/${name}: hold until ${data.hold.until} by ${data.hold.set_by}: ${data.hold.reason}`,
    );
  }
  setExit(EXIT.OK);
}

export async function runLifecycleSweep(
  ctx: AppContext,
  flags: { dryRun?: boolean },
): Promise<void> {
  const { client } = requireClient(ctx);
  const dry_run = Boolean(flags.dryRun);
  const res = await client.request("POST", "/api/v1/admin/lifecycle/sweep", {
    body: { dry_run },
  });
  if (!res.ok) throw fail(res, (r) => client.errorFromResult(r));
  const data = res.data as {
    aged: number;
    zombied: number;
    revived: number;
    held: number;
    deferred: number;
    dry_run: boolean;
    plan: Array<{ type: string; name: string; from: string; to: string; rule: string }>;
  };
  if (ctx.out.json) {
    ctx.out.printJson(data);
  } else {
    ctx.out.write(
      `sweep dry_run=${data.dry_run} aged=${data.aged} zombied=${data.zombied} revived=${data.revived} held=${data.held} deferred=${data.deferred}`,
    );
    for (const p of data.plan) {
      ctx.out.write(`${p.type}/${p.name}: ${p.from} -> ${p.to} rule=${p.rule}`);
    }
  }
  setExit(EXIT.OK);
}
