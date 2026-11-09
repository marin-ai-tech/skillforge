// Fixture: a mock "judge" for the review-assistant plugin. stdin — JSON `{ artifact, reviewers: [{ id, status,
// findings }] }`, stdout — JSON `{ findings: [{ severity, category, file, line, summary, suggestion, reviewers }] }`.
// Groups findings by category (coarser than the built-in judge) and marks summaries with the `JUDGE:` prefix. `--fail` — exit code 1.
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  if (process.argv.includes("--fail")) {
    process.stderr.write("judge unavailable\n");
    process.exit(1);
  }
  const task = JSON.parse(raw);
  const groups = new Map();
  for (const r of task.reviewers) {
    if (r.status !== "ok") continue;
    for (const f of r.findings) {
      const g = groups.get(f.category) ?? { ...f, summary: `JUDGE: ${f.summary}`, reviewers: [] };
      if (!g.reviewers.includes(r.id)) g.reviewers.push(r.id);
      groups.set(f.category, g);
    }
  }
  process.stdout.write(JSON.stringify({ findings: [...groups.values()] }));
});
