import { AlertTriangle } from "lucide-react";
import { STR } from "../lib/strings.ts";

type Props = { message?: string; onRetry?: () => void };

export function ErrorState({ message, onRetry }: Props) {
  return (
    <div
      data-testid="error-state"
      className="flex flex-col items-center gap-3 rounded-sf border border-line bg-surface px-6 py-10 text-center"
    >
      <AlertTriangle className="h-8 w-8 text-accent" aria-hidden />
      <p className="text-sm text-ink">{message ?? STR.browse.error}</p>
      {onRetry ? (
        <button
          type="button"
          className="rounded-sf bg-accent px-3 py-1.5 text-sm font-medium text-bg"
          onClick={onRetry}
        >
          {STR.common.retry}
        </button>
      ) : null}
    </div>
  );
}
