import { useEffect, useId, useRef } from "react";
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

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Tab and Shift+Tab cycle inside the open dialog (finding 1). */
function keepTabInside(e: KeyboardEvent, dialog: HTMLElement): void {
  const active = document.activeElement;
  const outside = !active || active === document.body || !dialog.contains(active);
  // Focus moved on purpose to another panel (for example the help opened by «Learn more»): leave it there.
  if (outside && active && active !== document.body) return;
  const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("disabled"),
  );
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  let target: HTMLElement | null = null;
  if (outside) target = e.shiftKey ? last : first;
  else if (e.shiftKey && active === first) target = last;
  else if (!e.shiftKey && active === last) target = first;
  if (!target) return;
  e.preventDefault();
  target.focus();
}

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
  const cancelRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const bodyId = useId();

  // Focus (UX audit, finding 1): on open the safe choice (Cancel) takes focus; on close focus goes back to the element
  // that had it before, unless the caller already moved it somewhere (for example to a button that replaces it).
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    // A second run of the effect (React strict mode) must not take the dialog's own button for the opener.
    if (active instanceof HTMLElement && !dialogRef.current?.contains(active))
      openerRef.current = active;
    cancelRef.current?.focus();
    return () => {
      window.setTimeout(() => {
        const now = document.activeElement;
        if (now && now !== document.body && now.isConnected) return;
        if (openerRef.current?.isConnected) openerRef.current.focus();
      }, 0);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) keepTabInside(e, dialogRef.current);
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
        aria-describedby={bodyId}
        className="w-full max-w-md rounded-sf border border-line bg-surface p-4 shadow-lg"
      >
        <h2 id="confirm-dialog-title" className="text-base font-semibold text-ink">
          {title}
        </h2>
        <p id={bodyId} className="mt-2 text-sm text-ink-2">
          {body}
        </p>
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
            ref={cancelRef}
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
