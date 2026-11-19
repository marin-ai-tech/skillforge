import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { STR } from "../lib/strings.ts";

type Props = {
  value: string;
  label?: string;
  testId?: string;
  /** Said by a visually hidden status after a successful copy (screen readers miss the label change). */
  copiedText?: string;
  /** Shown when the copy fails; the field with `fieldId` is selected so the reader can copy by hand. */
  failedText?: string;
  fieldId?: string;
};

/**
 * Copies `value` to the clipboard. Without `copiedText` / `failedText` it behaves as before: only the label changes
 * to «Copied» for a moment. With them, success and failure are also said in a `role="status"` region (UX audit,
 * findings 5 and 10): a failed copy is never silent.
 */
export function CopyButton({ value, label, testId, copiedText, failedText, fieldId }: Props) {
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const announces = copiedText !== undefined || failedText !== undefined;
  const button = (
    <button
      type="button"
      data-testid={testId}
      className="inline-flex items-center gap-1 rounded-sf border border-line px-1.5 py-0.5 text-xs text-muted hover:text-ink"
      title={label ?? STR.detail.copy}
      onClick={async () => {
        setMessage(null);
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          if (copiedText) setMessage({ text: copiedText, failed: false });
          setTimeout(() => setCopied(false), 1500);
        } catch {
          if (fieldId) {
            const field = document.getElementById(fieldId);
            if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
              field.focus();
              field.select();
            }
          }
          if (failedText) setMessage({ text: failedText, failed: true });
        }
      }}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? STR.detail.copied : (label ?? STR.detail.copy)}
    </button>
  );
  if (!announces) return button;
  return (
    <>
      {button}
      <span
        role="status"
        data-testid={testId ? `${testId}-status` : undefined}
        className={message?.failed ? "text-xs text-danger" : "sr-only"}
      >
        {message?.text ?? ""}
      </span>
    </>
  );
}
