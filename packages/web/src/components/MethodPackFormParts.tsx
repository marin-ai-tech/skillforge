import type { ReactNode } from "react";
import type { MethodPackProblem } from "../api/types.ts";
import { STR } from "../lib/strings.ts";
import { Button } from "./Button.tsx";

export const fieldClass = "w-full rounded-sf border border-field-line bg-surface px-2 py-1 text-sm";
export const labelClass = "block text-xs font-medium text-ink-2";

export function Field({ id, text, children }: { id: string; text: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className={labelClass}>
        {text}
      </label>
      {children}
    </div>
  );
}

export type PackHead = { name: string; version: string; title: string; description: string };

/** Name (a new pack only), version, title and description of a method pack draft. */
export function HeadFields({
  idBase,
  isNew,
  value,
  onChange,
}: {
  idBase: string;
  isNew: boolean;
  value: PackHead;
  onChange: (h: PackHead) => void;
}) {
  const S = STR.ws.packs;
  const set = (k: keyof PackHead) => (e: { target: { value: string } }) =>
    onChange({ ...value, [k]: e.target.value });
  return (
    <>
      <div className="grid gap-2 sm:grid-cols-2">
        {isNew ? (
          <Field id={`${idBase}-name`} text={S.fieldName}>
            <input
              id={`${idBase}-name`}
              data-testid="pack-form-name"
              value={value.name}
              onChange={set("name")}
              className={fieldClass}
              translate="no"
            />
          </Field>
        ) : null}
        <Field id={`${idBase}-version`} text={S.fieldVersion}>
          <input
            id={`${idBase}-version`}
            data-testid="pack-form-version"
            value={value.version}
            onChange={set("version")}
            className={fieldClass}
            translate="no"
          />
        </Field>
        <Field id={`${idBase}-ttl`} text={S.fieldTitle}>
          <input
            id={`${idBase}-ttl`}
            value={value.title}
            onChange={set("title")}
            className={fieldClass}
          />
        </Field>
      </div>
      <Field id={`${idBase}-desc`} text={S.fieldDescription}>
        <textarea
          id={`${idBase}-desc`}
          rows={2}
          value={value.description}
          onChange={set("description")}
          className={fieldClass}
        />
      </Field>
    </>
  );
}

function problemLine(p: MethodPackProblem): string {
  const S = STR.ws.packs;
  const what = S.problemText(p.code, p.latest);
  return p.role === null
    ? `${S.packProblem}: ${what}`
    : `${p.role} — ${p.type}/${p.name}@${p.version}: ${what}`;
}

/** Every problem of the last check, announced as an alert. */
export function Problems({ problems }: { problems: MethodPackProblem[] }) {
  const S = STR.ws.packs;
  return (
    <div
      data-testid="pack-problems"
      role="alert"
      className="space-y-1 rounded-sf border border-danger bg-danger-bg p-3 text-sm text-danger"
    >
      <p className="font-medium">{S.problems(problems.length)}</p>
      <ul className="list-disc pl-5">
        {problems.map((p, i) => (
          <li key={i}>{problemLine(p)}</li>
        ))}
      </ul>
    </div>
  );
}

/** The readiness line and Check / Publish / Cancel. */
export function Actions(p: {
  readyText: string;
  checking: boolean;
  publishing: boolean;
  canCheck: boolean;
  canPublish: boolean;
  onCheck: () => void;
  onCancel: () => void;
}) {
  const S = STR.ws.packs;
  return (
    <>
      <p className="text-xs text-muted" aria-live="polite">
        {p.readyText}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          data-testid="pack-check"
          pending={p.checking}
          disabled={!p.canCheck}
          onClick={p.onCheck}
          className="rounded-sf border border-line px-3 py-1.5 text-sm text-ink hover:bg-surface-2"
        >
          {S.check}
        </Button>
        <Button
          type="submit"
          data-testid="pack-publish"
          pending={p.publishing}
          disabled={!p.canPublish}
          className="rounded-sf bg-accent px-3 py-1.5 text-sm font-medium text-on-accent disabled:opacity-50"
        >
          {S.publish}
        </Button>
        <button
          type="button"
          onClick={p.onCancel}
          className="rounded-sf px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2"
        >
          {S.cancel}
        </button>
      </div>
    </>
  );
}
