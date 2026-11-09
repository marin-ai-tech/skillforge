import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getVersionDiff } from "../api/client.ts";
import type { VersionDetail } from "../api/types.ts";
import { STR } from "../lib/strings.ts";
import { errorText } from "../i18n/index.ts";
import { HelpTip } from "./HelpTip.tsx";

/** What changed between two versions (version-diff): file statuses and a line diff of each changed file. */
export function VersionCompare({
  type,
  name,
  versions,
}: {
  type: string;
  name: string;
  versions: VersionDetail[];
}) {
  const live = versions.filter((v) => !v.purged).map((v) => v.version);
  const [from, setFrom] = useState(live[1] ?? "");
  const [to, setTo] = useState(live[0] ?? "");
  const q = useQuery({
    queryKey: ["version-diff", type, name, from, to],
    queryFn: () => getVersionDiff(type, name, from, to),
    enabled: from !== "" && to !== "" && from !== to,
  });
  if (live.length < 2) return null;
  const pick = (value: string, set: (v: string) => void, testId: string) => (
    <select
      data-testid={testId}
      className="rounded-sf border border-line bg-bg px-2 py-1 font-mono text-xs"
      value={value}
      onChange={(e) => set(e.target.value)}
    >
      {live.map((v) => (
        <option key={v} value={v}>
          {v}
        </option>
      ))}
    </select>
  );
  return (
    <details data-testid="version-compare" className="rounded-sf border border-line bg-surface p-3">
      <summary className="cursor-pointer text-sm font-semibold text-ink">
        {STR.art.versions.compareTitle}
      </summary>
      <div className="mt-3 space-y-3 text-sm">
        <HelpTip action="version-compare">
          <div className="flex flex-wrap items-center gap-2">
            {pick(from, setFrom, "compare-from")}
            <span className="text-muted">→</span>
            {pick(to, setTo, "compare-to")}
          </div>
        </HelpTip>
        {q.isError ? <p className="text-danger">{errorText(q.error)}</p> : null}
        {q.data ? (
          <>
            <p data-testid="compare-summary" className="text-ink-2">
              {STR.art.versions.compareSummary(
                q.data.summary.added,
                q.data.summary.removed,
                q.data.summary.modified,
                q.data.summary.unchanged,
              )}
            </p>
            <ul className="space-y-2">
              {q.data.files
                .filter((f) => f.status !== "unchanged")
                .map((f) => (
                  <li key={f.path} data-testid="diff-file" data-status={f.status}>
                    <div translate="no" className="font-mono text-xs text-ink">
                      {STR.art.versions.fileStatus[f.status]} · {f.path}
                    </div>
                    {f.diff ? (
                      <pre className="mt-1 overflow-x-auto rounded-sf bg-surface-2 p-2 font-mono text-xs">
                        {f.diff.split("\n").map((line, i) => (
                          <div
                            key={i}
                            className={
                              line.startsWith("+")
                                ? "text-st-active"
                                : line.startsWith("-")
                                  ? "text-danger"
                                  : "text-ink-2"
                            }
                          >
                            {line}
                          </div>
                        ))}
                      </pre>
                    ) : f.binary || f.too_large ? (
                      <div className="text-xs text-muted">{STR.art.versions.noDiff}</div>
                    ) : null}
                  </li>
                ))}
            </ul>
          </>
        ) : null}
      </div>
    </details>
  );
}
