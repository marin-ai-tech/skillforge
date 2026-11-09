// The judge of the review-assistant plugin: built-in merging of findings from successful reviewers and, optionally,
// a judge command with a fallback to the built-in one. ES module without a build step.
import { extractFindings, parseFinding, spawnCommand } from "./runner.js";

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

function sameGroup(a, b) {
  if (a.category !== b.category) return false;
  if (a.file !== b.file) return false;
  if (a.line === null || a.line === undefined) return b.line === null || b.line === undefined;
  if (b.line === null || b.line === undefined) return false;
  return Math.abs(a.line - b.line) <= 3;
}

/** Built-in merging: one finding per group, agreement "N of M". */
export function mergeBuiltin(reviewers) {
  const okReviewers = reviewers.filter((r) => r.status === "ok");
  const of = okReviewers.length;
  const groups = [];
  for (const reviewer of okReviewers) {
    for (const f of reviewer.findings ?? []) {
      let group = groups.find((g) => sameGroup(g, f));
      if (!group) {
        group = {
          severity: f.severity,
          category: f.category,
          file: f.file,
          line: f.line,
          summary: f.summary,
          suggestion: f.suggestion,
          reviewers: [],
          _sev: SEVERITY_RANK[f.severity] ?? 1,
        };
        groups.push(group);
      }
      if (!group.reviewers.includes(reviewer.id)) group.reviewers.push(reviewer.id);
      const fSev = SEVERITY_RANK[f.severity] ?? 1;
      if (fSev > group._sev) {
        group._sev = fSev;
        group.severity = f.severity;
        group.summary = f.summary;
        group.suggestion = f.suggestion;
      }
    }
  }
  return groups
    .map(({ _sev, ...g }) => ({
      severity: g.severity,
      category: g.category,
      file: g.file,
      line: g.line,
      summary: g.summary,
      suggestion: g.suggestion,
      reviewers: g.reviewers,
      agreed: g.reviewers.length,
      of,
    }))
    .sort((a, b) => {
      if (SEVERITY_RANK[b.severity] !== SEVERITY_RANK[a.severity])
        return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      if (b.agreed !== a.agreed) return b.agreed - a.agreed;
      return a.category.localeCompare(b.category);
    });
}

/** Merges findings: the judge command if present, falling back to the built-in merging. */
export async function judge(findingsByReviewer, artifact, judgeCmd, _timeoutS) {
  const builtin = mergeBuiltin(findingsByReviewer);
  if (!judgeCmd || !Array.isArray(judgeCmd.command) || judgeCmd.command.length === 0) {
    return { status: "builtin", error: null, findings: builtin };
  }

  const okReviewers = findingsByReviewer.filter((r) => r.status === "ok");
  const of = okReviewers.length;
  const stdin = JSON.stringify({
    artifact,
    reviewers: okReviewers.map((r) => ({ id: r.id, status: r.status, findings: r.findings })),
  });

  const result = await spawnCommand(judgeCmd.command, {
    timeoutS: judgeCmd.timeout_s ?? 300,
    stdin,
  });
  if (result.timedOut || result.code !== 0 || result.error) {
    return {
      status: "failed",
      error: tail(result.stderr || result.error || "judge failed"),
      findings: builtin,
    };
  }
  if (result.outTruncated) {
    return { status: "failed", error: "judge stdout too large", findings: builtin };
  }

  const raw = extractFindings(result.stdout);
  if (raw === null) {
    return { status: "failed", error: "invalid judge output", findings: builtin };
  }
  const validFiles = new Set(artifactFiles(artifact));
  const findings = raw
    .filter((f) => f && typeof f === "object" && !Array.isArray(f))
    .map((f) => {
      const parsed = parseFinding(f, validFiles);
      if (!parsed) return null;
      const reviewers = Array.isArray(f.reviewers)
        ? f.reviewers.filter((x) => typeof x === "string")
        : [];
      return {
        severity: parsed.severity,
        category: parsed.category,
        file: parsed.file,
        line: parsed.line,
        summary: parsed.summary,
        suggestion: parsed.suggestion,
        reviewers,
        agreed: reviewers.length,
        of,
      };
    })
    .filter(Boolean);
  if (findings.length === 0) {
    return { status: "failed", error: "no judge findings", findings: builtin };
  }
  return { status: "ok", error: null, findings };
}

function artifactFiles(artifact) {
  return artifact.files ? artifact.files.map((f) => f.path) : [];
}

function tail(text) {
  const s = text ?? "";
  return s.length > 2048 ? s.slice(-2048) : s;
}
