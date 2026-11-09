type Props = { status: string };

const map: Record<string, string> = {
  candidate: "text-st-candidate bg-st-candidate-bg",
  active: "text-st-active bg-st-active-bg",
  aging: "text-st-aging bg-st-aging-bg",
  zombie: "text-st-zombie bg-st-zombie-bg",
  retired: "text-st-retired bg-st-retired-bg",
};

export function StatusChip({ status }: Props) {
  return (
    <span
      className={`inline-flex items-center rounded-sf px-1.5 py-0.5 text-xs font-medium ${map[status] ?? "bg-surface-2 text-muted"}`}
    >
      {status}
    </span>
  );
}
