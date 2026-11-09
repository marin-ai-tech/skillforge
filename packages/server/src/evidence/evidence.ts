import type { Database } from "../repo.ts";

export const EVIDENCE_KINDS = ["gate", "run", "diff", "review", "eval", "ablation"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const MAX_EVIDENCE_PER_VERSION = 100;
export const MAX_EVIDENCE_URL = 2048;
export const MAX_EVIDENCE_SUMMARY = 500;
/** Evidence document (evidence-documents): UTF-8 text up to 64 KiB with a plain file name. */
export const MAX_EVIDENCE_DOCUMENT_BYTES = 65536;
const DOCUMENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Stored with the record; the text itself is a blob addressed by sha256. */
export type EvidenceDocument = { name: string; sha256: string; size: number };
/** A document as received, before it is stored. */
export type EvidenceDocumentText = { name: string; text: string };

export type AblationData = {
  tasks: number;
  passed_with: number;
  passed_without: number;
  runner?: string;
  uplift: number;
};

export type EvidenceRecord = {
  kind: string;
  url: string;
  summary: string | null;
  at: string | null;
  by: string | null;
  data?: AblationData;
  /** Present for ablation (mirrors data.uplift) for API consumers. */
  uplift?: number;
  document?: EvidenceDocument;
};

export type EvidenceInput = {
  kind: EvidenceKind;
  url: string;
  summary: string | null;
  data?: AblationData;
  document?: EvidenceDocument;
};

/** `value.url` is empty when `document` is set: the route stores the text and fills the registry path. */
export type EvidenceParse =
  | { ok: true; value: EvidenceInput; document?: EvidenceDocumentText }
  | {
      ok: false;
      error:
        | "kind_invalid"
        | "url_invalid"
        | "document_invalid"
        | "summary_invalid"
        | "ablation_invalid";
    };

/** No lone surrogates: the text survives a UTF-8 round trip unchanged. */
function wellFormed(text: string): boolean {
  return Buffer.from(text, "utf8").toString("utf8") === text;
}

function parseDocument(raw: unknown): EvidenceDocumentText | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.name !== "string" || !DOCUMENT_NAME.test(d.name)) return null;
  if (typeof d.text !== "string" || d.text.includes("\u0000") || !wellFormed(d.text)) return null;
  if (Buffer.byteLength(d.text, "utf8") > MAX_EVIDENCE_DOCUMENT_BYTES) return null;
  return { name: d.name, text: d.text };
}

/** Exactly one of `url` and `document` (evidence-documents). */
function parseSource(
  b: Record<string, unknown>,
): { url: string; document?: EvidenceDocumentText } | "url_invalid" | "document_invalid" {
  if (b.document === undefined) return isSafeEvidenceUrl(b.url) ? { url: b.url } : "url_invalid";
  if (b.url !== undefined) return "document_invalid";
  const document = parseDocument(b.document);
  return document ? { url: "", document } : "document_invalid";
}

function isEvidenceKind(v: unknown): v is EvidenceKind {
  return typeof v === "string" && (EVIDENCE_KINDS as readonly string[]).includes(v);
}

/**
 * Accepts `https://…`, `http://…` with a host, or a registry path `/…`.
 * Whitespace, control characters and backslashes are rejected so a browser cannot
 * reinterpret the value (e.g. `/\evil.example` as protocol-relative).
 */
export function isSafeEvidenceUrl(v: unknown): v is string {
  if (typeof v !== "string" || v.length === 0 || v.length > MAX_EVIDENCE_URL) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0020\u007f\\]/.test(v)) return false;
  if (v.startsWith("/")) return !v.startsWith("//");
  if (!/^https?:\/\//i.test(v)) return false;
  try {
    const u = new URL(v);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.length > 0;
  } catch {
    return false;
  }
}

export function computeUplift(tasks: number, passedWith: number, passedWithout: number): number {
  return Math.round(((passedWith - passedWithout) / tasks) * 1000) / 1000;
}

function isIntegerInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/** Optional runner label (≤ 64 chars); null means the value is invalid. */
function parseAblationRunner(raw: unknown): { runner: string | undefined } | null {
  if (raw === undefined || raw === null) return { runner: undefined };
  if (typeof raw !== "string" || raw.length > 64) return null;
  return { runner: raw };
}

function parseAblationData(raw: unknown): AblationData | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  if (!isIntegerInRange(d.tasks, 1, 1000)) return null;
  if (!isIntegerInRange(d.passed_with, 0, d.tasks)) return null;
  if (!isIntegerInRange(d.passed_without, 0, d.tasks)) return null;
  const parsedRunner = parseAblationRunner(d.runner);
  if (!parsedRunner) return null;
  const runner = parsedRunner.runner;
  const uplift = computeUplift(d.tasks, d.passed_with, d.passed_without);
  const out: AblationData = {
    tasks: d.tasks,
    passed_with: d.passed_with,
    passed_without: d.passed_without,
    uplift,
  };
  if (runner !== undefined) out.runner = runner;
  return out;
}

/** Optional summary (≤ MAX_EVIDENCE_SUMMARY; empty → null); null means the value is invalid. */
function parseEvidenceSummary(raw: unknown): { summary: string | null } | null {
  if (raw === undefined || raw === null) return { summary: null };
  if (typeof raw !== "string" || raw.length > MAX_EVIDENCE_SUMMARY) return null;
  return { summary: raw.length > 0 ? raw : null };
}

