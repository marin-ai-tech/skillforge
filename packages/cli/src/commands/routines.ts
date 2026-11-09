import { readFileSync, statSync } from "node:fs";
import { ApiError, type RequestResult } from "../client.ts";
import type { AppContext } from "../context.ts";
import { requireClient, setExit } from "../context.ts";
import { EXIT } from "../exit.ts";
import { parseTypeName } from "./info.ts";

const MAX_FILE = 256 * 1024;

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
    const body = res.data as { error?: unknown; errors?: unknown } | undefined;
    const err = body?.error;
    const list = Array.isArray(body?.errors) ? `: ${(body.errors as string[]).join("; ")}` : "";
    const msg = typeof err === "string" ? `${err}${list}` : `HTTP ${res.status}`;
    return new ApiError(msg, EXIT.VALIDATION, res.status, res.data);
  }
  if (res.status === 429) {
    const body = res.data as { error?: unknown } | undefined;
    return new ApiError(
      typeof body?.error === "string" ? body.error : "budget_exhausted",
      EXIT.VALIDATION,
      res.status,
      res.data,
    );
  }
  return errorFromResult(res);
}

function pathOf(type: string, name: string, suffix = ""): string {
  return `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/routines${suffix}`;
}

type RoutineListItem = {
  routine_id: string;
  name: string | null;
  enabled: number;
  next_run_at: string | null;
  last_run_at: string | null;
  consecutive_failures: number;
  updated_at: string;
  updated_by: string;
};

type RoutineRun = {
  id: number;
  routine_id: string;
  status: string;
  trigger: string;
  triggered_by: string;
  exit_code: number | null;
  timed_out: number;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
};

export async function runRoutinesList(ctx: AppContext, spec: string): Promise<void> {
  const { type, name } = parseSpec(spec);
  const { client } = requireClient(ctx);
  const res = await client.request("GET", pathOf(type, name));
  if (!res.ok) throw fail(res, (r) => client.errorFromResult(r));
  const items = (res.data as { items: RoutineListItem[] }).items;
  if (ctx.out.json) {
    ctx.out.printJson(items);
  } else {
    if (!items.length) ctx.out.write("(no routines)");
    for (const r of items) {
      const state = r.enabled ? `next ${r.next_run_at ?? "-"}` : "disabled";
      ctx.out.write(`${r.routine_id}  ${r.name ?? ""}  ${state}  updated ${r.updated_at}`);
    }
  }
  setExit(EXIT.OK);
}

export type RoutineSaveFlags = { file: string };

export async function runRoutinesSave(
  ctx: AppContext,
  spec: string,
  rt: string,
  flags: RoutineSaveFlags,
): Promise<void> {
  const { type, name } = parseSpec(spec);
  let st;
  try {
    st = statSync(flags.file);
  } catch {
    throw invalid(`file not found: ${flags.file}`);
  }
  if (!st.isFile() || st.size > MAX_FILE) {
    throw invalid(`not a file or exceeds 256 KiB: ${flags.file}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(flags.file, "utf8"));
  } catch {
    throw invalid("file is not valid JSON");
  }
  const { client } = requireClient(ctx);
  const res = await client.request("PUT", pathOf(type, name, `/${rt}`), {
    body: { definition: parsed },
  });
  if (!res.ok) throw fail(res, (r) => client.errorFromResult(r));
  if (ctx.out.json) {
    ctx.out.printJson(res.data);
  } else {
    ctx.out.write(`${type}/${name}: routine ${rt} saved`);
  }
  setExit(EXIT.OK);
}

export async function runRoutinesRun(ctx: AppContext, spec: string, rt: string): Promise<void> {
  const { type, name } = parseSpec(spec);
  const { client } = requireClient(ctx);
  const res = await client.request("POST", pathOf(type, name, `/${rt}/run`), { body: {} });
  if (!res.ok) throw fail(res, (r) => client.errorFromResult(r));
  const run = (res.data as { run: RoutineRun }).run;
  if (ctx.out.json) ctx.out.printJson(run);
  else ctx.out.write(`run ${run.id}: ${run.status} (routine ${run.routine_id})`);
  setExit(EXIT.OK);
}

export async function runRoutinesRuns(ctx: AppContext, spec: string): Promise<void> {
  const { type, name } = parseSpec(spec);
  const { client } = requireClient(ctx);
  const res = await client.request("GET", pathOf(type, name, "/runs"));
  if (!res.ok) throw fail(res, (r) => client.errorFromResult(r));
  const items = (res.data as { items: RoutineRun[] }).items;
  if (ctx.out.json) {
    ctx.out.printJson(items);
  } else {
    if (!items.length) ctx.out.write("(no runs)");
    for (const r of items) {
      const code = r.exit_code === null ? "-" : String(r.exit_code);
      ctx.out.write(
        `${r.id}  ${r.routine_id}  ${r.status}  ${r.trigger}  exit=${code}  ${r.duration_ms ?? 0}ms${r.error ? `  — ${r.error}` : ""}`,
      );
    }
  }
  setExit(EXIT.OK);
}

export async function runRoutinesDisable(ctx: AppContext, spec: string, rt: string): Promise<void> {
  const { type, name } = parseSpec(spec);
  const { client } = requireClient(ctx);
  const res = await client.request("POST", pathOf(type, name, `/${rt}/disable`), { body: {} });
  if (!res.ok) throw fail(res, (r) => client.errorFromResult(r));
  if (ctx.out.json) ctx.out.printJson(res.data);
  else ctx.out.write(`${type}/${name}: routine ${rt} disabled`);
  setExit(EXIT.OK);
}
