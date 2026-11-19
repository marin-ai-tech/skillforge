/**
 * The background schedule of mirrors and tracked sources (fix-tracked-source-archive): by due date, not by a timer
 * from server start, so a restart does not put the next check off by a whole interval. An item is due when its last
 * check is older than the interval or it was never checked. The first pass runs a few minutes after start, then every
 * hour; a pass never starts while the previous one runs. Interval 0 turns the schedule off.
 */
const HOUR_MS = 3_600_000;
const FIRST_DELAY_MS = 5 * 60_000;

export function isDue(lastCheckedAt: string | null, intervalHours: number, now: number): boolean {
  if (!lastCheckedAt) return true;
  const at = Date.parse(lastCheckedAt);
  return !Number.isFinite(at) || now - at >= intervalHours * HOUR_MS;
}

export function startSourceSchedule(
  run: () => Promise<void>,
  opts: { intervalHours: number; firstDelayMs?: number; tickMs?: number },
): { stop: () => void } {
  if (opts.intervalHours <= 0) return { stop: () => {} };
  let running = false;
  let ticks: ReturnType<typeof setInterval> | undefined;
  const pass = (): void => {
    if (running) return;
    running = true;
    void run()
      .catch(() => {
        /* a pass logs its own failures; the next one tries again */
      })
      .finally(() => {
        running = false;
      });
  };
  const first = setTimeout(() => {
    pass();
    ticks = setInterval(pass, opts.tickMs ?? HOUR_MS);
    ticks.unref?.();
  }, opts.firstDelayMs ?? FIRST_DELAY_MS);
  first.unref?.();
  return {
    stop: () => {
      clearTimeout(first);
      if (ticks) clearInterval(ticks);
    },
  };
}
