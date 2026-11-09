// Runtime stub for the `cost-per-solve` tests: answers like a model with a known token usage.
// The argument is a profile: small | large | silent.
//  - small: solves a task only if there is a skill and the request contains "easy"; usage is 1000 input and 200 output tokens;
//  - large: solves any task when a skill is present; usage is 1500 and 300 tokens;
//  - silent: solves like large, but reports neither usage nor model.
// A solving answer is the `ANSWER: <text>` line from the skill files, otherwise "baseline answer".
const profile = process.argv[2] ?? "large";
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  const job = JSON.parse(raw);
  const prompt = String(job.prompt ?? "");
  let answer = "baseline answer";
  const solves = job.skill && (profile !== "small" || prompt.includes("easy"));
  if (solves) {
    for (const f of job.skill.files ?? []) {
      const m = /^ANSWER: (.*)$/m.exec(f.content);
      if (m) answer = m[1].trim();
    }
  }
  const out = { output: answer };
  if (profile === "small") Object.assign(out, { model: "small-1", usage: { input_tokens: 1000, output_tokens: 200 } });
  if (profile === "large") Object.assign(out, { model: "large-1", usage: { input_tokens: 1500, output_tokens: 300 } });
  process.stdout.write(JSON.stringify(out));
});
