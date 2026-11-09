import { readFileSync, statSync } from "node:fs";
import { ApiError, type RequestResult } from "../client.ts";
import type { AppContext } from "../context.ts";
import { requireClient, setExit } from "../context.ts";
import { EXIT } from "../exit.ts";
import { parseTypeName } from "./info.ts";

const MAX_FILE = 256 * 1024;
const WAIT_MS = 10 * 60 * 1000;
const POLL_MS = 500;

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
  return errorFromResult(res);
}

function pathOf(type: string, name: string, suffix = ""): string {
  return `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/workflows${suffix}`;
}

type WorkflowListItem = {
  workflow_id: string;
  name: string | null;
  updated_at: string;
  updated_by: string;
};

type WorkflowRun = {
  id: number;
  workflow_id: string;
  status: string;
  input: unknown;
  requested_by: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  steps?: Array<{
    step_id: string;
    status: string;
    exit_code: number | null;
    timed_out: number;
    next_step: string | null;
    duration_ms: number | null;
    error: string | null;
  }>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runWorkflowsList(ctx: AppContext, spec: string): Promise<void> {
  const { type, name } = parseSpec(spec);
  const { client } = requireClient(ctx);
  const res = await client.request("GET", pathOf(type, name));
  if (!res.ok) throw fail(res, (r) => client.errorFromResult(r));
  const items = (res.data as { items: WorkflowListItem[] }).items;
  if (ctx.out.json) {
    ctx.out.printJson(items);
  } else {
    if (!items.length) ctx.out.write("(no workflows)");
    for (const w of items) {
      ctx.out.write(
        `${w.workflow_id}  ${w.name ?? ""}  updated ${w.updated_at} by ${w.updated_by}`,
      );
    }
  }
  setExit(EXIT.OK);
}

export type WorkflowSaveFlags = { file: string };

export async function runWorkflowsSave(
  ctx: AppContext,
  spec: string,
  wf: string,
  flags: WorkflowSaveFlags,
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
  const res = await client.request("PUT", pathOf(type, name, `/${wf}`), {
    body: { definition: parsed },
  });
  if (!res.ok) throw fail(res, (r) => client.errorFromResult(r));
  if (ctx.out.json) {
    ctx.out.printJson(res.data);
  } else {
    ctx.out.write(`${type}/${name}: workflow ${wf} saved`);
  }
  setExit(EXIT.OK);
}

export type WorkflowRunFlags = { input?: string; wait?: boolean };

export async function runWorkflowsRun(
  ctx: AppContext,
  spec: string,
  wf: string,
  flags: WorkflowRunFlags,
): Promise<void> {
  const { type, name } = parseSpec(spec);
  let input: unknown;
  if (flags.input !== undefined) {
    try {
      input = JSON.parse(flags.input);
    } catch {
      throw invalid("--input must be valid JSON");
    }
  }
  const { client } = requireClient(ctx);
  const res = await client.request("POST", pathOf(type, name, `/${wf}/runs`), {
    body: input === undefined ? {} : { input },
  });
  if (!res.ok) throw fail(res, (r) => client.errorFromResult(r));
  const run = (res.data as { run: WorkflowRun }).run;
  if (!flags.wait) {
    if (ctx.out.json) ctx.out.printJson(run);
    else ctx.out.write(`run ${run.id}: ${run.status} (workflow ${run.workflow_id})`);
    setExit(EXIT.OK);
    return;
  }
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const r = await client.request("GET", pathOf(type, name, `/runs/${run.id}`));
    if (!r.ok) throw fail(r, (x) => client.errorFromResult(x));
    const cur = (r.data as { run: WorkflowRun }).run;
    if (["done", "failed", "cancelled"].includes(cur.status)) {
      if (ctx.out.json) ctx.out.printJson(cur);
      else ctx.out.write(`run ${cur.id}: ${cur.status}${cur.error ? ` — ${cur.error}` : ""}`);
      setExit(cur.status === "done" ? EXIT.OK : EXIT.VALIDATION);
      return;
    }
    if (Date.now() > deadline) {
      ctx.out.error(`run ${cur.id}: still ${cur.status} after ${WAIT_MS / 60000}m`);
      setExit(EXIT.VALIDATION);
      return;
    }
    await sleep(POLL_MS);
  }
}

export async function runWorkflowsTrace(
  ctx: AppContext,
  spec: string,
  runId: string,
): Promise<void> {
  const { type, name } = parseSpec(spec);
  const { client } = requireClient(ctx);
  const res = await client.request("GET", pathOf(type, name, `/runs/${runId}`));
  if (!res.ok) throw fail(res, (r) => client.errorFromResult(r));
  const run = (res.data as { run: WorkflowRun }).run;
  if (ctx.out.json) {
    ctx.out.printJson(run);
  } else {
    ctx.out.write(
      `run ${run.id} (${run.workflow_id}): ${run.status}${run.error ? ` — ${run.error}` : ""}`,
    );
    for (const s of run.steps ?? []) {
      const code = s.exit_code === null ? "-" : String(s.exit_code);
      ctx.out.write(
        `  ${s.step_id}  ${s.status}  exit=${code}  ${s.duration_ms ?? 0}ms  -> ${s.next_step ?? "-"}`,
      );
    }
  }
  setExit(EXIT.OK);
}
