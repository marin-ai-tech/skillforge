// news: posts by an admin (for everyone or a team) and by a team lead (for that team only). The body is parsed into a
// typed value at the boundary; the author comes from the session; every change is audited.
import { z } from "zod";
import type { Database } from "../db.ts";
import type { Role } from "../auth/users.ts";
import { appendSystemEvent } from "../audit/journal.ts";
import { getTeamByName, isTeamLead } from "../teams.ts";
import type { NewsRow } from "./read.ts";

export const TITLE_MAX = 200;
export const BODY_MAX = 20000;
const PUBLISH_AHEAD_DAYS = 365;

export type Writer = { username: string; role: Role };

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const isoDate = z
  .string()
  .regex(ISO_RE)
  .refine((s) => Number.isFinite(Date.parse(s)))
  .transform((s) => new Date(s).toISOString());
const title = z
  .string()
  .max(TITLE_MAX)
  .refine((s) => s.trim().length > 0);
const body = z.string().min(1).max(BODY_MAX);

const fields = {
  title,
  body,
  team: z.string().min(1).max(100).nullable().optional(),
  pinned: z.boolean().optional(),
  important: z.boolean().optional(),
  draft: z.boolean().optional(),
  publish_at: isoDate.nullable().optional(),
  expires_at: isoDate.nullable().optional(),
};

const createSchema = z.strictObject(fields);
const patchSchema = z.strictObject({
  ...fields,
  title: title.optional(),
  body: body.optional(),
});

export type PostCreate = z.infer<typeof createSchema>;
export type PostPatch = z.infer<typeof patchSchema>;

export type Refusal = { status: number; body: Record<string, unknown> };

function badRequest(error: z.ZodError): Refusal {
  const fieldsWithErrors = [...new Set(error.issues.map((i) => String(i.path[0] ?? "body")))];
  return { status: 400, body: { error: "bad_request", fields: fieldsWithErrors } };
}

export function parsePostCreate(raw: unknown): { value: PostCreate } | { refusal: Refusal } {
  const r = createSchema.safeParse(raw ?? {});
  return r.success ? { value: r.data } : { refusal: badRequest(r.error) };
}

export function parsePostPatch(raw: unknown): { value: PostPatch } | { refusal: Refusal } {
  const r = patchSchema.safeParse(raw ?? {});
  return r.success ? { value: r.data } : { refusal: badRequest(r.error) };
}

/** May `writer` address `team` (null — everyone)? Checked on every create and change. */
export function canWriteAudience(db: Database, writer: Writer, team: string | null): boolean {
  if (writer.role === "admin") return true;
  if (team === null) return false;
  const row = getTeamByName(db, team);
  return row !== undefined && isTeamLead(db, row.id, writer.username, writer.role);
}

/** An unknown team is a field error (400), an audience without the right is 403. */
export function audienceRefusal(db: Database, writer: Writer, team: string | null): Refusal | null {
  if (team !== null && !getTeamByName(db, team)) {
    return { status: 400, body: { error: "bad_request", fields: ["team"] } };
  }
  if (!canWriteAudience(db, writer, team)) return { status: 403, body: { error: "forbidden" } };
  return null;
}

/** `publish_at` at most a year ahead; `expires_at` after the start of showing. */
export function scheduleRefusal(
  publishAt: string | null,
  expiresAt: string | null,
  start: string,
  now: Date,
): Refusal | null {
  const limit = new Date(now.getTime() + PUBLISH_AHEAD_DAYS * 86400_000).toISOString();
  if (publishAt !== null && publishAt > limit) {
    return { status: 400, body: { error: "bad_request", fields: ["publish_at"] } };
  }
  if (expiresAt !== null && expiresAt <= (publishAt ?? start)) {
    return { status: 400, body: { error: "bad_request", fields: ["expires_at"] } };
  }
  return null;
}

function auditPost(db: Database, actor: string, action: string, meta: Record<string, unknown>) {
  appendSystemEvent(db, { actor, action, target: `news_post:${String(meta.id)}`, meta });
}

const flag = (v: boolean | undefined) => (v ? 1 : 0);

export function insertPost(db: Database, writer: Writer, input: PostCreate, now: string): number {
  const team = input.team ?? null;
  const at = input.publish_at ?? now;
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = db
      .prepare(
        `INSERT INTO news_items (kind, at, actor, title, body, team, pinned, important, draft, publish_at,
         expires_at, author, created_at, updated_at) VALUES ('post', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        at,
        writer.username,
        input.title,
        input.body,
        team,
        flag(input.pinned),
        flag(input.important),
        flag(input.draft),
        input.publish_at ?? null,
        input.expires_at ?? null,
        writer.username,
        now,
        now,
      );
    const id = Number(r.lastInsertRowid);
    auditPost(db, writer.username, "news_post_create", { id: String(id), team });
    db.exec("COMMIT");
    return id;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

type Merged = {
  title: string;
  body: string;
  team: string | null;
  pinned: number;
  important: number;
  draft: number;
  publish_at: string | null;
  expires_at: string | null;
};

function pick<T>(patch: T | undefined, current: T): T {
  return patch === undefined ? current : patch;
}

export function mergePatch(row: NewsRow, patch: PostPatch): Merged {
  return {
    title: pick(patch.title, row.title ?? ""),
    body: pick(patch.body, row.body ?? ""),
    team: pick(patch.team, row.team),
    pinned: patch.pinned === undefined ? row.pinned : flag(patch.pinned),
    important: patch.important === undefined ? row.important : flag(patch.important),
    draft: patch.draft === undefined ? row.draft : flag(patch.draft),
    publish_at: pick(patch.publish_at, row.publish_at),
    expires_at: pick(patch.expires_at, row.expires_at),
  };
}

/** `at` follows `publish_at`; a draft that goes out, or a schedule that is dropped, is news from now. */
function nextAt(row: NewsRow, merged: Merged, now: string): string {
  if (merged.publish_at) return merged.publish_at;
  const goesOut = row.draft === 1 && merged.draft === 0;
  return goesOut || row.publish_at !== null ? now : row.at;
}

export function updatePost(db: Database, actor: string, row: NewsRow, merged: Merged, now: string) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `UPDATE news_items SET at = ?, title = ?, body = ?, team = ?, pinned = ?, important = ?, draft = ?,
       publish_at = ?, expires_at = ?, updated_at = ? WHERE id = ? AND kind = 'post'`,
    ).run(
      nextAt(row, merged, now),
      merged.title,
      merged.body,
      merged.team,
      merged.pinned,
      merged.important,
      merged.draft,
      merged.publish_at,
      merged.expires_at,
      now,
      row.id,
    );
    const moved = merged.team !== row.team ? { from_team: row.team } : {};
    auditPost(db, actor, "news_post_update", { id: String(row.id), team: merged.team, ...moved });
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function deletePost(db: Database, actor: string, row: NewsRow): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM news_items WHERE id = ? AND kind = 'post'").run(row.id);
    auditPost(db, actor, "news_post_delete", { id: String(row.id), team: row.team });
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
