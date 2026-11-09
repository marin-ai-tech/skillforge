import type { ParsedArtifact } from "../artifact/types.ts";
import { contentToString } from "../artifact/frontmatter.ts";

/**
 * Built-in content scanner (content-security-scan): patterns that hurt the people who install an artifact, found by
 * line. A heuristic, not proof: a pass means none of these patterns, not a safe artifact. A line that only warns
 * about a pattern ("never pipe curl into sh") is reported as a mention and lowers the verdict to warn, never to
 * pass, so prefixing an attack with "never" cannot hide it.
 */
export type SecuritySeverity = "high" | "medium";
export type SecurityVerdict = "pass" | "warn" | "fail";

export type SecurityFinding = {
  rule: string;
  severity: SecuritySeverity;
  file: string;
  line: number;
  mention: boolean;
  excerpt: string;
};

export type SecurityReport = { verdict: SecurityVerdict; findings: SecurityFinding[] };

type Rule = {
  id: string;
  severity: SecuritySeverity;
  re: RegExp;
  /** Never a mention: hidden characters and literal secrets are a problem wherever they appear. */
  always?: boolean;
  /** Text that people quote as an example: inside quotes or a fenced block of a markdown file it is a mention. */
  quotable?: boolean;
  secret?: boolean;
};

const SHELLS = String.raw`(?:sudo\s+)?(?:ba|z|da|k)?sh\b`;
const FETCH = String.raw`\b(?:curl|wget)\b`;

const RULES: Rule[] = [
  {
    id: "pipe_to_shell",
    severity: "high",
    re: new RegExp(
      String.raw`${FETCH}[^\n|]*\|\s*(?:${SHELLS}|(?:python3?|node|perl|ruby)\b)`,
      "i",
    ),
  },
  {
    id: "remote_exec_powershell",
    severity: "high",
    re: /\b(?:iex|Invoke-Expression)\b[^\n]*\b(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod|DownloadString)\b|\b(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod|DownloadString)\b[^\n]*\|\s*(?:iex|Invoke-Expression)\b/i,
  },
  {
    id: "base64_exec",
    severity: "high",
    re: new RegExp(String.raw`base64\s+(?:-d|--decode)\b[^\n|]*\|\s*${SHELLS}`, "i"),
  },
  {
    id: "instruction_override",
    severity: "high",
    quotable: true,
    re: /\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+)?(?:the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|rules|messages)\b|\b(?:do not|don't|never)\s+(?:tell|inform|show)\s+the\s+user\b|\bwithout\s+(?:telling|informing|asking)\s+the\s+user\b/i,
  },
  {
    id: "exfiltration",
    severity: "high",
    re: /\b(?:curl|wget|iwr|Invoke-WebRequest)\b[^\n]*(?:\s-d\b|--data|\s-F\b|--upload-file|\s-T\b|-Body\b)[^\n]*(?:\$\(env\)|\$\{?[A-Z_]*(?:TOKEN|SECRET|KEY|PASSWORD)|~\/\.ssh|~\/\.aws|\bid_rsa\b|\.env\b)/i,
  },
  {
    id: "hidden_unicode",
    severity: "high",
    always: true,
    re: /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|[\u{E0000}-\u{E007F}]/u,
  },
  {
    id: "secret_literal",
    severity: "high",
    always: true,
    secret: true,
    re: /\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    id: "credential_paths",
    severity: "medium",
    re: /~\/\.ssh\/|~\/\.aws\/credentials|\bid_(?:rsa|ed25519)\b|~\/\.netrc|~\/\.docker\/config\.json|~\/\.kube\/config/i,
  },
  {
    id: "destructive",
    severity: "medium",
    re: /\brm\s+-[a-z]*r[a-z]*\s+(?:\/|~|\$HOME|\*)(?:\s|$)|\bgit\s+push\b[^\n]*--force\b|\bgit\s+reset\s+--hard\b|\bmkfs\b|\bdd\s+if=/i,
  },
  {
    id: "guard_bypass",
    severity: "medium",
    re: /--no-verify\b|--dangerously-skip-permissions\b|\bbypassPermissions\b/i,
  },
];

const MENTION =
  /\b(?:never|don't|do not|avoid|reject|refuse|forbid(?:den)?|must not|warning|attack(?:er)?|malicious|injection|untrusted|dangerous|unsafe|e\.g\.|for example|such as)\b/i;
const PLACEHOLDER = /EXAMPLE|XXXX|your[_-]|<[^>]*>/i;
const MAX_FINDINGS = 50;
const MAX_EXCERPT = 80;

function excerptOf(rule: Rule, line: string, match: string): string {
  if (rule.id === "hidden_unicode") {
    const cp = match.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
    return `U+${cp}`;
  }
  const shown = rule.secret ? line.replace(match, `${match.slice(0, 4)}…`) : line;
  return shown.trim().slice(0, MAX_EXCERPT);
}

/** An odd number of quote marks before the match means it sits inside a quotation. */
function insideQuotes(line: string, index: number): boolean {
  return ((line.slice(0, index).match(/["`“”«»]/g) ?? []).length & 1) === 1;
}

type LineCtx = { file: string; n: number; line: string; fenced: boolean };

function isMention(rule: Rule, ctx: LineCtx, m: RegExpExecArray): boolean {
  if (rule.secret) return PLACEHOLDER.test(m[0]);
  if (rule.always) return false;
  if (rule.quotable && (ctx.fenced || insideQuotes(ctx.line, m.index))) return true;
  return MENTION.test(ctx.line.replace(m[0], " "));
}

function scanLine(ctx: LineCtx, out: SecurityFinding[]): void {
  for (const rule of RULES) {
    const m = rule.re.exec(ctx.line);
    if (!m) continue;
    out.push({
      rule: rule.id,
      severity: rule.severity,
      file: ctx.file,
      line: ctx.n,
      mention: isMention(rule, ctx, m),
      excerpt: excerptOf(rule, ctx.line, m[0]),
    });
  }
}

function scanFile(file: string, text: string, out: SecurityFinding[]): void {
  const markdown = file.toLowerCase().endsWith(".md");
  let fenced = false;
  text.split(/\r?\n/).forEach((line, i) => {
    if (markdown && /^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    scanLine({ file, n: i + 1, line, fenced: markdown && fenced }, out);
  });
}

function verdictOf(findings: SecurityFinding[]): SecurityVerdict {
  if (findings.some((f) => f.severity === "high" && !f.mention)) return "fail";
  return findings.length > 0 ? "warn" : "pass";
}

export function scanSecurity(artifact: ParsedArtifact): SecurityReport {
  const findings: SecurityFinding[] = [];
  for (const f of artifact.canonical) {
    const text = contentToString(f.content);
    if (text.includes("\u0000")) continue;
    scanFile(f.path, text, findings);
  }
  // The verdict counts every finding; the list is capped to keep the stored report small.
  return { verdict: verdictOf(findings), findings: findings.slice(0, MAX_FINDINGS) };
}
