import { randomUUID } from "node:crypto";
import type { Database } from "../db.ts";
import { getArtifactById, type ArtifactRow } from "../repo.ts";
import { canView } from "../visibility/index.ts";
import { emitPluginEvent } from "../plugins/events.ts";
import type { Role } from "../auth/users.ts";

export type CreatedNotification = {
  id: string;
  username: string;
  kind: string;
  artifact: { type: string; name: string } | null;
  title: string;
  url: string;
};

type Event = {
  /** `source` (tracked-sources): a tracked source could not be updated. */
  kind: "comment" | "mention" | "new_version" | "status_change" | "source";
  artifact: ArtifactRow;
  actor: string;
  version?: string | null;
  commentId?: string;
  parentId?: string | null;
  mentions?: string[];
  onlyMentions?: boolean;
};

export function preferenceEnabled(db: Database, username: string, kind: string): boolean {
  const row = db
    .prepare("SELECT enabled FROM notification_prefs WHERE username = ? AND kind = ?")
    .get(username, kind) as { enabled: number } | undefined;
  return row?.enabled !== 0;
}

export function insertNotification(
  db: Database,
  input: {
    username: string;
    kind: string;
    artifactId?: string | null;
    version?: string | null;
    commentId?: string | null;
    actor?: string | null;
    title: string;
    text?: string | null;
    url: string;
    meta?: Record<string, unknown>;
  },
): CreatedNotification {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO notifications
    (id, username, kind, artifact_id, version, comment_id, actor, title, text, url, meta, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.username,
    input.kind,
    input.artifactId ?? null,
    input.version ?? null,
    input.commentId ?? null,
    input.actor ?? null,
    input.title,
    input.text ?? null,
    input.url,
    JSON.stringify(input.meta ?? {}),
    now,
  );
  db.prepare("DELETE FROM notifications WHERE username = ? AND created_at < ?").run(
    input.username,
    new Date(Date.now() - 90 * 86400000).toISOString(),
  );
  db.prepare(
    `DELETE FROM notifications WHERE username = ? AND id NOT IN
    (SELECT id FROM notifications WHERE username = ? ORDER BY created_at DESC, rowid DESC LIMIT 500)`,
  ).run(input.username, input.username);
  const a = input.artifactId ? getArtifactById(db, input.artifactId) : null;
  return {
    id,
    username: input.username,
    kind: input.kind,
    artifact: a ? { type: a.type, name: a.name } : null,
    title: input.title,
    url: input.url,
  };
}

export function emitNotifications(items: CreatedNotification[]): void {
  for (const notification of items) {
    emitPluginEvent({ type: "notification.created", at: new Date().toISOString(), notification });
  }
}

type AddTarget = (username: string, kind: string, meta?: Record<string, unknown>) => void;

/** Owner, maintainers, watchers, thread participants (comment) and dependents (new_version). */
function addArtifactAudience(db: Database, event: Event, add: AddTarget): void {
  const { artifact } = event;
  add(artifact.owner, event.kind);
  const maintainers = db
    .prepare("SELECT username FROM artifact_maintainers WHERE artifact_id = ?")
    .all(artifact.id) as Array<{ username: string }>;
  for (const m of maintainers) add(m.username, event.kind);
  const watchers = db
    .prepare("SELECT username FROM artifact_watchers WHERE artifact_id = ?")
    .all(artifact.id) as Array<{ username: string }>;
  for (const w of watchers) add(w.username, event.kind);
  if (event.kind === "comment" && event.parentId) {
    const participants = db
      .prepare(
        `SELECT DISTINCT author FROM comments
        WHERE id = ? OR parent_id = ?`,
      )
      .all(event.parentId, event.parentId) as Array<{ author: string }>;
    for (const p of participants) add(p.author, "comment");
  }
  if (event.kind === "new_version") {
    const deps = db
      .prepare(
        `SELECT u.username, ag.name AS agent FROM agent_items ai
        JOIN agents ag ON ag.id = ai.agent_id JOIN users u ON u.id = ag.owner_id
        WHERE ai.type = ? AND ai.name = ? AND ag.scanned_at IS NOT NULL`,
      )
      .all(artifact.type, artifact.name) as Array<{ username: string; agent: string }>;
    for (const d of deps) add(d.username, "new_version", { agent: d.agent });
  }
}

/** Active user who can see the artifact and has this notification kind enabled. */
function notifiableUser(
  db: Database,
  username: string,
  artifact: ArtifactRow,
  kind: string,
): { username: string; role: Role; disabled: number } | null {
  const user = db
    .prepare("SELECT username, role, disabled FROM users WHERE username = ?")
    .get(username) as { username: string; role: Role; disabled: number } | undefined;
  if (
    !user ||
    user.disabled ||
    !canView(db, user, artifact) ||
    !preferenceEnabled(db, user.username, kind)
  )
    return null;
  return user;
}

export function notify(db: Database, event: Event): CreatedNotification[] {
  const { artifact, actor } = event;
  const targets = new Map<string, { kind: string; meta: Record<string, unknown> }>();
  const add = (username: string, kind: string, meta: Record<string, unknown> = {}) => {
    if (!username || username.toLowerCase() === actor.toLowerCase()) return;
    const key = username.toLowerCase();
    if (kind === "mention" || !targets.has(key)) targets.set(key, { kind, meta });
  };
  if (!event.onlyMentions) {
    addArtifactAudience(db, event, add);
  }
  for (const username of event.mentions ?? []) add(username, "mention");
  const created: CreatedNotification[] = [];
  const url = `/artifacts/${encodeURIComponent(artifact.type)}/${encodeURIComponent(artifact.name)}`;
  const ordered = [
    ...[...targets].filter(([, t]) => t.kind === "mention"),
    ...[...targets].filter(([, t]) => t.kind !== "mention"),
  ];
  for (const [username, target] of ordered) {
    if (created.length >= 50) break;
    const user = notifiableUser(db, username, artifact, target.kind);
    if (!user) continue;
    created.push(
      insertNotification(db, {
        username: user.username,
        kind: target.kind,
        artifactId: artifact.id,
        version: event.version,
        commentId: event.commentId,
        actor,
        title: `${target.kind}: ${artifact.type}/${artifact.name}`,
        url: event.commentId ? `${url}?comment=${event.commentId}` : url,
        meta: target.meta,
      }),
    );
  }
  return created;
}

export function visibleUnreadCount(db: Database, username: string, role: Role): number {
  const rows = db
    .prepare(
      `SELECT n.artifact_id FROM notifications n
    WHERE n.username = ? AND n.read_at IS NULL`,
    )
    .all(username) as Array<{ artifact_id: string | null }>;
  return rows.filter(
    (r) =>
      !r.artifact_id ||
      (() => {
        const a = getArtifactById(db, r.artifact_id);
        return a && canView(db, { username, role }, a);
      })(),
  ).length;
}
