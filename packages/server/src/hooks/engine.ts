// Hook runtime engine.
// Evaluates enabled subscriptions for an event: groups in hooks.<Event> are
// filtered by matcher (JS regex on tool_name), `command` entries run via
// spawnIsolated in the materialized env dir (CLAUDE_PLUGIN_ROOT), stdin gets the
// Claude-Code-style JSON payload. Verdicts follow the Claude Code contract
// (exit 2 / decision / permissionDecision); aggregation is block > ask > error
// > allow where a hook's own `error` degrades to `ask` (fail-cautious). A hook that
// cannot be read or started at all is the gate's failure, not the hook's: it gives
// `block` (hook-gate-fail-closed), so a broken gate never lets a publish through.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { spawnIsolated } from "@skillforge/core";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db.ts";
import { readBlob } from "../blobs.ts";
import { getVersion } from "../repo.ts";
import type { HookSubscription } from "./model.ts";
import { listEnabledSubscriptions, recordDecision } from "./model.ts";

export type EvaluateInput = {
  event: string;
  toolName?: string | undefined;
  input?: unknown;
  actor: string;
};

export type EntryResult = {
  subscription_id: number;
  artifact: string;
  version: string;
  event: string;
  matcher: string | null;
  entry_idx: number;
  verdict: "allow" | "ask" | "block" | "error" | "skipped";
  exit_code: number | null;
  duration_ms: number | null;
  detail: string | null;
};

export type EvaluateResult = {
  decision: "allow" | "ask" | "block";
  results: EntryResult[];
};

const DETAIL_MAX = 500;
const UNAVAILABLE = "hook unavailable:";
const PLUGIN_ROOT_RE = /\$\{CLAUDE_PLUGIN_ROOT\}/g;

/** Operator switches the engine needs; taken from AppConfig (parsed at startup), never process.env. */
export type HookSwitches = Pick<AppConfig, "hooksDisabled">;

const HOOK_TIMEOUT_MAX_S = 600;

function hookTimeoutS(): number {
  const raw = Number(process.env.SKILLFORGE_HOOK_TIMEOUT_S);
  return Number.isInteger(raw) && raw >= 1 && raw <= HOOK_TIMEOUT_MAX_S ? raw : 10;
}

export function hookEnvDir(dataDir: string, subscriptionId: number): string {
  return join(dataDir, "hook-env", String(subscriptionId));
}

type VersionFile = { path: string; sha256: string };

function versionFiles(db: Database, sub: HookSubscription): VersionFile[] {
  const v = getVersion(db, sub.artifact_id, sub.version);
  const files = (v?.files ?? []) as Array<{ path: string; sha256: string; size: number }>;
  return files.map((f) => ({ path: f.path, sha256: f.sha256 }));
}

/**
 * Extract the version blob files under data/hook-env/<id>/. Versions are immutable, so a
 * finished extraction (marker) only restores what went missing. Throws if a file is unavailable.
 */
function materialize(db: Database, dataDir: string, sub: HookSubscription): string {
  const dir = hookEnvDir(dataDir, sub.id);
  const marker = join(dir, ".materialized");
  const finished = existsSync(marker);
  const files = versionFiles(db, sub);
  if (files.length === 0) throw new Error("version files not found");
  mkdirSync(dir, { recursive: true });
  const base = resolve(dir);
  for (const f of files) {
    const out = resolve(dir, f.path);
    if (out !== base && !out.startsWith(base + sep)) continue; // path safety
    if (finished && existsSync(out)) continue;
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, readBlob(dataDir, f.sha256));
  }
  writeFileSync(marker, sub.version);
  return dir;
}

/**
 * The hook's definition. A published hook always has one with a hooks object (core validates
 * it), so anything else is a failure and throws: it must not read as "this hook has no entries".
 */
function hooksJsonOf(db: Database, dataDir: string, sub: HookSubscription): unknown {
  const entry = versionFiles(db, sub).find((f) => f.path === "hooks/hooks.json");
  if (!entry) throw new Error("hooks/hooks.json not found");
  const text = Buffer.from(readBlob(dataDir, entry.sha256)).toString("utf8");
  const root = JSON.parse(text) as { hooks?: unknown } | null;
  if (typeof root?.hooks !== "object" || root.hooks === null) {
    throw new Error("hooks/hooks.json has no hooks object");
  }
  return root;
}

