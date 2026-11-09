// Eval runner isolation via shared @skillforge/core process-runner.
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnIsolated, type SpawnIsolatedResult } from "@skillforge/core";
import type { Database } from "../db.ts";
import { recordRunOutputs } from "../runs/outputs.ts";
import {
  parseCaseUsage,
  parseRunnerLabel,
  parseRunnerPrice,
  type CaseUsage,
  type RunnerPrice,
} from "./usage.ts";

const TASK_OUTPUT_MAX = 64 * 1024;
const DEFAULT_TIMEOUT_S = 60;
const MAX_TIMEOUT_S = 600;
const KEBAB_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type RunnerDef = {
  id: string;
  label: string;
  command: string[];
  timeout_s: number;
  env: string[];
  /** cost-per-solve: model and agent the runner stands for, and its price per million tokens. */
  model?: string | null;
  agent?: string | null;
  price?: RunnerPrice | null;
};

export type SkillPayload = {
  name: string;
  description: string;
  files: Array<{ path: string; content: string }>;
} | null;

export type CaseExecResult = {
  triggered: boolean | null;
  output: string | null;
  error: "timeout" | "failed" | "invalid_output" | null;
  duration_ms: number;
  output_excerpt: string;
  cwd: string | null;
  /** cost-per-solve: what the runner reported about tokens, cost and model (task mode). */
  usage?: CaseUsage;
};

/**
 * Where to record the full stdout/stderr of a case (run_outputs, run_kind "eval",
 * run_id "eval:<id>"). Optional: without it runCase behaves as before.
 */
export type RunOutputRecordContext = {
  db: Database;
  dataDir: string;
  /** eval_runs.id */
  evalRunId: number;
  artifactId: string;
  /** Artifact version the case ran against (candidate or baseline side). */
  version: string;
  actor: string;
  /** Case label, e.g. "<case_id>:<side>". */
  name?: string | null;
};

function recordCaseOutputs(record: RunOutputRecordContext, result: SpawnIsolatedResult): void {
  try {
    recordRunOutputs(
      record.db,
      record.dataDir,
      {
        runId: `eval:${record.evalRunId}`,
        runKind: "eval",
        artifactId: record.artifactId,
        version: record.version,
        name: record.name ?? null,
        actor: record.actor,
      },
      result,
    );
  } catch {
    /* storing full output is best effort; the eval result (output_excerpt) is unaffected */
  }
}

function parseJsonObject(stdout: string): unknown | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const v = JSON.parse(trimmed);
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  } catch {
    /* fall through to fence */
  }
  const fence = /```json\s*([\s\S]*?)```/gi;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(trimmed)) !== null) {
    last = m[1] ?? null;
  }
  if (!last) return null;
  try {
    const v = JSON.parse(last.trim());
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  } catch {
    return null;
  }
  return null;
}

function errorText(e: unknown): string {
  return String((e as Error).message ?? e);
}

