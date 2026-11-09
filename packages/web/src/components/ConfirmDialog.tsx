import { useEffect, useRef } from "react";
import { useHelp } from "../help/HelpProvider.tsx";
import { STR } from "../lib/strings.ts";

type Props = {
  open: boolean;
  title: string;
  body: string;
  helpText: string;
  helpTopic?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  body,
  helpText,
  helpTopic,
  confirmLabel = STR.ui.confirm.confirm,
  cancelLabel = STR.ui.confirm.cancel,
  onConfirm,
  onCancel,
}: Props) {
  const { openTopic } = useHelp();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
      <div
        ref={dialogRef}
        data-testid="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-md rounded-sf border border-line bg-surface p-4 shadow-lg"
      >
        <h2 id="confirm-dialog-title" className="text-base font-semibold text-ink">
          {title}
        </h2>
        <p className="mt-2 text-sm text-ink-2">{body}</p>
        <p data-testid="dialog-help" className="mt-3 text-sm text-muted">
          {helpText}
          {helpTopic ? (
            <>
              {" "}
              <button
                type="button"
                className="text-accent underline"
                onClick={() => openTopic(helpTopic)}
              >
                {STR.ui.confirm.learnMore}
              </button>
            </>
          ) : null}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            data-testid="dialog-cancel"
            className="rounded-sf border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            data-testid="dialog-confirm"
            className="rounded-sf bg-accent px-3 py-1.5 text-sm font-medium text-white"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
