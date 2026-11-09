// Shared isolated process runner: shell:false spawn, env allowlist, SKILLFORGE_* scrub, timeout + kill-tree.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_OUTPUT_LIMIT = 1024 * 1024;

/** Safe env names copied into child processes. SKILLFORGE_* is never allowlisted. */
export const ALLOWED_ENV = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "SystemRoot",
  "SystemDrive",
  "TEMP",
  "TMP",
  "APPDATA",
  "LOCALAPPDATA",
  "ProgramData",
  "COMSPEC",
  "PATHEXT",
  "LANG",
  "LC_ALL",
  "TZ",
] as const;

/**
 * SkillForge secret prefix — case-insensitive: process.env on Windows is
 * case-insensitive, so a lowercase `skillforge_*` key would still resolve the
 * real secret.
 */
const SCRUB_RE = /^SKILLFORGE_/i;

/**
 * Build a child environment from ALLOWED_ENV plus optional extra names.
 * Names matching /^SKILLFORGE_/i are scrubbed / excluded even if listed in extraNames.
 */
export function buildSafeEnv(extraNames: string[] = []): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ALLOWED_ENV) {
    if (SCRUB_RE.test(name)) continue; // defensive scrub
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  for (const name of extraNames) {
    if (typeof name !== "string") continue;
    if (SCRUB_RE.test(name)) continue; // scrub / exclude SKILLFORGE_* secrets
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  return env;
}

/** After a timeout kill, how long to wait for 'close' before giving up on open stdio pipes. */
export const KILL_GRACE_MS = 5000;

function killChildQuietly(child: ChildProcess): void {
  try {
    child.kill();
  } catch {
    /* ignore */
  }
}

/** Terminate a child and its process tree (Windows taskkill /T /F; POSIX process group SIGKILL). */
export function killProcessTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    // Absolute path (no PATH lookup) and an 'error' handler: a missing taskkill
    // must not become an uncaught error; fall back to killing the direct child.
    const taskkill = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
    try {
      const k = spawn(taskkill, ["/T", "/F", "/PID", String(child.pid)], {
        stdio: "ignore",
        shell: false,
      });
      k.on("error", () => killChildQuietly(child));
    } catch {
      killChildQuietly(child);
    }
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
}

export type SpawnIsolatedOptions = {
  cwd?: string;
  envNames?: string[];
  /** Extra key→value env injected by the caller (SKILLFORGE_* keys are scrubbed). */
  env?: Record<string, string>;
  /** Timeout in milliseconds. Takes precedence over timeoutS when both set. */
  timeoutMs?: number;
  /** Timeout in seconds (used when timeoutMs omitted). */
  timeoutS?: number;
  stdin?: string;
  /** Max bytes collected per stdout/stderr stream (default 1 MiB). */
  outputLimit?: number;
  /**
   * When cwd is omitted, create a temp directory with this prefix under os.tmpdir().
   * Defaults to "skillforge-proc-" when cwd is omitted.
   */
  tempCwdPrefix?: string;
  /** Remove workDir after the child exits. Default: true when a temp cwd was created. */
  cleanupCwd?: boolean;
  /**
   * Pass args to the child verbatim (Windows only). Needed for `cmd /c <command>`
   * so quotes inside the command reach cmd.exe unmodified.
   */
  verbatimArgs?: boolean;
};

export type SpawnIsolatedResult = {
  ok: boolean;
  code: number | null;
  timedOut: boolean;
  outTruncated: boolean;
  errTruncated: boolean;
  stdout: string;
  stderr: string;
  error: string | null;
  duration_ms: number;
  workDir: string | undefined;
};

function resolveTimeoutMs(options: SpawnIsolatedOptions): number {
  if (options.timeoutMs !== undefined) return options.timeoutMs;
  return (options.timeoutS ?? 300) * 1000;
}

function failResult(
  error: string,
  started: number,
  workDir: string | undefined,
): SpawnIsolatedResult {
  return {
    ok: false,
    code: null,
    timedOut: false,
    outTruncated: false,
    errTruncated: false,
    stdout: "",
    stderr: "",
    error,
    duration_ms: started === 0 ? 0 : Date.now() - started,
    workDir,
  };
}

function prepareWorkDir(options: SpawnIsolatedOptions): {
  workDir: string;
  createdTemp: boolean;
} {
  if (options.cwd) return { workDir: options.cwd, createdTemp: false };
  const prefix = options.tempCwdPrefix ?? "skillforge-proc-";
  return {
    workDir: mkdtempSync(join(tmpdir(), prefix)),
    createdTemp: true,
  };
}