/** Boundary parse of a REST evidence body; client `at`/`by` are ignored. */
export function parseEvidenceInput(body: unknown): EvidenceParse {
  const b = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<
    string,
    unknown
  >;
  if (!isEvidenceKind(b.kind)) return { ok: false, error: "kind_invalid" };
  const source = parseSource(b);
  if (typeof source === "string") return { ok: false, error: source };
  const { url, document } = source;
  const parsedSummary = parseEvidenceSummary(b.summary);
  if (!parsedSummary) return { ok: false, error: "summary_invalid" };
  const summary = parsedSummary.summary;

  const hasData = b.data !== undefined && b.data !== null;
  if (b.kind === "ablation") {
    if (!hasData) return { ok: false, error: "ablation_invalid" };
    const data = parseAblationData(b.data);
    if (!data) return { ok: false, error: "ablation_invalid" };
    if (document) return { ok: false, error: "ablation_invalid" };
    return { ok: true, value: { kind: b.kind, url, summary, data } };
  }
  if (hasData) return { ok: false, error: "ablation_invalid" };
  return { ok: true, value: { kind: b.kind, url, summary }, ...(document ? { document } : {}) };
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function storedDocument(raw: unknown): EvidenceDocument | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  const ok =
    typeof d.name === "string" &&
    typeof d.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(d.sha256) &&
    typeof d.size === "number";
  return ok ? { name: d.name as string, sha256: d.sha256 as string, size: d.size as number } : null;
}

/** Stored evidence JSON → records; entries written before `at`/`by` existed read as `null`. */
export function normalizeEvidence(raw: unknown): EvidenceRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: EvidenceRecord[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    const rec: EvidenceRecord = {
      kind: str(r.kind) ?? "",
      url: str(r.url) ?? "",
      summary: str(r.summary),
      at: str(r.at),
      by: str(r.by),
    };
    const doc = storedDocument(r.document);
    if (doc) rec.document = doc;
    if (r.data && typeof r.data === "object" && !Array.isArray(r.data)) {
      const d = r.data as Record<string, unknown>;
      const tasks = Number(d.tasks);
      const passed_with = Number(d.passed_with);
      const passed_without = Number(d.passed_without);
      const uplift =
        typeof d.uplift === "number"
          ? d.uplift
          : Number.isFinite(tasks) && tasks > 0
            ? computeUplift(tasks, passed_with, passed_without)
            : 0;
      const data: AblationData = { tasks, passed_with, passed_without, uplift };
      if (typeof d.runner === "string") data.runner = d.runner;
      rec.data = data;
      rec.uplift = uplift;
    }
    out.push(rec);
  }
  return out;
}

export function ablationSummaryFromEvidence(evidence: EvidenceRecord[]): {
  tasks: number;
  passed_with: number;
  passed_without: number;
  uplift: number;
  at: string | null;
  by: string | null;
} | null {
  let best: {
    tasks: number;
    passed_with: number;
    passed_without: number;
    uplift: number;
    at: string | null;
    by: string | null;
  } | null = null;
  for (const e of evidence) {
    if (e.kind !== "ablation" || !e.data) continue;
    if (best && e.at && best.at && e.at < best.at) continue;
    best = {
      tasks: e.data.tasks,
      passed_with: e.data.passed_with,
      passed_without: e.data.passed_without,
      uplift: e.data.uplift,
      at: e.at,
      by: e.by,
    };
  }
  return best;
}

export function readEvidence(
  db: Database,
  artifactId: string,
  version: string,
): { evidence: EvidenceRecord[]; validated_at: string | null } | null {
  const row = db
    .prepare(
      "SELECT evidence, validated_at FROM artifact_versions WHERE artifact_id = ? AND version = ?",
    )
    .get(artifactId, version) as { evidence: string; validated_at: string | null } | undefined;
  if (!row) return null;
  return { evidence: normalizeEvidence(JSON.parse(row.evidence)), validated_at: row.validated_at };
}

export type AppendEvidenceResult =
  | { kind: "not_found" }
  | { kind: "duplicate" | "created"; evidence: EvidenceRecord[]; validated_at: string | null }
  | { kind: "limit" };

/**
 * Appends one server-stamped record. Must run inside the caller's `BEGIN IMMEDIATE`.
 * A duplicate `(kind, url)` leaves the version untouched; a new `gate` record moves
 * `validated_at` forward to its `at`. Ablation never sets `validated_at`.
 */
export function appendEvidence(
  db: Database,
  artifactId: string,
  version: string,
  input: EvidenceInput,
  by: string,
  at: string,
): AppendEvidenceResult {
  const current = readEvidence(db, artifactId, version);
  if (!current) return { kind: "not_found" };
  if (current.evidence.some((e) => e.kind === input.kind && e.url === input.url)) {
    return { kind: "duplicate", ...current };
  }
  if (current.evidence.length >= MAX_EVIDENCE_PER_VERSION) return { kind: "limit" };
  const record: EvidenceRecord = {
    kind: input.kind,
    url: input.url,
    summary: input.summary,
    at,
    by,
  };
  if (input.document) record.document = input.document;
  if (input.data) {
    record.data = input.data;
    if (input.kind === "ablation") record.uplift = input.data.uplift;
  }
  const next = [...current.evidence, record];
  let validatedAt = current.validated_at;
  if (input.kind === "gate" && (validatedAt === null || validatedAt < at)) validatedAt = at;
  db.prepare(
    "UPDATE artifact_versions SET evidence = ?, validated_at = ? WHERE artifact_id = ? AND version = ?",
  ).run(JSON.stringify(next), validatedAt, artifactId, version);
  return { kind: "created", evidence: next, validated_at: validatedAt };
}
