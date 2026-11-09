import { STR } from "../lib/strings.ts";

type Props = { type: string; className?: string };

const color: Record<string, string> = {
  skill: "text-type-skill border-type-skill/30 bg-accent-soft/40",
  command: "text-type-command border-type-command/30 bg-surface-2",
  agent: "text-type-agent border-type-agent/30 bg-surface-2",
  hook: "text-type-hook border-type-hook/30 bg-surface-2",
  plugin: "text-type-plugin border-type-plugin/30 bg-surface-2",
};

export function TypeChip({ type, className = "" }: Props) {
  return (
    <span
      className={`inline-flex items-center rounded-sf border px-1.5 py-0.5 text-xs font-medium ${color[type] ?? "border-line text-muted"} ${className}`}
    >
      {(STR.ui.typeOne as Record<string, string | undefined>)[type] ?? type}
    </span>
  );
}