/** Detail goes to the publisher in the 409: a file system error's message holds the data path. */
function unavailableDetail(e: unknown): string {
  const err = e as NodeJS.ErrnoException;
  const why = err.code ?? (e instanceof SyntaxError ? "invalid JSON" : err.message);
  return `${UNAVAILABLE} ${String(why)}`.slice(0, DETAIL_MAX);
}

type Group = { matcher: string | null; hooks: unknown[] };

function groupsFor(hooksJson: unknown, event: string): Group[] {
  const root = hooksJson as Record<string, unknown> | null;
  const hooks = root?.hooks as Record<string, unknown> | undefined;
  const groups = hooks?.[event];
  if (!Array.isArray(groups)) return [];
  return groups
    .filter((g): g is Record<string, unknown> => typeof g === "object" && g !== null)
    .map((g) => ({
      matcher: typeof g.matcher === "string" && g.matcher !== "" ? g.matcher : null,
      hooks: Array.isArray(g.hooks) ? g.hooks : [],
    }));
}

function matcherHits(matcher: string | null, toolName: string): boolean {
  if (!matcher) return true;
  try {
    return new RegExp(matcher).test(toolName);
  } catch {
    return false;
  }
}

function shellArgv(command: string): string[] {
  // Windows: wrap in quotes and pass verbatim so inner quoting reaches cmd.exe
  // intact — otherwise Node re-quotes argv and `cmd /c` mangles "..." inside the
  // command, degrading blocking hooks to silent errors.
  return process.platform === "win32"
    ? [process.env.ComSpec ?? "cmd.exe", "/d", "/s", "/c", `"${command}"`]
    : ["sh", "-c", command];
}

function parseVerdict(stdout: string): "allow" | "ask" | "block" | null {
  const text = stdout.trim();
  if (!text) return null;
  let j: unknown = null;
  try {
    j = JSON.parse(text);
  } catch {
    // Claude Code allows the JSON to be the last stdout line.
    const last = text
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "")
      .pop();
    try {
      j = last ? JSON.parse(last) : null;
    } catch {
      j = null;
    }
  }
  if (typeof j !== "object" || j === null) return null;
  const o = j as Record<string, unknown>;
  const pd =
    (o.hookSpecificOutput as Record<string, unknown> | undefined)?.permissionDecision ??
    o.permissionDecision;
  const raw = String(pd ?? o.decision ?? "").toLowerCase();
  if (["deny", "block"].includes(raw)) return "block";
  if (raw === "ask") return "ask";
  if (["allow", "approve"].includes(raw)) return "allow";
  return null;
}

async function runEntry(
  sub: HookSubscription,
  envDir: string,
  entry: Record<string, unknown>,
  ctx: EvaluateInput,
): Promise<EntryResult> {
  const command = String(entry.command ?? "").replace(PLUGIN_ROOT_RE, envDir);
  const stdin = JSON.stringify({
    session_id: "skillforge",
    hook_event_name: ctx.event,
    tool_name: ctx.toolName ?? null,
    tool_input: ctx.input ?? null,
    artifact: { type: sub.artifact_type, name: sub.artifact_name, version: sub.version },
  });
  // Artifact-supplied timeout is honored but capped — a published hook must
  // not pin the evaluator for minutes.
  const timeout =
    typeof entry.timeout === "number" && entry.timeout > 0
      ? Math.min(HOOK_TIMEOUT_MAX_S, entry.timeout)
      : hookTimeoutS();
  const res = await spawnIsolated(shellArgv(command), {
    cwd: envDir,
    cleanupCwd: false,
    env: { CLAUDE_PLUGIN_ROOT: envDir },
    timeoutS: timeout,
    stdin,
    outputLimit: 256 * 1024,
    verbatimArgs: process.platform === "win32",
  });
  const detail = [res.stdout.trim(), res.stderr.trim()].filter(Boolean).join("\n") || null;
  const base: Omit<EntryResult, "verdict"> = {
    subscription_id: sub.id,
    artifact: `${sub.artifact_type}/${sub.artifact_name}`,
    version: sub.version,
    event: ctx.event,
    matcher: null,
    entry_idx: 0,
    exit_code: res.code,
    duration_ms: res.duration_ms,
    detail: detail ? detail.slice(0, DETAIL_MAX) : null,
  };
  // res.error means the process never ran; a timeout leaves it empty and is the hook's own outcome.
  if (res.error) {
    return {
      ...base,
      verdict: "block",
      detail: `${UNAVAILABLE} ${res.error}`.slice(0, DETAIL_MAX),
    };
  }
  if (res.timedOut || res.code === null) return { ...base, verdict: "error" };
  if (res.code === 2) return { ...base, verdict: "block" };
  if (res.code !== 0) return { ...base, verdict: "error" };
  return { ...base, verdict: parseVerdict(res.stdout) ?? "allow" };
}

