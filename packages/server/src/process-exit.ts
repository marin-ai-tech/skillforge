import type { Logger } from "./logging.ts";

/** Signals that ask the server to stop; SIGHUP and SIGBREAK also arrive on Windows (console closed, Ctrl+Break). */
const STOP_SIGNALS: NodeJS.Signals[] =
  process.platform === "win32"
    ? ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]
    : ["SIGINT", "SIGTERM", "SIGHUP"];

export type CrashKind = "uncaught_exception" | "unhandled_rejection" | "start_failed";

/**
 * fix-server-exit-reason: the server log says why the process stopped. A stop signal writes `server_stopping`, a crash
 * writes `server_crashed` (the first reason only) and exits 1 as Node would, and every exit writes `server_exit`.
 * The log is written synchronously, so the records survive `process.exit`. A kill from outside cannot be recorded.
 */
export function watchProcessExit(
  log: Logger,
  close: () => Promise<void>,
): {
  crashed: (kind: CrashKind, e: unknown) => void;
} {
  let stopping = false;
  let crashedOnce = false;

  const crashed = (kind: CrashKind, e: unknown): void => {
    if (crashedOnce) return;
    crashedOnce = true;
    const err = e instanceof Error ? e : new Error(String(e));
    log.error("server_crashed", { kind, error: err.message, stack: err.stack });
    process.exit(1);
  };

  const stop = (signal: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    log.info("server_stopping", { signal });
    close()
      .catch((e: unknown) =>
        log.error("server_close_failed", { error: e instanceof Error ? e.message : String(e) }),
      )
      .finally(() => process.exit(0));
  };

  for (const signal of STOP_SIGNALS) process.on(signal, () => stop(signal));
  process.on("uncaughtException", (e) => crashed("uncaught_exception", e));
  process.on("unhandledRejection", (e) => crashed("unhandled_rejection", e));
  process.on("exit", (code) => log.info("server_exit", { code }));
  return { crashed };
}
