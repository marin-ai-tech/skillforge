// news: automatic items are written inside the caller's transaction (transitionArtifact, commitRowsInTx,
// applyChannelChange). Only references and event fields are stored. news-delivery: the write asks for an
// announcement pass, which runs after COMMIT and reads only committed rows (announce-trigger.ts).
import type { Database } from "../db.ts";
import { requestAnnounce } from "./announce-trigger.ts";
import {
  AUTO_NEWS_RETENTION_DAYS,
  transitionNewsKind,
  versionNewsKind,
  type AutoNewsKind,
} from "./rules.ts";

type AutoItem = {
  kind: AutoNewsKind;
  artifactId: string;
  actor: string;
  at: string;
  version?: string | null;
  from?: string | null;
  to?: string | null;
};

function insertAutoItem(db: Database, item: AutoItem): void {
  db.prepare(
    `INSERT INTO news_items (kind, at, actor, artifact_id, version, from_status, to_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    item.kind,
    item.at,
    item.actor,
    item.artifactId,
    item.version ?? null,
    item.from ?? null,
    item.to ?? null,
    item.at,
    item.at,
  );
  requestAnnounce();
}

/** Active before: a transition to `active` in the audit journal, or a news item about it. */
function wasActiveBefore(db: Database, artifactId: string): boolean {
  const audited = db
    .prepare(
      `SELECT 1 AS n FROM audit_events
       WHERE artifact_id = ? AND action = 'transition' AND to_status = 'active' LIMIT 1`,
    )
    .get(artifactId);
  if (audited) return true;
  const news = db
    .prepare(
      "SELECT 1 AS n FROM news_items WHERE artifact_id = ? AND kind = 'new_artifact' LIMIT 1",
    )
    .get(artifactId);
  return news !== undefined;
}

/** Call inside the transition's transaction, before its own audit row is written. */
export function recordTransitionNews(
  db: Database,
  input: { artifactId: string; from: string; to: string; actor: string; at: string },
): AutoNewsKind | null {
  const kind = transitionNewsKind({
    from: input.from,
    to: input.to,
    wasActiveBefore: input.to === "active" && wasActiveBefore(db, input.artifactId),
  });
  if (!kind) return null;
  const withStatuses = kind === "status_change";
  insertAutoItem(db, {
    kind,
    artifactId: input.artifactId,
    actor: input.actor,
    at: input.at,
    from: withStatuses ? input.from : null,
    to: withStatuses ? input.to : null,
  });
  return kind;
}

/** Call inside the publication / channel-change transaction, after the version row has its channel. */
export function recordVersionNews(
  db: Database,
  input: {
    artifactId: string;
    status: string;
    version: string;
    channel: string;
    actor: string;
    at: string;
  },
): AutoNewsKind | null {
  const hadStableBefore =
    db
      .prepare(
        "SELECT 1 AS n FROM artifact_versions WHERE artifact_id = ? AND channel = 'stable' AND version <> ? LIMIT 1",
      )
      .get(input.artifactId, input.version) !== undefined;
  const kind = versionNewsKind({ channel: input.channel, status: input.status, hadStableBefore });
  if (!kind) return null;
  insertAutoItem(db, {
    kind,
    artifactId: input.artifactId,
    actor: input.actor,
    at: input.at,
    version: input.version,
  });
  return kind;
}

/** Hourly sweep: automatic items older than the retention period go; posts stay. Returns the number removed. */
export function pruneAutomaticNews(db: Database, now: Date): number {
  const cutoff = new Date(now.getTime() - AUTO_NEWS_RETENTION_DAYS * 86400_000).toISOString();
  return Number(
    db.prepare("DELETE FROM news_items WHERE kind <> 'post' AND at < ?").run(cutoff).changes,
  );
}
