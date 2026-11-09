import {
  QUALITY_CODES,
  type Issue,
  type ParsedArtifact,
  type QualityReport,
} from "@skillforge/core";
import type { Database } from "../repo.ts";

/**
 * Company and team quality rules as a publish gate. The score is
 * `100 − Σ weights of what is not met`; a team can only tighten the company's rules, and the rules of an artifact are
 * the company's merged with its team's, so a team never ends up looser even after the company tightens.
 */
export type CriterionType = "require_heading" | "require_file" | "forbid_phrase";
export type Enforce = "off" | "warn" | "block";
export type RubricCriterion = { id: string; type: CriterionType; value: string; weight: number };
export type Rubric = {
  threshold: number;
  enforce: Enforce;
  weights: Record<string, number>;
  criteria: RubricCriterion[];
};
export type RubricResult = {
  score: number;
  threshold: number;
  enforce: Exclude<Enforce, "off">;
  passed: boolean;
  failed: Array<{ id: string; weight: number }>;
};

export const EMPTY_RUBRIC: Rubric = { threshold: 0, enforce: "off", weights: {}, criteria: [] };

const ENFORCE_ORDER: Record<Enforce, number> = { off: 0, warn: 1, block: 2 };
const TYPES = new Set<string>(["require_heading", "require_file", "forbid_phrase"]);
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_CRITERIA = 50;
const MAX_VALUE = 200;
const FIELDS = new Set(["threshold", "enforce", "weights", "criteria"]);

export class RubricError extends Error {}

function percent(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 100) {
    throw new RubricError(`${what} must be an integer 0..100`);
  }
  return v;
}

function parseWeights(v: unknown): Record<string, number> {
  if (v === undefined) return {};
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new RubricError("weights must be an object");
  const out: Record<string, number> = {};
  for (const [code, w] of Object.entries(v as Record<string, unknown>)) {
    if (!(code in QUALITY_CODES)) throw new RubricError(`unknown quality code ${code}`);
    out[code] = percent(w, `weight of ${code}`);
  }
  return out;
}

function parseCriterion(v: unknown): RubricCriterion {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new RubricError("criterion must be an object");
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id.length > 64 || !ID_RE.test(o.id)) {
    throw new RubricError("criterion id must be kebab-case");
  }
  if (typeof o.type !== "string" || !TYPES.has(o.type)) {
    throw new RubricError("criterion type must be require_heading, require_file or forbid_phrase");
  }
  if (typeof o.value !== "string" || o.value.trim() === "" || o.value.length > MAX_VALUE) {
    throw new RubricError(`criterion value must be 1..${MAX_VALUE} characters`);
  }
  return {
    id: o.id,
    type: o.type as CriterionType,
    value: o.value.trim(),
    weight: percent(o.weight, "weight"),
  };
}

function parseCriteria(v: unknown): RubricCriterion[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > MAX_CRITERIA) {
    throw new RubricError(`criteria must be a list of at most ${MAX_CRITERIA}`);
  }
  const list = v.map(parseCriterion);
  if (new Set(list.map((c) => c.id)).size !== list.length)
    throw new RubricError("criterion ids must be unique");
  return list;
}

/** The body parsed into rules at the boundary; unknown fields and out-of-range values are refused. */
export function parseRubric(body: unknown): Rubric {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new RubricError("body must be an object");
  const o = body as Record<string, unknown>;
  for (const key of Object.keys(o))
    if (!FIELDS.has(key)) throw new RubricError(`unknown field ${key}`);
  const enforce = o.enforce ?? "off";
  if (typeof enforce !== "string" || !(enforce in ENFORCE_ORDER)) {
    throw new RubricError("enforce must be off, warn or block");
  }
  return {
    threshold: o.threshold === undefined ? 0 : percent(o.threshold, "threshold"),
    enforce: enforce as Enforce,
    weights: parseWeights(o.weights),
    criteria: parseCriteria(o.criteria),
  };
}

/** What in the team's rules is looser than the company's; empty when the team only tightens. */
export function looserThan(company: Rubric, team: Rubric): string[] {
  const out: string[] = [];
  if (team.threshold < company.threshold) out.push("threshold");
  if (ENFORCE_ORDER[team.enforce] < ENFORCE_ORDER[company.enforce]) out.push("enforce");
  for (const [code, w] of Object.entries(company.weights)) {
    if (team.weights[code] !== undefined && team.weights[code]! < w) out.push(`weights.${code}`);
  }
  return out;
}

