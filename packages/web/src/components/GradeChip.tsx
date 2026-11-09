import type { QualityGrade } from "../api/types.ts";

const GRADE_CLASS: Record<QualityGrade, string> = {
  A: "text-st-active bg-st-active-bg",
  B: "text-st-candidate bg-st-candidate-bg",
  C: "text-st-aging bg-st-aging-bg",
  D: "text-st-zombie bg-st-zombie-bg",
};

type Props = {
  grade: QualityGrade | string;
  testId: string;
  className?: string;
};

export function GradeChip({ grade, testId, className = "" }: Props) {
  const g = String(grade) as QualityGrade;
  const colors = GRADE_CLASS[g] ?? "bg-surface-2 text-muted";
  return (
    <span
      data-testid={testId}
      data-grade={grade}
      className={`inline-flex items-center rounded-sf px-1.5 py-0.5 text-xs font-semibold ${colors} ${className}`.trim()}
    >
      {grade}
    </span>
  );
}
