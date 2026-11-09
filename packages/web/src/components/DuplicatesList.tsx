import { Link } from "react-router";
import type { RegistryDuplicate } from "../api/types.ts";
import { STR } from "../lib/strings.ts";

type Props = {
  items: RegistryDuplicate[];
  testId?: string;
  emptyLabel?: string;
};

export function DuplicatesList({
  items,
  testId = "quality-duplicates",
  emptyLabel = STR.ui.duplicates.empty,
}: Props) {
  if (items.length === 0) {
    return (
      <div data-testid={testId}>
        <p data-testid="duplicates-empty" className="text-sm text-muted">
          {emptyLabel}
        </p>
      </div>
    );
  }
  return (
    <ul data-testid={testId} className="space-y-1">
      {items.map((d, i) => (
        <li
          key={`${d.kind}-${d.type}-${d.name}-${i}`}
          data-testid="duplicate-item"
          data-kind={d.kind}
          className="rounded-sf border border-line bg-surface px-2 py-1.5 text-sm"
        >
          <span className="font-mono text-[12px] font-semibold text-muted">{d.kind}</span>
          <Link
            translate="no"
            to={`/artifacts/${encodeURIComponent(d.type)}/${encodeURIComponent(d.name)}`}
            className="ml-2 font-medium text-ink no-underline hover:underline"
          >
            {d.type}/{d.name}
          </Link>
          {d.detail && typeof d.detail === "object" && "score" in d.detail ? (
            <span className="ml-2 text-xs text-muted">
              {STR.ui.duplicates.score(String(d.detail.score))}
            </span>
          ) : null}
          {d.detail &&
          typeof d.detail === "object" &&
          Array.isArray((d.detail as { paths?: unknown }).paths) ? (
            <span className="ml-2 font-mono text-[11px] text-muted">
              {(d.detail as { paths: string[] }).paths.slice(0, 5).join(", ")}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