/** Reads the runners array from the file, or the error text for a missing/invalid file. */
function readRunnersList(filePath: string): { list: unknown[] } | { error: string } {
  if (!existsSync(filePath)) return { error: `runners file not found: ${filePath}` };
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (e) {
    return { error: `cannot read runners file: ${errorText(e)}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { error: `invalid runners JSON: ${errorText(e)}` };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { error: "runners file must be an object with runners array" };
  }
  const list = (parsed as { runners?: unknown }).runners;
  if (!Array.isArray(list)) {
    return { error: "runners file must contain runners array" };
  }
  return { list };
}

function isStringCommand(command: unknown): command is string[] {
  return (
    Array.isArray(command) && command.length >= 1 && command.every((x) => typeof x === "string")
  );
}

/** timeout_s clamped to MAX_TIMEOUT_S; undefined → default; invalid → null (skip runner). */
function parseRunnerTimeout(raw: unknown): number | null {
  if (raw === undefined) return DEFAULT_TIMEOUT_S;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) return null;
  return Math.min(raw, MAX_TIMEOUT_S);
}

/** One runner entry, or null when the entry is invalid and must be skipped. */
function parseRunnerDef(item: unknown): RunnerDef | null {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
  const o = item as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : "";
  if (!id || id.length > 64 || !KEBAB_ID.test(id)) return null;
  if (!isStringCommand(o.command)) return null;
  const timeout_s = parseRunnerTimeout(o.timeout_s);
  if (timeout_s === null) return null;
  const env = Array.isArray(o.env)
    ? o.env.filter((x): x is string => typeof x === "string" && !x.startsWith("SKILLFORGE_"))
    : [];
  const label = typeof o.label === "string" && o.label ? o.label : id;
  return {
    id,
    label,
    command: o.command,
    timeout_s,
    env,
    model: parseRunnerLabel(o.model),
    agent: parseRunnerLabel(o.agent),
    price: parseRunnerPrice(o.price),
  };
}

export function loadRunnersFile(filePath: string | null): {
  runners: RunnerDef[];
  error: string | null;
} {
  if (!filePath) return { runners: [], error: null };
  const read = readRunnersList(filePath);
  if ("error" in read) return { runners: [], error: read.error };
  const runners: RunnerDef[] = [];
  for (const item of read.list) {
    const runner = parseRunnerDef(item);
    if (runner) runners.push(runner);
  }
  return { runners, error: null };
}

export async function runCase(
  runner: RunnerDef,
  opts: { mode: "trigger" | "task"; prompt: string; skill: SkillPayload },
  record?: RunOutputRecordContext,
): Promise<CaseExecResult> {
  const started = Date.now();
  let workDir: string;
  try {
    workDir = mkdtempSync(join(tmpdir(), "skillforge-eval-"));
  } catch (e) {
    return {
      triggered: null,
      output: null,
      error: "failed",
      duration_ms: 0,
      output_excerpt: String((e as Error).message ?? e).slice(0, 500),
      cwd: null,
    };
  }

  const stdin = JSON.stringify({
    protocol: 1,
    mode: opts.mode,
    prompt: opts.prompt,
    skill: opts.skill,
  });

  const result = await spawnIsolated(runner.command, {
    cwd: workDir,
    envNames: runner.env,
    timeoutS: runner.timeout_s,
    stdin,
    cleanupCwd: false,
  });
  if (record) recordCaseOutputs(record, result);

  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  const duration_ms = result.duration_ms || Date.now() - started;

  if (result.error) {
    return {
      triggered: null,
      output: null,
      error: "failed",
      duration_ms,
      output_excerpt: result.error.slice(0, 500),
      cwd: workDir,
    };
  }
  if (result.timedOut) {
    return {
      triggered: null,
      output: null,
      error: "timeout",
      duration_ms,
      output_excerpt: "",
      cwd: workDir,
    };
  }
  if (result.code !== 0) {
    return {
      triggered: null,
      output: null,
      error: "failed",
      duration_ms,
      output_excerpt: result.stderr.slice(0, 500),
      cwd: workDir,
    };
  }

  const parsed = parseJsonObject(result.stdout);
  if (!parsed || typeof parsed !== "object") {
    return {
      triggered: null,
      output: null,
      error: "invalid_output",
      duration_ms,
      output_excerpt: result.stdout.slice(0, 500),
      cwd: workDir,
    };
  }
  const obj = parsed as Record<string, unknown>;
  if (opts.mode === "trigger") {
    if (typeof obj.triggered !== "boolean") {
      return {
        triggered: null,
        output: null,
        error: "invalid_output",
        duration_ms,
        output_excerpt: result.stdout.slice(0, 500),
        cwd: workDir,
      };
    }
    return {
      triggered: obj.triggered,
      output: null,
      error: null,
      duration_ms,
      output_excerpt: "",
      cwd: workDir,
    };
  }
  if (typeof obj.output !== "string") {
    return {
      triggered: null,
      output: null,
      error: "invalid_output",
      duration_ms,
      output_excerpt: result.stdout.slice(0, 500),
      cwd: workDir,
    };
  }
  const output =
    obj.output.length > TASK_OUTPUT_MAX ? obj.output.slice(0, TASK_OUTPUT_MAX) : obj.output;
  return {
    triggered: null,
    output,
    error: null,
    duration_ms,
    output_excerpt: output.slice(0, 500),
    cwd: workDir,
    usage: parseCaseUsage(obj),
  };
}
