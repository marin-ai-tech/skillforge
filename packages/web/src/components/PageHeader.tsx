import type { ReactNode } from "react";
import { HelpButton } from "./HelpButton.tsx";

type Props = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  topic?: string;
  titleTestId?: string;
  titleClassName?: string;
};

export function PageHeader({
  title,
  description,
  actions,
  topic,
  titleTestId,
  titleClassName = "text-xl font-semibold",
}: Props) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 data-testid={titleTestId} className={titleClassName}>
            {title}
          </h1>
          <HelpButton topic={topic} />
        </div>
        {description ? <div className="mt-1 text-sm text-muted">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
