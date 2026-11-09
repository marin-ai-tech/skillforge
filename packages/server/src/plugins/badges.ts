import type { Database } from "../db.ts";

/**
 * Plugin badges on artifact cards. A plugin sets a badge, the core stores it,
 * and the catalog never calls plugin code per card; a disabled plugin's badges are not shown.
 */
export type BadgeTone = "ok" | "info" | "warn" | "danger";
/** Badge labels by interface language (a known two- or three-letter code); `label` is the fallback. */
const LANG_NAMES = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" });
const isLang = (code: string): boolean =>
  /^[a-z]{2,3}$/.test(code) && LANG_NAMES.of(code) !== undefined;
export type BadgeLabels = Partial<Record<string, string>>;
export type ArtifactBadge = {
  plugin: string;
  id: string;
  label: string;
  labels: BadgeLabels;
  tone: BadgeTone;
  updated_at: string;
};
type BadgeInput = { id: string; label: string; labels: BadgeLabels; tone: BadgeTone };

const labelOk = (v: unknown): v is string =>
  typeof v === "string" && v.trim() !== "" && v.length <= 40;

function parseLabels(v: unknown): BadgeLabels {
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v))
    throw new Error("badge labels must be an object of language to text");
  const out: BadgeLabels = {};
  for (const [lang, text] of Object.entries(v as Record<string, unknown>)) {
    if (!isLang(lang)) throw new Error(`badge labels: unknown language ${lang}`);
    if (!labelOk(text)) throw new Error("badge labels must be 1..40 characters");
    out[lang] = text.trim();
  }
  return out;
}

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TONES = new Set<string>(["ok", "info", "warn", "danger"]);

export function parseBadge(v: unknown): BadgeInput {
  const o = (v ?? {}) as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id.length > 32 || !ID_RE.test(o.id)) {
    throw new Error("badge id must be kebab-case, up to 32 characters");
  }
  if (!labelOk(o.label)) {
    throw new Error("badge label must be 1..40 characters");
  }
  if (typeof o.tone !== "string" || !TONES.has(o.tone))
    throw new Error("badge tone must be ok, info, warn or danger");
  return {
    id: o.id,
    label: o.label.trim(),
    labels: parseLabels(o.labels),
    tone: o.tone as BadgeTone,
  };
}

export function setBadge(db: Database, artifactId: string, plugin: string, badge: BadgeInput) {
  db.prepare(
    `INSERT INTO artifact_badges (artifact_id, plugin, badge_id, label, labels, tone, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(artifact_id, plugin, badge_id) DO UPDATE SET label = excluded.label, labels = excluded.labels,
       tone = excluded.tone, updated_at = excluded.updated_at`,
  ).run(
    artifactId,
    plugin,
    badge.id,
    badge.label,
    JSON.stringify(badge.labels),
    badge.tone,
    new Date().toISOString(),
  );
}

export function clearBadge(db: Database, artifactId: string, plugin: string, id: string) {
  db.prepare(
    "DELETE FROM artifact_badges WHERE artifact_id = ? AND plugin = ? AND badge_id = ?",
  ).run(artifactId, plugin, id);
}

/** Badges of enabled plugins only. */
export function listBadges(db: Database, artifactId: string): ArtifactBadge[] {
  const rows = db
    .prepare(
      `SELECT b.plugin, b.badge_id AS id, b.label, b.labels, b.tone, b.updated_at FROM artifact_badges b
       JOIN plugins p ON p.name = b.plugin AND p.enabled = 1
       WHERE b.artifact_id = ? ORDER BY b.plugin, b.badge_id`,
    )
    .all(artifactId) as Array<Omit<ArtifactBadge, "labels"> & { labels: string | null }>;
  return rows.map((r) => ({ ...r, labels: r.labels ? (JSON.parse(r.labels) as BadgeLabels) : {} }));
}
