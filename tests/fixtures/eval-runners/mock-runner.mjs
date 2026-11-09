// Runtime mock for the skill-evals acceptance test.
// stdin: { protocol: 1, mode: "trigger" | "task", prompt, skill: { name, description, files: [{ path, content }] } | null }
// stdout: trigger — { triggered }, task — { output }.
// Behavior is determined by the skill content and the request, not by the version (the runtime does not receive the version):
//  - trigger: fires only if there is a skill and "pdf" appears in both its description and the request;
//  - task: the answer is the value of the `ANSWER: <text>` line from the skill files; without a skill (or without the line) — "baseline answer";
//  - markers in the request: __crash__ (exit code 2, stderr "quota exceeded"), __garbage__ (not JSON), __slow__ (hang),
//    __env__ (output: names of SKILLFORGE_* variables), __secret__ (the answer contains the secret marker SECRET-EVAL-XYZ-1234).
// Each task is appended as a JSON line to the `EVAL_LOG` file together with the names of the process environment variables.
import { appendFileSync, writeFileSync } from "node:fs";

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  const job = JSON.parse(raw);
  if (process.env.EVAL_LOG) {
    appendFileSync(process.env.EVAL_LOG, JSON.stringify({ job, env_keys: Object.keys(process.env), cwd: process.cwd() }) + "\n");
  }
  const prompt = String(job.prompt ?? "");
  if (prompt.includes("__crash__")) {
    process.stderr.write("quota exceeded\n");
    process.exit(2);
  }
  if (prompt.includes("__garbage__")) {
    process.stdout.write("this is not json\n");
    return;
  }
  if (prompt.includes("__slow__")) {
    if (process.env.EVAL_PID_FILE) writeFileSync(process.env.EVAL_PID_FILE, String(process.pid));
    setTimeout(() => {}, 60000);
    return;
  }
  if (job.mode === "trigger") {
    const triggered = !!job.skill && /pdf/i.test(job.skill.description ?? "") && /pdf/i.test(prompt);
    process.stdout.write(JSON.stringify({ triggered }));
    return;
  }
  if (prompt.includes("__env__")) {
    const keys = Object.keys(process.env).filter((k) => k.startsWith("SKILLFORGE_"));
    process.stdout.write(JSON.stringify({ output: `ENV:${keys.join(",")}` }));
    return;
  }
  if (prompt.includes("__secret__")) {
    process.stdout.write(JSON.stringify({ output: "token=SECRET-EVAL-XYZ-1234" }));
    return;
  }
  let answer = "baseline answer";
  for (const f of job.skill?.files ?? []) {
    const m = /^ANSWER: (.*)$/m.exec(f.content);
    if (m) answer = m[1].trim();
  }
  process.stdout.write(JSON.stringify({ output: answer }));
});
