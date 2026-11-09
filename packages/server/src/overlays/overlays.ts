import { artifactTypeDef, type ArtifactType } from "@skillforge/core";
import type { Database } from "../repo.ts";

/**
 * Layers of edits over an artifact: company → the person's teams → the person.
 * The CLI applies them after checking the bundle signature, so edits survive updates. Paths are parsed here, at the
 * boundary: a layer can only touch files of its own artifact.
 */
export type OverlayOp = { op: "append" | "replace" | "add"; path: string; text: string };
export type Layer = { scope: string; ops: OverlayOp[]; updated_by: string; updated_at: string };

const OPS = new Set(["append", "replace", "add"]);
const LAYERED_TYPES = new Set(["skill", "command", "agent"]);
const MAX_OPS = 50;
const MAX_TEXT = 64 * 1024;

export class OverlayError extends Error {}

export function supportsOverlays(type: string): boolean {
  return LAYERED_TYPES.has(type);
}

/** `skills/<name>/` for a skill; `commands/<name>` or `agents/<name>` (file or folder) otherwise. */
function allowedPrefix(type: ArtifactType, name: string): string {
  const main = artifactTypeDef(type).mainFile(name);
  const parts = main.split("/");
  return parts.length >= 3 ? `${parts.slice(0, -1).join("/")}/` : main.replace(/\.[^.]+$/, "");
}

function parseOp(v: unknown, prefix: string): OverlayOp {
  const o = (v ?? {}) as Record<string, unknown>;
  if (typeof o.op !== "string" || !OPS.has(o.op))
    throw new OverlayError("op must be append, replace or add");
  if (typeof o.path !== "string" || o.path.length > 256) throw new OverlayError("path is required");
  const segments = o.path.split("/");
  if (
    o.path.includes("\\") ||
    o.path.startsWith("/") ||
    segments.some((s) => s === ".." || s === "." || s === "")
  ) {
    throw new OverlayError(`unsafe path ${o.path}`);
  }
  if (!o.path.startsWith(prefix)) throw new OverlayError(`path must be inside ${prefix}`);
  if (typeof o.text !== "string" || o.text.length > MAX_TEXT)
    throw new OverlayError("text must be up to 64 KiB");
  return { op: o.op as OverlayOp["op"], path: o.path, text: o.text };
}

export function parseOverlay(body: unknown, type: ArtifactType, name: string): OverlayOp[] {
  const ops = (body as { ops?: unknown } | null)?.ops;
  if (!Array.isArray(ops) || ops.length > MAX_OPS)
    throw new OverlayError(`ops must be a list of up to ${MAX_OPS}`);
  const prefix = allowedPrefix(type, name);
  return ops.map((op) => parseOp(op, prefix));
}

/** Saves the layer; an empty list removes it. */
export function saveOverlay(
  db: Database,
  artifactId: string,
  scope: string,
  ops: OverlayOp[],
  actor: string,
) {
  if (ops.length === 0) {
    db.prepare("DELETE FROM artifact_overlays WHERE artifact_id = ? AND scope = ?").run(
      artifactId,
      scope,
    );
    return;
  }
  db.prepare(
    `INSERT INTO artifact_overlays (artifact_id, scope, ops, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(artifact_id, scope) DO UPDATE SET ops = excluded.ops, updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
  ).run(artifactId, scope, JSON.stringify(ops), actor, new Date().toISOString());
}

type Row = { scope: string; ops: string; updated_by: string; updated_at: string };

/** The layers that apply to `username`, in order: company, the person's teams by name, the person's own. */
export function layersFor(db: Database, artifactId: string, username: string): Layer[] {
  const rows = new Map(
    (
      db
        .prepare(
          "SELECT scope, ops, updated_by, updated_at FROM artifact_overlays WHERE artifact_id = ?",
        )
        .all(artifactId) as Row[]
    ).map((r) => [r.scope, r]),
  );
  const teams = db
    .prepare(
      `SELECT t.id, t.name FROM team_members m JOIN teams t ON t.id = m.team_id
       WHERE m.username = ? COLLATE NOCASE ORDER BY t.name`,
    )
    .all(username) as Array<{ id: string; name: string }>;
  const wanted: Array<[string, string]> = [
    ["company", "company"],
    ...teams.map((t): [string, string] => [`team:${t.id}`, `team:${t.name}`]),
    [`user:${username.toLowerCase()}`, `user:${username.toLowerCase()}`],
  ];
  const out: Layer[] = [];
  for (const [key, label] of wanted) {
    const r = rows.get(key);
    if (r)
      out.push({
        scope: label,
        ops: JSON.parse(r.ops) as OverlayOp[],
        updated_by: r.updated_by,
        updated_at: r.updated_at,
      });
  }
  return out;
}
