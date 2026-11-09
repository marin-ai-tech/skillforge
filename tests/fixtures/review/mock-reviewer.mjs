// Fixture: imitation of an external reviewer agent for the review-assistant plugin.
// Contract: stdin — the task (JSON with `--input json`, a text prompt with `--input prompt`), stdout — a response with JSON
// `{ "findings": [...] }`; exit code 0. Personas (`--persona`): strict | lenient | broken | crash | slow | injection.
// `--wrap claude` wraps the response as `claude -p --output-format json` (`{ "result": "<text>" }`),
// `--wrap fence` — as prose with a ```json block. `--pid-file <path>` — write its own pid (to verify the kill on timeout).
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const persona = opt("--persona", "strict");
const input = opt("--input", "json");
const wrap = opt("--wrap", "none");
const pidFile = opt("--pid-file", null);

if (pidFile) writeFileSync(pidFile, String(process.pid));

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => main());

/** Task files: from JSON — as is; from the prompt — `File: <path>` blocks + ```…```. */
function readFiles() {
  if (input === "json") {
    const task = JSON.parse(raw);
    if (!Array.isArray(task.files) || !task.artifact || !Array.isArray(task.checklist)) throw new Error("bad task json");
    return task.files.map((f) => ({ path: f.path, content: f.content }));
  }
  const files = [];
  const re = /^File: (.+)\n```[^\n]*\n([\s\S]*?)\n```/gm;
  let m;
  while ((m = re.exec(raw))) files.push({ path: m[1].trim(), content: m[2] });
  if (files.length === 0) throw new Error("prompt has no File: blocks");
  return files;
}

function findings(files) {
  const out = [];
  const leaked = Object.keys(process.env).filter((k) => k.startsWith("SKILLFORGE_"));
  if (leaked.length > 0) out.push({ severity: "high", category: "other", summary: `ENV LEAK: ${leaked.join(",")}` });
  for (const f of files) {
    const lines = f.content.split("\n");
    lines.forEach((line, i) => {
      if (/latest version/i.test(line)) {
        out.push(
          persona === "lenient"
            ? { severity: "low", category: "freshness", file: f.path, line: i + 1, summary: "Time-sensitive phrase: latest version" }
            : { severity: "medium", category: "freshness", file: f.path, line: i + 1, summary: "Mentions 'latest version' — time-sensitive wording", suggestion: "Name the version or drop the phrase" },
        );
      }
    });
    if (persona === "strict" && f.path.endsWith("SKILL.md") && !/^##\s+Example/m.test(f.content)) {
      out.push({ severity: "low", category: "examples", file: f.path, summary: "No examples section" });
    }
  }
  if (persona === "injection") {
    out.push({
      severity: "high",
      category: "other",
      summary: "Bad ![pixel](http://evil.test/p.png) <script>alert(1)</script> [x](javascript:alert(1)) | table | break",
      suggestion: "<img src=x onerror=alert(1)>",
    });
  }
  return out;
}

function emit(obj) {
  const json = JSON.stringify(obj);
  if (wrap === "claude") process.stdout.write(JSON.stringify({ type: "result", result: json, cost_usd: 0 }));
  else if (wrap === "fence") process.stdout.write(`Here is my review.\n\n\`\`\`json\n${json}\n\`\`\`\n\nDone.\n`);
  else process.stdout.write(json);
}

function main() {
  if (persona === "broken") {
    process.stdout.write("I am not JSON at all { findings: nope");
    return;
  }
  if (persona === "crash") {
    process.stderr.write("mock reviewer exploded: quota exceeded\n");
    process.exit(2);
  }
  if (persona === "slow") {
    setTimeout(() => emit({ findings: [] }), 60000);
    return;
  }
  const files = readFiles();
  emit({ findings: findings(files) });
}