function cleanupWorkDir(workDir: string | undefined, shouldCleanup: boolean): void {
  if (!shouldCleanup || !workDir) return;
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function spawnChild(
  command: string[],
  workDir: string,
  envNames: string[],
  extraEnv?: Record<string, string>,
  verbatimArgs?: boolean,
): ChildProcess {
  const env = buildSafeEnv(envNames);
  for (const [k, v] of Object.entries(extraEnv ?? {})) {
    if (SCRUB_RE.test(k)) continue;
    env[k] = v;
  }
  return spawn(command[0]!, command.slice(1), {
    cwd: workDir,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    ...(verbatimArgs ? { windowsVerbatimArguments: true } : {}),
    ...(process.platform !== "win32" ? { detached: true } : {}),
  });
}

type StreamBag = { buf: Buffer; truncated: boolean };

function attachLimitedStream(
  stream: NodeJS.ReadableStream | null | undefined,
  limit: number,
  bag: StreamBag,
): void {
  stream?.on("data", (d: Buffer) => {
    if (bag.buf.length >= limit) {
      bag.truncated = true;
      return;
    }
    bag.buf = Buffer.concat([bag.buf, d]);
    if (bag.buf.length > limit) {
      bag.truncated = true;
      bag.buf = bag.buf.subarray(0, limit);
    }
  });
}

/**
 * Spawn argv with shell: false, allowlisted env (SKILLFORGE_* scrubbed), timeout + kill-tree,
 * and output limits. Does not pass process.env wholesale.
 */
export function spawnIsolated(
  command: string[],
  options: SpawnIsolatedOptions = {},
): Promise<SpawnIsolatedResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const outputLimit = options.outputLimit ?? DEFAULT_OUTPUT_LIMIT;
    const envNames = options.envNames ?? [];
    const timeoutMs = resolveTimeoutMs(options);

    if (!Array.isArray(command) || command.length < 1 || typeof command[0] !== "string") {
      resolve(failResult("command must be a non-empty argv array", 0, undefined));
      return;
    }

    let workDir: string | undefined;
    let createdTemp = false;
    try {
      const prepared = prepareWorkDir(options);
      workDir = prepared.workDir;
      createdTemp = prepared.createdTemp;
    } catch (e) {
      resolve(failResult(String((e as Error).message ?? e), 0, workDir));
      return;
    }

    const shouldCleanup = options.cleanupCwd !== undefined ? options.cleanupCwd : createdTemp;

    let child: ChildProcess;
    try {
      child = spawnChild(command, workDir!, envNames, options.env, options.verbatimArgs);
    } catch (e) {
      cleanupWorkDir(workDir, shouldCleanup);
      resolve(failResult(String((e as Error).message ?? e), started, workDir));
      return;
    }

    const out: StreamBag = { buf: Buffer.alloc(0), truncated: false };
    const err: StreamBag = { buf: Buffer.alloc(0), truncated: false };
    let timedOut = false;
    let settled = false;

    let hardTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: SpawnIsolatedResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (hardTimer) clearTimeout(hardTimer);
      cleanupWorkDir(workDir, shouldCleanup);
      resolve(result);
    };
    const resultFor = (code: number | null): SpawnIsolatedResult => ({
      ok: code === 0 && !timedOut,
      code,
      timedOut,
      outTruncated: out.truncated,
      errTruncated: err.truncated,
      stdout: out.buf.toString("utf8"),
      stderr: err.buf.toString("utf8"),
      error: null,
      duration_ms: Date.now() - started,
      workDir,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
      // Hard deadline: 'close' waits for every stdio pipe; if a pipe stays open after the kill,
      // stop waiting, release the pipes and report the timeout anyway.
      hardTimer = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.stdin?.destroy();
        finish(resultFor(child.exitCode));
      }, KILL_GRACE_MS);
      hardTimer.unref?.();
    }, timeoutMs);

    child.on("error", (e) => {
      finish(failResult(String(e.message ?? e), started, workDir));
    });

    attachLimitedStream(child.stdout, outputLimit, out);
    attachLimitedStream(child.stderr, outputLimit, err);

    child.on("close", (code) => {
      finish(resultFor(code));
    });

    child.stdin?.on("error", () => {
      /* EPIPE ok */
    });
    child.stdin?.end(options.stdin ?? "");
  });
}

/** Alias matching review-assistant / judge call sites; same isolation as spawnIsolated. */
export function spawnCommand(
  command: string[],
  options: SpawnIsolatedOptions = {},
): Promise<SpawnIsolatedResult> {
  return spawnIsolated(command, options);
}
