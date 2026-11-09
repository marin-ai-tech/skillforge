import type { PendingOidc } from "./types.ts";

const TTL_MS = 10 * 60 * 1000;
const store = new Map<string, PendingOidc>();

function purgeExpired(now = Date.now()): void {
  for (const [k, v] of store) {
    if (v.expiresAt <= now) store.delete(k);
  }
}

export function putPending(entry: Omit<PendingOidc, "expiresAt">): void {
  purgeExpired();
  store.set(entry.state, { ...entry, expiresAt: Date.now() + TTL_MS });
}

/** Consume (delete) a pending state. Returns null if missing/expired. */
export function takePending(state: string): PendingOidc | null {
  purgeExpired();
  const entry = store.get(state);
  if (!entry) return null;
  store.delete(state);
  if (entry.expiresAt <= Date.now()) return null;
  return entry;
}