function aggregate(results: EntryResult[]): EvaluateResult["decision"] {
  if (results.some((r) => r.verdict === "block")) return "block";
  if (results.some((r) => r.verdict === "ask" || r.verdict === "error")) return "ask";
  return "allow";
}

function persist(db: Database, ctx: EvaluateInput, r: EntryResult): void {
  try {
    recordDecision(db, {
      subscription_id: r.subscription_id,
      event: r.event,
      matcher: r.matcher,
      entry_idx: r.entry_idx,
      verdict: r.verdict,
      exit_code: r.exit_code,
      duration_ms: r.duration_ms,
      detail: r.detail,
      actor: ctx.actor,
      context: ctx.toolName ?? null,
    });
  } catch {
    /* audit is best effort — never break evaluation */
  }
}

async function evalSubscription(
  db: Database,
  dataDir: string,
  sub: HookSubscription,
  ctx: EvaluateInput,
): Promise<EntryResult[]> {
  const out: EntryResult[] = [];
  const toolName = ctx.toolName ?? "";
  const groups = groupsFor(hooksJsonOf(db, dataDir, sub), ctx.event);
  const skip = (matcher: string | null, idx: number, detail: string): EntryResult => ({
    subscription_id: sub.id,
    artifact: `${sub.artifact_type}/${sub.artifact_name}`,
    version: sub.version,
    event: ctx.event,
    matcher,
    entry_idx: idx,
    verdict: "skipped",
    exit_code: null,
    duration_ms: null,
    detail,
  });
  for (const g of groups) {
    if (!matcherHits(g.matcher, toolName)) continue;
    let envDir: string | null = null;
    for (let i = 0; i < g.hooks.length; i++) {
      const entry = g.hooks[i] as Record<string, unknown>;
      if (entry?.type !== "command") {
        out.push(skip(g.matcher, i, `entry type ${String(entry?.type)} not executable in v1`));
        continue;
      }
      envDir ??= materialize(db, dataDir, sub);
      const r = await runEntry(sub, envDir, entry, ctx);
      r.matcher = g.matcher;
      r.entry_idx = i;
      out.push(r);
    }
  }
  return out;
}

/** Evaluate all enabled subscriptions for an event; audit every entry decision. */
export async function evaluateHooks(
  db: Database,
  dataDir: string,
  ctx: EvaluateInput,
  switches: HookSwitches,
): Promise<EvaluateResult> {
  // Kill switch (SKILLFORGE_HOOKS_DISABLED): allow without executing or auditing.
  if (switches.hooksDisabled) return { decision: "allow", results: [] };
  const results: EntryResult[] = [];
  for (const sub of listEnabledSubscriptions(db)) {
    try {
      results.push(...(await evalSubscription(db, dataDir, sub, ctx)));
    } catch (e) {
      results.push({
        subscription_id: sub.id,
        artifact: `${sub.artifact_type}/${sub.artifact_name}`,
        version: sub.version,
        event: ctx.event,
        matcher: null,
        entry_idx: -1,
        verdict: "block",
        exit_code: null,
        duration_ms: null,
        detail: unavailableDetail(e),
      });
    }
  }
  for (const r of results) persist(db, ctx, r);
  return { decision: aggregate(results), results };
}

/** Pre-publish gate used by the catalog and agent publish routes. */
export async function publishGate(
  db: Database,
  dataDir: string,
  actor: string,
  body: { type: string; name: string },
  switches: HookSwitches,
): Promise<EvaluateResult> {
  return evaluateHooks(
    db,
    dataDir,
    {
      event: "PreToolUse",
      toolName: "artifact_publish",
      input: { type: body.type, name: body.name, actor },
      actor,
    },
    switches,
  );
}

/** Audit-only post-publish evaluation (errors never affect the response). */
export async function postPublishHooks(
  db: Database,
  dataDir: string,
  actor: string,
  body: { type: string; name: string; version?: string },
  switches: HookSwitches,
): Promise<void> {
  try {
    await evaluateHooks(
      db,
      dataDir,
      {
        event: "PostToolUse",
        toolName: "artifact_publish",
        input: { type: body.type, name: body.name, version: body.version, actor },
        actor,
      },
      switches,
    );
  } catch {
    /* audit-only */
  }
}
