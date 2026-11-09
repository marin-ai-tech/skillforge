type Window = { count: number; windowStart: number };

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

const attempts = new Map<string, Window>();

function keyFor(username: string): string {
  return username.trim().toLowerCase();
}

export function isRateLimited(username: string, now = Date.now()): boolean {
  const key = keyFor(username);
  const w = attempts.get(key);
  if (!w) return false;
  if (now - w.windowStart >= WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return w.count >= MAX_ATTEMPTS;
}

export function recordFailedLogin(username: string, now = Date.now()): void {
  const key = keyFor(username);
  const w = attempts.get(key);
  if (!w || now - w.windowStart >= WINDOW_MS) {
    attempts.set(key, { count: 1, windowStart: now });
    return;
  }
  w.count += 1;
}

export function clearLoginFailures(username: string): void {
  attempts.delete(keyFor(username));
}

/** Test helper — clears all in-memory windows. */
export function _resetRateLimitForTests(): void {
  attempts.clear();
}
