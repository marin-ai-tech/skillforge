import type { SecurityReport } from "../api/types.ts";
import { STR } from "../lib/strings.ts";

/** Built-in content scan of a version (content-security-scan): verdict and findings by file and line. */
export function SecurityScan({ report }: { report: SecurityReport | undefined }) {
  if (!report) return null;
  const tone =
    report.verdict === "fail"
      ? "text-danger"
      : report.verdict === "warn"
        ? "text-warning"
        : "text-ink-2";
  return (
    <section data-testid="quality-security" className="space-y-2">
      <h2 className="text-sm font-semibold text-ink">{STR.art.quality.securityTitle}</h2>
      <p data-testid="quality-security-verdict" className={`text-sm ${tone}`}>
        {STR.art.quality.securityVerdict[report.verdict]}
      </p>
      {report.findings.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {report.findings.map((f, i) => (
            <li key={`${f.file}:${f.line}:${f.rule}:${i}`} data-testid="quality-security-finding">
              <span translate="no" className="font-mono text-xs">
                {f.rule}
              </span>{" "}
              <span className="text-muted">
                {f.severity} · {f.file}:{f.line}
                {f.mention ? ` · ${STR.art.quality.securityMention}` : ""}
              </span>
              <div translate="no" className="font-mono text-xs text-ink-2">
                {f.excerpt}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-muted">{STR.art.quality.securityNote}</p>
    </section>
  );
}
