import { Inbox } from "lucide-react";
import { Link } from "react-router";
import { STR } from "../lib/strings.ts";

type Props = {
  title?: string;
  hint?: string;
  linkHref?: string;
  linkLabel?: string;
};

export function EmptyState({ title = STR.ui.empty.title, hint, linkHref, linkLabel }: Props) {
  return (
    <div
      data-testid="empty-state"
      className="flex flex-col items-center gap-2 rounded-sf border border-dashed border-line bg-surface px-6 py-10 text-center"
    >
      <Inbox className="h-8 w-8 text-muted" aria-hidden />
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint ? <p className="max-w-md text-sm text-muted">{hint}</p> : null}
      {linkHref && linkLabel ? (
        <Link to={linkHref} className="text-sm text-accent underline">
          {linkLabel}
        </Link>
      ) : null}
    </div>
  );
}
