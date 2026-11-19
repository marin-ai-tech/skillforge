// news-delivery: "announce now" without an import cycle. The writers of news (record.ts, the post routes) call
// requestAnnounce() inside or after their transaction; the announcer runs on the next turn of the event loop, after
// COMMIT, and reads only committed rows. A rolled-back item is never seen, so it is never announced.

/** Returns false when the database was busy (a transaction is open): a later turn tries again. */
type Announcer = () => boolean;

const RETRY_MS = 25;
const MAX_RETRIES = 40;

let announcer: Announcer | null = null;
let pending = false;

/** Install the announcer of the running app; returns the function that removes it (on close). */
export function setAnnouncer(fn: Announcer): () => void {
  announcer = fn;
  return () => {
    if (announcer === fn) announcer = null;
  };
}

function run(attempt: number): void {
  pending = false;
  const fn = announcer;
  if (!fn || fn() || attempt >= MAX_RETRIES) return;
  pending = true;
  const t = setTimeout(() => run(attempt + 1), RETRY_MS);
  t.unref?.();
}

/** Ask for an announcement pass after the current transaction; several requests in one turn make one pass. */
export function requestAnnounce(): void {
  if (!announcer || pending) return;
  pending = true;
  setImmediate(() => run(0));
}
