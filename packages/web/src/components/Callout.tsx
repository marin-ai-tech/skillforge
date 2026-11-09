import type { ReactNode } from "react";
import {
  CircleAlert,
  Info,
  Lightbulb,
  OctagonAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { STR } from "../lib/strings.ts";

export type CalloutKind = "note" | "tip" | "important" | "warning" | "caution";

export const CALLOUT_KINDS: readonly CalloutKind[] = [
  "note",
  "tip",
  "important",
  "warning",
  "caution",
];

const LOOK: Record<CalloutKind, { icon: LucideIcon; box: string; label: string }> = {
  note: { icon: Info, box: "border-note bg-note-bg", label: "text-note" },
  tip: { icon: Lightbulb, box: "border-st-active bg-st-active-bg", label: "text-st-active" },
  important: {
    icon: CircleAlert,
    box: "border-important bg-important-bg",
    label: "text-important",
  },
  warning: { icon: TriangleAlert, box: "border-warning bg-warning-bg", label: "text-warning" },
  caution: { icon: OctagonAlert, box: "border-danger bg-danger-bg", label: "text-danger" },
};

/** A GitHub-alert style callout: kind icon and label from the dictionary, colours from theme tokens. */
export function Callout({ kind, children }: { kind: CalloutKind; children: ReactNode }) {
  const look = LOOK[kind];
  const Icon = look.icon;
  return (
    <div
      data-testid="help-callout"
      data-kind={kind}
      role="note"
      className={`rounded-sf border-l-4 px-3 py-2 ${look.box}`}
    >
      <div className={`mb-1 flex items-center gap-1.5 text-sm font-semibold ${look.label}`}>
        <Icon size={16} aria-hidden="true" />
        <span>{STR.tips.help.callouts[kind]}</span>
      </div>
      <div className="space-y-2 text-ink-2 [&_p]:text-ink-2">{children}</div>
    </div>
  );
}
