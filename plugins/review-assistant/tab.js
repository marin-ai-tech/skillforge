// The "Review" tab of the review-assistant plugin: summary of the latest run, finding sections with actions,
// escaping of all finding text for markdown (not HTML escaping). ES module without a build step.

// Markdown escaping: neutralizes metacharacters so a finding text does not become a link,
// a tracking-pixel image, HTML or a table. `.` and `/` stay so that ordinary phrases read as they are.
const MD_SPECIALS = /([\\`*_{}[\]()#+\-!|<>&~])/g;

/** Runs paid from an Agent Space task budget (llm-budget-broker) have two more states. */
const STATUS_NOTES = {
  interrupted:
    "The run stopped before it finished (a server restart or no budget grant in memory); Agent Space resumes it with a new grant.",
  awaiting_publication: "The check waits for this version to be published.",
};

export function escapeMarkdown(text) {
  if (typeof text !== "string") return "";
  return text.replace(MD_SPECIALS, "\\$1");
}

function loadFindings(ctx, runId) {
  return ctx.db
    .prepare("SELECT * FROM ext_review_assistant_findings WHERE run_id = ? ORDER BY id")
    .all(runId);
}

function latestRun(ctx, artifact) {
  return ctx.db
    .prepare(
      "SELECT * FROM ext_review_assistant_runs WHERE artifact_type = ? AND artifact_name = ? ORDER BY created_at DESC, id DESC LIMIT 1",
    )
    .get(artifact.type, artifact.name);
}

function canDecide(user) {
  return Boolean(user && (user.role === "reviewer" || user.role === "admin"));
}

function sevMark(severity) {
  return { high: "🔴 high", medium: "🟠 medium", low: "🟡 low" }[severity] ?? severity;
}

const DECISION_LABELS = {
  fix: "Fix",
  verify: "Verify",
  defer: "Defer",
  reject: "Reject",
};

/** What checked and when; no promises: the model makes mistakes, and the skill text may influence it. */
function modelCheckLine(r, run) {
  const parts = [
    `Checked by model \`${escapeMarkdown(r.model)}\` on ${escapeMarkdown(run.finished_at ?? run.created_at)}: ${r.findings_count} finding(s).`,
  ];
  if (r.dropped_findings > 0) {
    parts.push(`${r.dropped_findings} more discarded: their quotes are not in the files.`);
  }
  if (r.truncated) parts.push("Only part of the content was checked.");
  parts.push("No findings does not mean the skill is safe to use; a reviewer decides.");
  return parts.join(" ");
}

function renderSummary(ctx, artifact, run) {
  const lines = [];
  if (!run) {
    lines.push(
      `No review run yet for **${artifact.type}/${artifact.name}** @ \`${artifact.latest_version ?? "n/a"}\`.`,
    );
    return lines.join("\n");
  }
  lines.push(
    `**Review run #${run.id}** — status: \`${run.status}\` (trigger: \`${run.trigger}\`).`,
  );
  const note = STATUS_NOTES[run.status];
  if (note) lines.push(note);
  const reviewers = JSON.parse(run.reviewers);
  if (Array.isArray(reviewers)) {
    for (const r of reviewers) {
      if (r.id === "llm" && r.model) lines.push(modelCheckLine(r, run));
      lines.push(
        `- \`${r.id}\`: \`${r.status}\`${r.duration_ms != null ? ` (${r.duration_ms} ms)` : ""}${r.error ? ` — ${escapeMarkdown(String(r.error))}` : ""}`,
      );
    }
  }
  if (run.judge) {
    const judge = JSON.parse(run.judge);
    lines.push(
      `- judge: \`${judge.status}\`${judge.error ? ` — ${escapeMarkdown(String(judge.error))}` : ""}`,
    );
  }
  if (run.error) {
    lines.push(`- error: ${escapeMarkdown(String(run.error))}`);
  }
  return lines.join("\n");
}

/** One finding section of the tab: markdown + decision actions (if the user may decide). */
function findingSection(f, decide) {
  const loc = f.file ? `${escapeMarkdown(f.file)}${f.line ? ":" + f.line : ""}` : "—";
  const decision = f.decision
    ? `${DECISION_LABELS[f.decision] ?? f.decision} by ${escapeMarkdown(f.decided_by ?? "?")}${f.decision_note ? ` — ${escapeMarkdown(f.decision_note)}` : ""}`
    : "no decision";
  const body = [
    `${sevMark(f.severity)} · \`${escapeMarkdown(f.category)}\` · ${loc}`,
    `Agreement: **${f.agreed}/${f.of}** (${f.reviewers ? escapeMarkdown(JSON.parse(f.reviewers).join(", ")) : ""})`,
    "",
    `**Summary:** ${escapeMarkdown(f.summary)}`,
  ];
  if (f.suggestion) body.push("", `**Suggestion:** ${escapeMarkdown(f.suggestion)}`);
  body.push("", `**Decision:** ${decision}`);

  const sectionActions = decide
    ? ["fix", "verify", "defer", "reject"].map((d) => ({
        id: d,
        label: DECISION_LABELS[d],
        path: `/findings/${f.id}/decision`,
        body: { decision: d },
      }))
    : [];

  return { id: `finding-${f.id}`, markdown: body.join("\n"), actions: sectionActions };
}

/** Renders the tab response: summary + finding sections with actions. */
export function renderReviewTab(ctx, artifact, version, user, llmActive = false) {
  const run = latestRun(ctx, artifact);
  const decide = canDecide(user);

  const actions = [];
  if (decide) {
    actions.push({
      id: "run",
      label: "Run review",
      path: "/runs",
      body: { type: artifact.type, name: artifact.name },
    });
    if (llmActive && artifact.type === "skill") {
      actions.push({
        id: "check-with-model",
        label: "Check with model",
        path: "/validation/runs",
        body: { type: artifact.type, name: artifact.name },
      });
    }
  }

  const sections = [];
  let refresh_ms;

  if (run) {
    const status = run.status;
    if (status === "queued" || status === "running") refresh_ms = 2000;

    for (const f of loadFindings(ctx, run.id)) sections.push(findingSection(f, decide));
  }

  return {
    markdown: renderSummary(ctx, artifact, run),
    sections,
    actions,
    ...(refresh_ms ? { refresh_ms } : {}),
  };
}
