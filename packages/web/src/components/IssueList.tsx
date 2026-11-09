import { useHelp } from "../help/HelpProvider.tsx";
import { HelpTip } from "./HelpTip.tsx";
import { codeMessage } from "../i18n/index.ts";
import { STR } from "../lib/strings.ts";

export type IssueItem = {
  code: string;
  message: string;
  path?: string;
  level?: "error" | "warning";
};

type Props = {
  issues: IssueItem[];
  level: "error" | "warning";
  testId: string;
};

export function IssueList({ issues, level, testId }: Props) {
  const { openTopic } = useHelp();
  const bg = level === "error" ? "bg-danger-bg text-danger" : "bg-warning-bg text-warning";
  return (
    <ul data-testid={testId} className="space-y-1">
      {issues.map((issue, i) => (
        <li
          key={`${issue.code}-${issue.path ?? ""}-${i}`}
          data-testid="publish-issue"
          data-code={issue.code}
          data-level={level}
          className={`rounded-sf px-2 py-1.5 text-sm ${bg}`}
        >
          <span className="font-mono text-[12px] font-semibold" translate="no">
            {issue.code}
          </span>
          <span className="ml-2">{codeMessage(issue.code, issue.message)}</span>
          {issue.path ? (
            <span className="ml-2 font-mono text-[11px] opacity-80" translate="no">
              {issue.path}
            </span>
          ) : null}
          <HelpTip action="issue-help">
            <button
              type="button"
              data-testid="issue-help"
              className="ml-2 text-xs underline opacity-90"
              onClick={() => openTopic(`codes/${issue.code}`)}
            >
              {STR.adm.issueList.help}
            </button>
          </HelpTip>
        </li>
      ))}
    </ul>
  );
}
