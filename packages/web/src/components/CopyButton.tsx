import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { STR } from "../lib/strings.ts";

type Props = { value: string; label?: string };

export function CopyButton({ value, label }: Props) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-sf border border-line px-1.5 py-0.5 text-xs text-muted hover:text-ink"
      title={label ?? STR.detail.copy}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* ignore */
        }
      }}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? STR.detail.copied : (label ?? STR.detail.copy)}
    </button>
  );
}
