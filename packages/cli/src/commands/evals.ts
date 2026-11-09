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
    const body = res.data as { error?: unknown; detail?: unknown } | undefined;
    const err = body?.error;
    const detail = typeof body?.detail === "string" ? body.detail : undefined;
    const msg =
      typeof err === "string" ? (detail ? `${err}: ${detail}` : err) : `HTTP ${res.status}`;
    return new ApiError(msg, EXIT.VALIDATION, res.status, res.data);
  }
  return errorFromResult(res);
}

function pathOf(type: string, name: string, suffix = ""): string {
  return `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/evals${suffix}`;
}

type EvalCase = {
  id: string;
  kind: string;
  prompt: string;
  holdout?: boolean;
  expect_trigger?: boolean;
  checks?: Array<{ type: string; value: string; ci?: boolean }>;
};

type Suite = {
  gate: string;
  cases: EvalCase[];
  runners: Array<{ id: string; label?: string }>;
};

type EvalRun = {
  id: string;
  kind: string;
  version: string;
  against: string | null;
  runner: string | null;
  scope: string;
  status: string;
  requested_by: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  errors: number;
  error: string | null;
  summary: Record<string, unknown> | null;
  results?: unknown[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runEvalsShow(ctx: AppContext, spec: string): Promise<void> {
  const { type, name } = parseSpec(spec);
  const { client } = requireClient(ctx);
  const res = await client.request("GET", pathOf(type, name));
  if (!res.ok) throw fail(res, (r) => client.errorFromResult(r));
  const data = res.data as Suite;
  if (ctx.out.json) {
    ctx.out.printJson(data);
  } else {
    ctx.out.write(`gate: ${data.gate}`);
    ctx.out.write(`runners: ${(data.runners ?? []).map((r) => r.id).join(", ") || "(none)"}`);
    if (!data.cases.length) {
      ctx.out.write("cases: (empty)");
    } else {
      for (const c of data.cases) {
        const hold = c.holdout ? " holdout" : "";
        ctx.out.write(`${c.id}  ${c.kind}${hold}  ${c.prompt.replace(/\r?\n/g, " ").slice(0, 80)}`);
      }
    }
  }
  setExit(EXIT.OK);
}

export type EvalsPushFlags = { file?: string; gate?: string };

function readSuiteFile(filePath: string): Record<string, unknown> {
  let st;
  try {
    st = statSync(filePath);
  } catch {
    throw invalid(`file not found: ${filePath}`);
  }
  if (!st.isFile()) throw invalid(`not a file: ${filePath}`);
  if (st.size > MAX_FILE) throw invalid(`file exceeds 256 KiB (${st.size} bytes)`);

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    throw invalid(`cannot read file: ${filePath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw invalid("file is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw invalid("file must be a JSON object with cases");
  }
  return { ...(parsed as Record<string, unknown>) };
}

export async function runEvalsPush(
  ctx: AppContext,
  spec: string,
  flags: EvalsPushFlags,
): Promise<void> {
  const { type, name } = parseSpec(spec);
  if (!flags.file) throw invalid("--file is required");
  if (flags.gate !== undefined && flags.gate !== "required" && flags.gate !== "off") {
    throw invalid("--gate must be required or off");
  }

  const body = readSuiteFile(flags.file);
  if (flags.gate !== undefined) body.gate = flags.gate;

  const { client } = requireClient(ctx);
  const res = await client.request("PUT", pathOf(type, name), { body });
  if (!res.ok) throw fail(res, (r) => client.errorFromResult(r));
  const data = res.data as Suite;
  if (ctx.out.json) {
    ctx.out.printJson(data);
  } else {
    ctx.out.write(`${type}/${name}: suite saved gate=${data.gate} cases=${data.cases.length}`);
  }
  setExit(EXIT.OK);
}

export type EvalsRunFlags = {
  kind?: string;
  version?: string;
  against?: string;
  runner?: string;
  scope?: string;
  wait?: boolean;
};

function validateEvalsRunFlags(flags: EvalsRunFlags): string {
  const kind = flags.kind;
  if (kind !== "trigger" && kind !== "compare" && kind !== "ablation") {
    throw invalid("--kind must be trigger, compare, or ablation");
  }
  if (!flags.version) throw invalid("--version is required");
  if (flags.scope !== undefined && flags.scope !== "all" && flags.scope !== "holdout") {
    throw invalid("--scope must be all or holdout");
  }
  return kind;
}

function buildEvalsRunBody(flags: EvalsRunFlags, kind: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    kind,
    version: flags.version,
  };
  if (flags.against !== undefined) body.against = flags.against;
  if (flags.runner !== undefined) body.runner = flags.runner;
  if (flags.scope !== undefined) body.scope = flags.scope;
  return body;
}

async function waitEvalRun(
  client: ReturnType<typeof requireClient>["client"],
  type: string,
  name: string,
  run: EvalRun,
): Promise<EvalRun> {
  const deadline = Date.now() + WAIT_MS;
  let current = run;
  while (current.status === "queued" || current.status === "running") {
    if (Date.now() > deadline) {
      throw new ApiError("timed out waiting for eval run", EXIT.VALIDATION);
    }
    await sleep(POLL_MS);
    const st = await client.request(
      "GET",
      pathOf(type, name, `/runs/${encodeURIComponent(current.id)}`),
    );
    if (!st.ok) throw fail(st, (r) => client.errorFromResult(r));
    current = (st.data as { run: EvalRun }).run;
  }
  return current;
}

function printEvalRun(ctx: AppContext, run: EvalRun): void {
  ctx.out.write(
    `${run.id} status=${run.status} kind=${run.kind} version=${run.version} errors=${run.errors}`,
  );
  if (run.summary) {
    const s = run.summary;
    if (typeof s.accuracy === "number") ctx.out.write(`accuracy=${s.accuracy}`);
    if (typeof s.wins_candidate === "number") {
      ctx.out.write(
        `wins_candidate=${s.wins_candidate} wins_baseline=${s.wins_baseline} ties=${s.ties}`,
      );
    }
    if (typeof s.uplift === "number" || typeof s.tasks === "number") {
      ctx.out.write(`tasks=${s.tasks} uplift=${s.uplift}`);
    }
  }
  if (run.error) ctx.out.write(`error=${run.error}`);
}

export async function runEvalsRun(
  ctx: AppContext,
  spec: string,
  flags: EvalsRunFlags,
): Promise<void> {
  const { type, name } = parseSpec(spec);
  const kind = validateEvalsRunFlags(flags);
  const body = buildEvalsRunBody(flags, kind);

  const { client } = requireClient(ctx);
  const res = await client.request("POST", pathOf(type, name, "/runs"), { body });
  if (!res.ok) throw fail(res, (r) => client.errorFromResult(r));
  let run = (res.data as { run: EvalRun }).run;

  if (!flags.wait) {
    if (ctx.out.json) ctx.out.printJson({ run });
    else ctx.out.write(run.id);
    setExit(EXIT.OK);
    return;
  }

  run = await waitEvalRun(client, type, name, run);

  if (ctx.out.json) {
    ctx.out.printJson({ run });
  } else {
    printEvalRun(ctx, run);
  }
  setExit(run.status === "done" ? EXIT.OK : EXIT.VALIDATION);
}

export async function runEvalsRuns(ctx: AppContext, spec: string): Promise<void> {
  const { type, name } = parseSpec(spec);
  const { client } = requireClient(ctx);
  const res = await client.request("GET", pathOf(type, name, "/runs"));
  if (!res.ok) throw fail(res, (r) => client.errorFromResult(r));
  const data = res.data as { items: EvalRun[] };
  if (ctx.out.json) {
    ctx.out.printJson(data);
  } else if (!data.items.length) {
    ctx.out.write("No runs.");
  } else {
    for (const r of data.items) {
      ctx.out.write(`${r.id}  ${r.kind}  ${r.version}  ${r.status}  errors=${r.errors}`);
    }
  }
  setExit(EXIT.OK);
}

export type EvalBatch = {
  id: number;
  version: string;
  kind: string;
  scope: string;
  runners: string[];
  status: string;
  requested_by: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  summary: { saturation?: { saturated?: boolean; evaluated_runs?: number } } | null;
  error: string | null;
};

export type EvalsBatchFlags = {
  kind?: string;
  version?: string;
  against?: string;
  runner?: string;
  scope?: string;
  wait?: boolean;
};

function batchBodyOf(flags: EvalsBatchFlags): Record<string, unknown> {
  const kind = flags.kind;
  if (kind !== "trigger" && kind !== "compare" && kind !== "ablation") {
    throw invalid("--kind must be trigger, compare, or ablation");
  }
  if (!flags.version) throw invalid("--version is required");
  if (flags.scope !== undefined && flags.scope !== "all" && flags.scope !== "holdout") {
    throw invalid("--scope must be all or holdout");
  }
  const body: Record<string, unknown> = { kind, version: flags.version };
  if (flags.against !== undefined) body.against = flags.against;
  if (flags.scope !== undefined) body.scope = flags.scope;
  if (flags.runner === undefined) return body;
  const runners = flags.runner
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  if (!runners.length) throw invalid("--runner: empty list of runtimes");
  body.runners = runners;
  return body;
}

async function waitBatch(
  client: ReturnType<typeof requireClient>["client"],
  type: string,
  name: string,
  batch: EvalBatch,
): Promise<EvalBatch> {
  const deadline = Date.now() + WAIT_MS;
  let b = batch;
  while (b.status === "queued" || b.status === "running") {
    if (Date.now() > deadline) {
      throw new ApiError("timed out waiting for eval batch", EXIT.VALIDATION);
    }
    await sleep(POLL_MS);
    const st = await client.request(
      "GET",
      pathOf(type, name, `/batches/${encodeURIComponent(b.id)}`),
    );
    if (!st.ok) throw fail(st, (r) => client.errorFromResult(r));
    b = (st.data as { batch: EvalBatch }).batch;
  }
  return b;
}

export async function runEvalsBatch(
  ctx: AppContext,
  spec: string,
  flags: EvalsBatchFlags,
): Promise<void> {
  const { type, name } = parseSpec(spec);
  const { client } = requireClient(ctx);
  const res = await client.request("POST", pathOf(type, name, "/batches"), {
    body: batchBodyOf(flags),
  });
  if (!res.ok) throw fail(res, (r) => client.errorFromResult(r));
  const created = (res.data as { batch: EvalBatch }).batch;
  if (!flags.wait) {
    if (ctx.out.json) ctx.out.printJson({ batch: created });
    else ctx.out.write(String(created.id));
    setExit(EXIT.OK);
    return;
  }
  const batch = await waitBatch(client, type, name, created);
  if (ctx.out.json) {
    ctx.out.printJson({ batch });
  } else {
    ctx.out.write(
      `${batch.id} status=${batch.status} kind=${batch.kind} version=${batch.version} runners=${batch.runners.join(",")}`,
    );
    const sat = batch.summary?.saturation;
    if (sat) {
      ctx.out.write(`saturation: saturated=${sat.saturated} evaluated_runs=${sat.evaluated_runs}`);
    }
    if (batch.error) ctx.out.write(`error=${batch.error}`);
  }
  setExit(batch.status === "done" ? EXIT.OK : EXIT.VALIDATION);
}

export async function runEvalsBatches(ctx: AppContext, spec: string): Promise<void> {
  const { type, name } = parseSpec(spec);
  const { client } = requireClient(ctx);
  const res = await client.request("GET", pathOf(type, name, "/batches"));
  if (!res.ok) throw fail(res, (r) => client.errorFromResult(r));
  const data = res.data as { items: EvalBatch[] };
  if (ctx.out.json) {
    ctx.out.printJson(data);
  } else if (!data.items.length) {
    ctx.out.write("No batches.");
  } else {
    for (const b of data.items) {
      const sat = b.summary?.saturation?.saturated;
      ctx.out.write(
        `${b.id}  ${b.kind}  ${b.version}  ${b.status}  runners=${b.runners.join(",")}${sat === undefined ? "" : `  saturated=${sat}`}`,
      );
    }
  }
  setExit(EXIT.OK);
}

export async function runEvalsJournal(ctx: AppContext, spec: string): Promise<void> {
  const { type, name } = parseSpec(spec);
  const { client } = requireClient(ctx);
  const res = await client.request("GET", pathOf(type, name, "/journal"));
  if (!res.ok) throw fail(res, (r) => client.errorFromResult(r));
  const data = res.data as {
    items: Array<{
      version: string;
      channel: string;
      trigger: { accuracy: number | null } | null;
      holdout: { pass_rate: number | null } | null;
      vs_previous: { against: string; wins_candidate: number } | null;
      ablation: { uplift: number | null; tasks: number } | null;
      gate: string;
    }>;
  };
  if (ctx.out.json) {
    ctx.out.printJson(data);
  } else if (!data.items.length) {
    ctx.out.write("Journal empty.");
  } else {
    for (const i of data.items) {
      const acc = i.trigger?.accuracy ?? "-";
      const hold = i.holdout?.pass_rate ?? "-";
      const abl = i.ablation ? `uplift=${i.ablation.uplift} tasks=${i.ablation.tasks}` : "-";
      ctx.out.write(
        `${i.version}  ${i.channel}  gate=${i.gate}  trigger_acc=${acc}  holdout=${hold}  ablation=${abl}`,
      );
    }
  }
  setExit(EXIT.OK);
}
