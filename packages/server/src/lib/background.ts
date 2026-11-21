/**
 * Periodic background tasks of the server. A failing pass (a throw or a rejected promise) is written to the server
 * log as `background_task_failed` with the task name and the error text, so a broken task is not visible only by a
 * missing result. The same error in a row is written once, until a pass succeeds or the error changes: some tasks
 * tick every 500 ms. An async pass never overlaps the previous one; the timers do not keep the process alive; the
 * helper itself never throws. Every periodic timer of the server goes through this module.
 */
export type BackgroundLog = (msg: string, fields: Record<string, unknown>) => void;

export type BackgroundErrorReporter = { ok(): void; failed(e: unknown): void };

export type BackgroundTaskOptions = {
  task: string;
  everyMs: number;
  firstDelayMs?: number;
  run: () => void | Promise<void>;
  log?: BackgroundLog;
};

function errorText(e: unknown): string {
  try {
    return e instanceof Error ? e.message : String(e);
  } catch {
    return "unprintable error";
  }
}

export function backgroundErrorReporter(
  task: string,
  log?: BackgroundLog,
): BackgroundErrorReporter {
  let last: string | null = null;
  return {
    ok: () => {
      last = null;
    },
    failed: (e: unknown) => {
      const error = errorText(e);
      if (error === last) return;
      last = error;
      try {
        log?.("background_task_failed", { task, error });
      } catch {
        // a broken log must not stop the task
      }
    },
  };
}

function isThenable(x: unknown): x is PromiseLike<void> {
  return typeof (x as { then?: unknown } | null | undefined)?.then === "function";
}

export function startBackgroundTask(opts: BackgroundTaskOptions): { stop(): void } {
  const reporter = backgroundErrorReporter(opts.task, opts.log);
  let running = false;
  let stopped = false;
  let first: ReturnType<typeof setTimeout> | undefined;
  let ticks: ReturnType<typeof setInterval> | undefined;

  const pass = (): void => {
    if (running || stopped) return;
    let result: void | Promise<void>;
    try {
      result = opts.run();
    } catch (e) {
      reporter.failed(e);
      return;
    }
    if (!isThenable(result)) {
      reporter.ok();
      return;
    }
    running = true;
    void Promise.resolve(result)
      .then(
        () => reporter.ok(),
        (e: unknown) => reporter.failed(e),
      )
      .finally(() => {
        running = false;
      });
  };

  const startTicks = (): void => {
    if (stopped) return;
    ticks = setInterval(pass, opts.everyMs);
    ticks.unref?.();
  };

  if (opts.firstDelayMs === undefined) {
    startTicks();
  } else {
    first = setTimeout(() => {
      first = undefined;
      pass();
      startTicks();
    }, opts.firstDelayMs);
    first.unref?.();
  }

  return {
    stop: () => {
      stopped = true;
      if (first) clearTimeout(first);
      if (ticks) clearInterval(ticks);
      first = undefined;
      ticks = undefined;
    },
  };
}
