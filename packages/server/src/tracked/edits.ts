/**
 * Edit rules of a tracked source (tracked-sources): the local changes a registry keeps over upstream content — delete
 * files by a glob, replace an exact string in a file. Applied to every download before parsing; a rule that finds
 * nothing means upstream moved on, and the check stops (`edits_outdated`) instead of publishing something else.
 */
export type SourceEdit =
  { op: "delete"; glob: string } | { op: "replace"; file: string; find: string; with: string };

export type EditFile = { path: string; content: Buffer };

const MAX_EDITS = 50;
const MAX_TEXT = 10_000;

/** A relative path inside the folder: no absolute path, no `..`, no backslash, no empty segment. */
function safeRelative(p: unknown): p is string {
  return (
    typeof p === "string" &&
    p.length > 0 &&
    p.length <= 300 &&
    !p.startsWith("/") &&
    !p.includes("\\") &&
    p.split("/").every((s) => s !== "" && s !== "." && s !== "..")
  );
}

function parseEdit(raw: unknown): SourceEdit | null {
  const e = (raw ?? {}) as Record<string, unknown>;
  if (e.op === "delete" && Object.keys(e).length === 2)
    return safeRelative(e.glob) ? { op: "delete", glob: e.glob } : null;
  if (e.op !== "replace" || Object.keys(e).length !== 4) return null;
  const ok =
    safeRelative(e.file) &&
    typeof e.find === "string" &&
    e.find.length > 0 &&
    e.find.length <= MAX_TEXT &&
    typeof e.with === "string" &&
    e.with.length <= MAX_TEXT;
  return ok
    ? { op: "replace", file: e.file as string, find: e.find as string, with: e.with as string }
    : null;
}

export function parseEdits(raw: unknown): { ok: true; edits: SourceEdit[] } | { ok: false } {
  if (!Array.isArray(raw) || raw.length > MAX_EDITS) return { ok: false };
  const edits = raw.map(parseEdit);
  return edits.every((e) => e !== null)
    ? { ok: true, edits: edits as SourceEdit[] }
    : { ok: false };
}

/** `*` — any characters except `/`; `**` — any characters including `/`. */
function globRe(glob: string): RegExp {
  const body = glob
    .split("**")
    .map((part) => part.replace(/[.+^${}()|[\]\\?]/g, "\\$&").replace(/\*/g, "[^/]*"))
    .join(".*");
  return new RegExp(`^${body}$`);
}

export function applyEdits(
  files: EditFile[],
  edits: SourceEdit[],
): { ok: true; files: EditFile[] } | { ok: false; error: "edits_outdated"; edit: SourceEdit } {
  let out = files;
  for (const edit of edits) {
    if (edit.op === "delete") {
      const re = globRe(edit.glob);
      const kept = out.filter((f) => !re.test(f.path));
      if (kept.length === out.length) return { ok: false, error: "edits_outdated", edit };
      out = kept;
      continue;
    }
    const target = out.find((f) => f.path === edit.file);
    const text = target?.content.toString("utf8");
    if (!target || text === undefined || !text.includes(edit.find))
      return { ok: false, error: "edits_outdated", edit };
    const next = Buffer.from(text.split(edit.find).join(edit.with), "utf8");
    out = out.map((f) => (f === target ? { path: f.path, content: next } : f));
  }
  return { ok: true, files: out };
}
