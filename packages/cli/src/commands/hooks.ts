import { ApiError, type RequestResult } from "../client.ts";
import type { AppContext } from "../context.ts";
import { requireClient, setExit } from "../context.ts";
import { EXIT } from "../exit.ts";
import { parseTypeName } from "./info.ts";

function invalid(message: string): ApiError {
  return new ApiError(message, EXIT.INVALID_INPUT);
}

function fail(res: RequestResult, errorFromResult: (r: RequestResult) => ApiError): ApiError {
  return errorFromResult(res);
}

type Subscription = {
  id: number;
  artifact_type: string;
  artifact_name: string;
  version: string;
  enabled: number;
  created_by: string;
  created_at: string;
};

type Decision = {
  id: number;
  subscription_id: number;
  event: string;
  matcher: string | null;
  verdict: string;
  exit_code: number | null;
  duration_ms: number | null;
  actor: string;
  context: string | null;
  created_at: string;
};

export async function runHooksList(ctx: AppContext): Promise<void> {
  const { client } = requireClient(ctx);
  const res = await client.request("GET", "/api/v1/hooks/subscriptions");
  if (!res.ok) throw fail(res, (r) => client.errorFromResult(r));
  const items = (res.data as { items: Subscription[] }).items;
  if (ctx.out.json) {
    ctx.out.printJson(items);
  } else {
    if (!items.length) ctx.out.write("(no hook subscriptions)");
    for (const s of items) {
      const state = s.enabled ? "enabled" : "disabled";
      ctx.out.write(
        `${s.id}  ${s.artifact_type}/${s.artifact_name}@${s.version}  ${state}  by ${s.created_by}`,
      );
    }
  }
  setExit(EXIT.OK);
}

export async function runHooksSubscribe(
  ctx: AppContext,
  spec: string,
  flags: { version?: string },
): Promise<void> {
  let ref;
  try {
    ref = parseTypeName(spec);
  } catch (e) {
    throw invalid(e instanceof Error ? e.message : String(e));
  }
  const { client } = requireClient(ctx);
  let version = flags.version;
  if (!version) {
    const art = await client.request(
      "GET",
      `/api/v1/artifacts/${encodeURIComponent(ref.type)}/${encodeURIComponent(ref.name)}`,
    );
    if (!art.ok) throw fail(art, (r) => client.errorFromResult(r));
    version = (art.data as { artifact?: { latest_version?: string } }).artifact?.latest_version;
    if (!version) throw invalid("artifact has no published version; pass --version");
  }
  const res = await client.request("POST", "/api/v1/hooks/subscriptions", {
    body: { type: ref.type, name: ref.name, version },
  });
  if (!res.ok) throw fail(res, (r) => client.errorFromResult(r));
  const sub = (res.data as { subscription: Subscription }).subscription;
  if (ctx.out.json) ctx.out.printJson(sub);
  else ctx.out.write(`subscription ${sub.id}: ${ref.type}/${ref.name}@${sub.version}`);
  setExit(EXIT.OK);
}

export async function runHooksUnsubscribe(ctx: AppContext, idOrSpec: string): Promise<void> {
  const { client } = requireClient(ctx);
  let id = idOrSpec;
  if (!/^\d+$/.test(idOrSpec)) {
    // resolve <type>/<name> to subscription id
    let ref;
    try {
      ref = parseTypeName(idOrSpec);
    } catch (e) {
      throw invalid(e instanceof Error ? e.message : String(e));
    }
    const list = await client.request("GET", "/api/v1/hooks/subscriptions");
    if (!list.ok) throw fail(list, (r) => client.errorFromResult(r));
    const found = (list.data as { items: Subscription[] }).items.find(
      (s) => s.artifact_type === ref.type && s.artifact_name === ref.name,
    );
    if (!found) throw new ApiError(`no subscription for ${idOrSpec}`, EXIT.NOT_FOUND);
    id = String(found.id);
  }
  const res = await client.request("DELETE", `/api/v1/hooks/subscriptions/${id}`);
  if (!res.ok) throw fail(res, (r) => client.errorFromResult(r));
  if (ctx.out.json) ctx.out.printJson({ id: Number(id), deleted: true });
  else ctx.out.write(`subscription ${id} removed`);
  setExit(EXIT.OK);
}

export async function runHooksDecisions(ctx: AppContext, flags: { limit?: string }): Promise<void> {
  const { client } = requireClient(ctx);
  const q = flags.limit ? `?limit=${encodeURIComponent(flags.limit)}` : "";
  const res = await client.request("GET", `/api/v1/hooks/decisions${q}`);
  if (!res.ok) throw fail(res, (r) => client.errorFromResult(r));
  const items = (res.data as { items: Decision[] }).items;
  if (ctx.out.json) {
    ctx.out.printJson(items);
  } else {
    if (!items.length) ctx.out.write("(no hook decisions)");
    for (const d of items) {
      ctx.out.write(
        `${d.id}  ${d.event}  ${d.context ?? "-"}  ${d.verdict}  exit=${d.exit_code ?? "-"}  ${d.duration_ms ?? 0}ms  by ${d.actor}`,
      );
    }
  }
  setExit(EXIT.OK);
}

export async function runHooksEvaluate(
  ctx: AppContext,
  flags: { event: string; tool?: string; input?: string },
): Promise<void> {
  if (!flags.event) throw invalid("--event is required");
  let input: unknown;
  if (flags.input !== undefined) {
    try {
      input = JSON.parse(flags.input);
    } catch {
      throw invalid("--input is not valid JSON");
    }
  }
  const { client } = requireClient(ctx);
  const res = await client.request("POST", "/api/v1/hooks/evaluate", {
    body: { event: flags.event, tool_name: flags.tool, input },
  });
  if (!res.ok) throw fail(res, (r) => client.errorFromResult(r));
  const data = res.data as { decision: string; results: unknown[] };
  if (ctx.out.json) ctx.out.printJson(data);
  else {
    ctx.out.write(`decision: ${data.decision}`);
    for (const r of data.results as Array<Record<string, unknown>>) {
      ctx.out.write(
        `  ${r.artifact}@${r.version}  ${r.event}  ${r.verdict}  exit=${r.exit_code ?? "-"}`,
      );
    }
  }
  setExit(data.decision === "block" ? EXIT.LOCAL_CHANGES : EXIT.OK);
}
