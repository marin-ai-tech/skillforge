import { useEffect, useState } from "react";
import type { QualityRubric, RubricCriterion, RubricResult } from "../api/types.ts";
import { STR } from "../lib/strings.ts";
import { HelpTip } from "./HelpTip.tsx";

const QUALITY_CODES = Object.keys(STR.codes).filter((c) => c.startsWith("Q_"));
const TYPES: RubricCriterion["type"][] = ["require_heading", "require_file", "forbid_phrase"];
const input = "rounded-sf border border-line bg-bg px-2 py-1 text-sm";

type Props = {
  testId: string;
  title: string;
  value: QualityRubric;
  onSave: (next: QualityRubric) => void;
  saving: boolean;
  message: string | null;
};

function CriterionRow({
  c,
  onChange,
  onRemove,
}: {
  c: RubricCriterion;
  onChange: (c: RubricCriterion) => void;
  onRemove: () => void;
}) {
  const S = STR.art.rubric;
  return (
    <li data-testid="rubric-criterion" className="flex flex-wrap items-center gap-2">
      <input
        className={`${input} w-32 font-mono`}
        placeholder={S.criterionId}
        value={c.id}
        onChange={(e) => onChange({ ...c, id: e.target.value })}
      />
      <select
        className={input}
        value={c.type}
        onChange={(e) => onChange({ ...c, type: e.target.value as RubricCriterion["type"] })}
      >
        {TYPES.map((t) => (
          <option key={t} value={t}>
            {S.types[t]}
          </option>
        ))}
      </select>
      <input
        className={`${input} w-48`}
        placeholder={S.criterionValue}
        value={c.value}
        onChange={(e) => onChange({ ...c, value: e.target.value })}
      />
      <input
        type="number"
        min={0}
        max={100}
        className={`${input} w-20`}
        value={c.weight}
        onChange={(e) => onChange({ ...c, weight: Number(e.target.value) })}
      />
      <button type="button" className="text-xs text-danger" onClick={onRemove}>
        {S.remove}
      </button>
    </li>
  );
}

function WeightRows({
  weights,
  onChange,
}: {
  weights: Record<string, number>;
  onChange: (w: Record<string, number>) => void;
}) {
  const S = STR.art.rubric;
  const [code, setCode] = useState(QUALITY_CODES[0] ?? "");
  return (
    <div className="space-y-1">
      <ul className="space-y-1">
        {Object.entries(weights).map(([k, w]) => (
          <li key={k} className="flex items-center gap-2">
            <span translate="no" className="w-48 font-mono text-xs">
              {k}
            </span>
            <input
              type="number"
              min={0}
              max={100}
              className={`${input} w-20`}
              value={w}
              onChange={(e) => onChange({ ...weights, [k]: Number(e.target.value) })}
            />
            <button
              type="button"
              className="text-xs text-danger"
              onClick={() =>
                onChange(Object.fromEntries(Object.entries(weights).filter(([x]) => x !== k)))
              }
            >
              {S.remove}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <select
          className={`${input} font-mono`}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        >
          {QUALITY_CODES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="text-xs text-accent"
          onClick={() => onChange({ ...weights, [code]: weights[code] ?? 15 })}
        >
          {S.addWeight}
        </button>
      </div>
    </div>
  );
}

/** Editor of company or team quality rules (quality-rubric): threshold, mode, code weights, own criteria. */
export function RubricEditor({ testId, title, value, onSave, saving, message }: Props) {
  const S = STR.art.rubric;
  const [draft, setDraft] = useState<QualityRubric>(value);
  useEffect(() => setDraft(value), [value]);
  const setCriterion = (i: number, c: RubricCriterion) =>
    setDraft({ ...draft, criteria: draft.criteria.map((x, j) => (j === i ? c : x)) });
  return (
    <section
      data-testid={testId}
      className="space-y-3 rounded-sf border border-line bg-surface p-4 text-sm"
    >
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted">{title}</h2>
      <p className="text-xs text-ink-2">{S.description}</p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-ink-2">
          {S.threshold}
          <input
            type="number"
            min={0}
            max={100}
            data-testid="rubric-threshold"
            className={`${input} w-20`}
            value={draft.threshold}
            onChange={(e) => setDraft({ ...draft, threshold: Number(e.target.value) })}
          />
        </label>
        <label className="flex items-center gap-2 text-ink-2">
          {S.enforce}
          <select
            data-testid="rubric-enforce"
            className={input}
            value={draft.enforce}
            onChange={(e) =>
              setDraft({ ...draft, enforce: e.target.value as QualityRubric["enforce"] })
            }
          >
            {(["off", "warn", "block"] as const).map((m) => (
              <option key={m} value={m}>
                {S.modes[m]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <h3 className="text-xs uppercase tracking-wide text-muted">{S.weights}</h3>
      <WeightRows weights={draft.weights} onChange={(weights) => setDraft({ ...draft, weights })} />
      <h3 className="text-xs uppercase tracking-wide text-muted">{S.criteria}</h3>
      <ul className="space-y-1">
        {draft.criteria.map((c, i) => (
          <CriterionRow
            key={i}
            c={c}
            onChange={(next) => setCriterion(i, next)}
            onRemove={() =>
              setDraft({ ...draft, criteria: draft.criteria.filter((_, j) => j !== i) })
            }
          />
        ))}
      </ul>
      <button
        type="button"
        className="text-xs text-accent"
        onClick={() =>
          setDraft({
            ...draft,
            criteria: [
              ...draft.criteria,
              { id: "", type: "require_heading", value: "", weight: 10 },
            ],
          })
        }
      >
        {S.addCriterion}
      </button>
      <div className="flex flex-wrap items-center gap-2">
        <HelpTip action="rubric-save">
          <button
            type="button"
            data-testid="rubric-save"
            disabled={saving}
            onClick={() => onSave(draft)}
            className="rounded-sf bg-accent px-3 py-1.5 text-accent-fg disabled:opacity-50"
          >
            {S.save}
          </button>
        </HelpTip>
        {message ? (
          <span data-testid="rubric-message" role="status" className="text-ink-2">
            {message}
          </span>
        ) : null}
      </div>
    </section>
  );
}

/** The version's score by company and team rules, on the Quality tab. */
export function RubricResultView({ result }: { result: RubricResult | null | undefined }) {
  if (!result) return null;
  const S = STR.art.rubric;
  return (
    <section data-testid="quality-rubric" data-passed={String(result.passed)} className="space-y-2">
      <h2 className="text-sm font-semibold text-ink">{S.resultTitle}</h2>
      <p className={`text-sm ${result.passed ? "text-st-active" : "text-warning"}`}>
        {S.score(result.score, result.threshold, result.passed)}
      </p>
      {result.failed.length > 0 ? (
        <ul className="space-y-1 text-xs">
          {result.failed.map((f) => (
            <li key={f.id}>
              <span translate="no" className="font-mono">
                {f.id}
              </span>{" "}
              <span className="text-muted">{S.minus(f.weight)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