export function mergeRubrics(company: Rubric, team: Rubric | null): Rubric {
  if (!team) return company;
  const weights = { ...company.weights };
  for (const [code, w] of Object.entries(team.weights))
    weights[code] = Math.max(weights[code] ?? 0, w);
  const criteria = new Map(company.criteria.map((c) => [c.id, c]));
  for (const c of team.criteria) {
    const prev = criteria.get(c.id);
    criteria.set(c.id, prev && prev.weight >= c.weight ? prev : c);
  }
  return {
    threshold: Math.max(company.threshold, team.threshold),
    enforce:
      ENFORCE_ORDER[team.enforce] > ENFORCE_ORDER[company.enforce] ? team.enforce : company.enforce,
    weights,
    criteria: [...criteria.values()],
  };
}

function scope(db: Database, teamName: string | null): string | null {
  if (teamName === null) return "company";
  const row = db.prepare("SELECT id FROM teams WHERE name = ?").get(teamName) as
    { id: string } | undefined;
  return row ? `team:${row.id}` : null;
}

export function loadRubric(db: Database, teamName: string | null): Rubric | null {
  const key = scope(db, teamName);
  if (!key) return null;
  const row = db.prepare("SELECT settings FROM quality_rubrics WHERE scope = ?").get(key) as
    { settings: string } | undefined;
  if (!row) return null;
  try {
    return parseRubric(JSON.parse(row.settings));
  } catch {
    return null;
  }
}

export function saveRubric(
  db: Database,
  teamName: string | null,
  rubric: Rubric,
  actor: string,
): void {
  const key = scope(db, teamName);
  if (!key) throw new RubricError("team not found");
  db.prepare(
    `INSERT INTO quality_rubrics (scope, settings, updated_by, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(scope) DO UPDATE SET settings = excluded.settings, updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(rubric), actor, new Date().toISOString());
}

function text(content: ParsedArtifact["canonical"][number]["content"]): string {
  return typeof content === "string" ? content : Buffer.from(content).toString("utf8");
}

const HEADING_RE = /^#{1,6}\s+(.+?)\s*#*\s*$/;

function criterionMet(c: RubricCriterion, artifact: ParsedArtifact): boolean {
  const files = artifact.canonical;
  const want = c.value.toLowerCase();
  if (c.type === "require_file") {
    return files.some((f) => f.path === c.value || f.path.endsWith(`/${c.value}`));
  }
  if (c.type === "require_heading") {
    return files
      .filter((f) => f.path.toLowerCase().endsWith(".md"))
      .some((f) =>
        text(f.content)
          .split(/\r?\n/)
          .some((line) => HEADING_RE.exec(line)?.[1]?.trim().toLowerCase() === want),
      );
  }
  return !files.some((f) => text(f.content).toLowerCase().includes(want));
}

/** Null when the rules are off: no score, as if there were no rules. */
export function evaluateRubric(
  rubric: Rubric,
  quality: QualityReport,
  artifact: ParsedArtifact,
): RubricResult | null {
  if (rubric.enforce === "off") return null;
  const failed: RubricResult["failed"] = quality.checks.map((check) => ({
    id: check.code,
    weight: rubric.weights[check.code] ?? (check.severity === "warn" ? 15 : 5),
  }));
  for (const c of rubric.criteria) {
    if (!criterionMet(c, artifact)) failed.push({ id: c.id, weight: c.weight });
  }
  const score = Math.max(0, 100 - failed.reduce((n, f) => n + f.weight, 0));
  return {
    score,
    threshold: rubric.threshold,
    enforce: rubric.enforce,
    passed: score >= rubric.threshold,
    failed,
  };
}

/** The rules of an artifact owned by `teamName` (or by nobody), evaluated. */
export function rubricFor(
  db: Database,
  teamName: string | null,
  quality: QualityReport,
  artifact: ParsedArtifact,
): RubricResult | null {
  const company = loadRubric(db, null) ?? EMPTY_RUBRIC;
  const team = teamName ? loadRubric(db, teamName) : null;
  return evaluateRubric(mergeRubrics(company, team), quality, artifact);
}

export function rubricBlock(result: RubricResult | null): Issue | null {
  if (!result || result.enforce !== "block" || result.passed) return null;
  return {
    code: "E_RUBRIC_BLOCKED",
    message: `Company quality rules block publishing: score ${result.score} is below ${result.threshold} (${result.failed.map((f) => f.id).join(", ")})`,
  };
}
