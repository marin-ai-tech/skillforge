import { useEffect, useState } from "react";
import { useHelp } from "../help/HelpProvider.tsx";
import { HelpTip } from "./HelpTip.tsx";
import { STR } from "../lib/strings.ts";
import { Button } from "./Button.tsx";

const NEEDS_REASON = new Set(["retired", "zombie"]);

type Props = {
  open: boolean;
  to: string;
  from?: string;
  title?: string;
  confirmLabel?: string;
  error?: string | null;
  initialReason?: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  busy?: boolean;
  /** Reason required beyond retired/zombie (self-promotion by an admin, self-promotion-guard). */
  reasonRequired?: boolean;
  /** Extra sentence after the reason hint. */
  note?: string;
};

export function TransitionDialog({
  open,
  to,
  from,
  title,
  confirmLabel = STR.art.common.confirm,
  error,
  initialReason = "",
  onConfirm,
  onCancel,
  busy = false,
  reasonRequired = false,
  note,
}: Props) {
  const { openTopic } = useHelp();
  const [reason, setReason] = useState("");
  const needsReason = NEEDS_REASON.has(to) || reasonRequired;
  const canConfirm = !needsReason || reason.trim().length > 0;

  useEffect(() => {
    if (open) setReason(initialReason);
  }, [open, to, initialReason]);

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

  const heading = title ?? STR.art.transition.title(to);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
      <div
        data-testid="transition-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transition-dialog-title"
        className="w-full max-w-md rounded-sf border border-line bg-surface p-4 shadow-lg"
      >
        <h2 id="transition-dialog-title" className="text-base font-semibold text-ink">
          {heading}
        </h2>
        <p className="mt-2 text-sm text-ink-2">
          {from ? (
            <>
              {STR.art.transition.changeFrom} <span className="font-mono">{from}</span>{" "}
              {STR.art.transition.to} <span className="font-mono">{to}</span>.
            </>
          ) : (
            <>
              {STR.art.transition.changeTo} <span className="font-mono">{to}</span>.
            </>
          )}
          {needsReason ? STR.art.transition.reasonRequired : STR.art.transition.reasonOptional}
          {note ? <span data-testid="transition-note">{note}</span> : null}
        </p>
        <label className="mt-3 block text-sm text-muted">
          {STR.art.common.reason}
          <HelpTip action="transition-reason">
            <textarea
              data-testid="transition-reason"
              className="mt-1 w-full rounded-sf border border-line bg-bg px-2 py-1.5 text-sm text-ink"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </HelpTip>
        </label>
        <p data-testid="dialog-help" className="mt-3 text-sm text-muted">
          {STR.art.transition.help}{" "}
          <button
            type="button"
            className="text-accent underline"
            onClick={() => openTopic("getting-started/lifecycle")}
          >
            {STR.art.common.learnMore}
          </button>
        </p>
        {error ? (
          <p data-testid="transition-error" className="mt-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <HelpTip action="transition-cancel">
            <Button
              type="button"
              data-testid="transition-cancel"
              className="rounded-sf border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2"
              onClick={onCancel}
              pending={busy}
            >
              {STR.art.common.cancel}
            </Button>
          </HelpTip>
          <HelpTip action="transition-confirm">
            <Button
              type="button"
              data-testid="transition-confirm"
              className="rounded-sf bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              pending={busy}
              disabled={!canConfirm}
              onClick={() => onConfirm(reason.trim())}
            >
              {confirmLabel}
            </Button>
          </HelpTip>
        </div>
      </div>
    </div>
  );
}
