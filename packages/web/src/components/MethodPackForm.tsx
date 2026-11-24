import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { checkMethodPack, publishMethodPack } from "../api/client.ts";
import type { MethodPackDraft, MethodPackProblem, PackVersion } from "../api/types.ts";
import { errorText } from "../i18n/index.ts";
import { itemLines, nextPatch, parseItemLines } from "../lib/method-pack-diff.ts";
import { STR } from "../lib/strings.ts";
import {
  Actions,
  HeadFields,
  Problems,
  fieldClass as field,
  labelClass as label,
  type PackHead,
} from "./MethodPackFormParts.tsx";

type RoleDraft = { name: string; description: string; text: string };

type Props = {
  /** The pack a new version is for; absent for a new pack. */
  packName?: string;
  latest?: PackVersion | null;
  onCancel: () => void;
};

function rolesFrom(latest: PackVersion | null | undefined): RoleDraft[] {
  if (!latest) return [{ name: "", description: "", text: "" }];
  return latest.roles.map((r) => ({
    name: r.name,
    description: r.description,
    text: itemLines(r.items),
  }));
}

type Built = { draft: MethodPackDraft; badRole: number | null; badLine: number | null };

function build(head: PackHead, roles: RoleDraft[]): Built {
  const out: MethodPackDraft = {
    name: head.name.trim(),
    version: head.version.trim(),
    title: head.title.trim(),
    description: head.description.trim(),
    roles: [],
  };
  for (let i = 0; i < roles.length; i++) {
    const r = roles[i]!;
    const parsed = parseItemLines(r.text);
    if (parsed.badLine !== null) return { draft: out, badRole: i, badLine: parsed.badLine };
    out.roles.push({ name: r.name.trim(), description: r.description.trim(), items: parsed.items });
  }
  return { draft: out, badRole: null, badLine: null };
}

function RoleFields({
  role,
  index,
  idBase,
  error,
  onChange,
  onRemove,
}: {
  role: RoleDraft;
  index: number;
  idBase: string;
  error: string | null;
  onChange: (r: RoleDraft) => void;
  onRemove: (() => void) | null;
}) {
  const S = STR.ws.packs;
  const id = `${idBase}-role${index}`;
  const describedBy = error ? `${id}-hint ${id}-err` : `${id}-hint`;
  return (
    <fieldset data-testid="pack-form-role" className="space-y-2 rounded-sf border border-line p-3">
      <legend className="px-1 text-xs font-medium text-ink-2">{S.roleLegend(index + 1)}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={`${id}-name`} className={label}>
            {S.roleName(index + 1)}
          </label>
          <input
            id={`${id}-name`}
            value={role.name}
            onChange={(e) => onChange({ ...role, name: e.target.value })}
            className={field}
            translate="no"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-desc`} className={label}>
            {S.roleDescription(index + 1)}
          </label>
          <input
            id={`${id}-desc`}
            value={role.description}
            onChange={(e) => onChange({ ...role, description: e.target.value })}
            className={field}
          />
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-items`} className={label}>
          {S.items(role.name.trim())}
        </label>
        <textarea
          id={`${id}-items`}
          rows={Math.min(10, Math.max(3, role.text.split("\n").length + 1))}
          value={role.text}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange({ ...role, text: e.target.value })}
          className={`${field} font-mono text-xs`}
          translate="no"
        />
        <p id={`${id}-hint`} className="text-xs text-muted">
          {S.itemsHint}
        </p>
        {error ? (
          <p id={`${id}-err`} className="text-xs text-danger">
            {error}
          </p>
        ) : null}
      </div>
      {onRemove ? (
        <button
          type="button"
          aria-label={S.removeRoleN(index + 1)}
          className="min-h-6 text-xs text-ink-2 underline"
          onClick={onRemove}
        >
          {S.removeRole}
        </button>
      ) : null}
    </fieldset>
  );
}

/** The result of the last action, for the polite status line and the error alert. */
type Outcome =
  { kind: "none" } | { kind: "problems"; key: string } | { kind: "error"; error: unknown };

function useMethodPackActions(packName: string | undefined, onDone: () => void) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [checked, setChecked] = useState<string | null>(null);
  const [problems, setProblems] = useState<MethodPackProblem[]>([]);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "none" });
  const check = useMutation({
    mutationFn: (v: { key: string; draft: MethodPackDraft }) => checkMethodPack(v.draft),
    onMutate: () => setOutcome({ kind: "none" }),
    onSuccess: (r, v) => {
      setProblems(r.problems);
      setChecked(r.ok ? v.key : null);
      setOutcome(r.ok ? { kind: "none" } : { kind: "problems", key: v.key });
    },
    onError: (e) => setOutcome({ kind: "error", error: e }),
  });
  const publish = useMutation({
    mutationFn: (v: { key: string; draft: MethodPackDraft }) => publishMethodPack(v.draft),
    onMutate: () => setOutcome({ kind: "none" }),
    onSuccess: async (r, v) => {
      if (!r.ok) {
        setProblems(r.problems);
        setChecked(null);
        setOutcome({ kind: "problems", key: v.key });
        return;
      }
      const { name, version } = v.draft;
      await qc.invalidateQueries({ queryKey: ["pack", name] });
      await qc.invalidateQueries({ queryKey: ["packs"] });
      navigate(`/packs/${encodeURIComponent(name)}`, {
        replace: !!packName,
        state: { published: `${name}@${version}` },
      });
      onDone();
    },
    onError: (e) => setOutcome({ kind: "error", error: e }),
  });
  /** Any edit makes the last check and its problems stale. */
  const edited = () => {
    setChecked(null);
    setProblems([]);
    setOutcome({ kind: "none" });
  };
  return { check, publish, checked, problems, outcome, edited };
}

/**
 * The form of a new method pack or a new version (pack-authoring): «Check» sends the draft to /packs/check and lists
 * every problem; «Publish» is available only after a successful check of exactly the current content.
 */
export function MethodPackForm({ packName, latest, onCancel }: Props) {
  const S = STR.ws.packs;
  const idBase = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [head, setHeadRaw] = useState<PackHead>(() => ({
    name: packName ?? "",
    version: packName ? nextPatch(latest?.version) : "0.1.0",
    title: latest?.title ?? "",
    description: latest?.description ?? "",
  }));
  const [roles, setRolesRaw] = useState<RoleDraft[]>(() => rolesFrom(latest));
  const { check, publish, checked, problems, outcome, edited } = useMethodPackActions(
    packName,
    onCancel,
  );
  const built = build(head, roles);
  const key = JSON.stringify(built.draft);
  const lineError = built.badLine !== null ? S.lineError(built.badLine) : null;
  const ready = checked === key && !lineError;
  const busy = check.isPending || publish.isPending;
  const setHead = (h: PackHead) => {
    setHeadRaw(h);
    edited();
  };
  const setRoles = (f: (rs: RoleDraft[]) => RoleDraft[]) => {
    setRolesRaw(f);
    edited();
  };

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const statusText = ready
    ? S.ready(built.draft.name, built.draft.version)
    : outcome.kind === "problems" && outcome.key === key
      ? S.problems(problems.length)
      : S.checkFirst;
  return (
    <form
      data-testid="pack-form"
      aria-labelledby={`${idBase}-title`}
      aria-busy={busy || undefined}
      className="space-y-3 rounded-sf border border-line bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !publish.isPending) publish.mutate({ key, draft: built.draft });
      }}
    >
      <h2
        id={`${idBase}-title`}
        ref={headingRef}
        tabIndex={-1}
        className="text-base font-semibold text-ink"
      >
        {packName ? S.formTitleVersion(packName) : S.formTitleNew}
      </h2>
      <HeadFields idBase={idBase} isNew={!packName} value={head} onChange={setHead} />
      {roles.map((r, i) => (
        <RoleFields
          key={i}
          role={r}
          index={i}
          idBase={idBase}
          error={built.badRole === i ? lineError : null}
          onChange={(nr) => setRoles((rs) => rs.map((x, j) => (j === i ? nr : x)))}
          onRemove={roles.length > 1 ? () => setRoles((rs) => rs.filter((_, j) => j !== i)) : null}
        />
      ))}
      <button
        type="button"
        className="min-h-6 text-sm text-ink-2 underline"
        onClick={() => setRoles((rs) => [...rs, { name: "", description: "", text: "" }])}
      >
        {S.addRole}
      </button>
      {problems.length > 0 && outcome.kind === "problems" && outcome.key === key ? (
        <Problems problems={problems} />
      ) : null}
      {outcome.kind === "error" ? (
        <p role="alert" data-testid="pack-form-error" className="text-sm text-danger">
          {errorText(outcome.error)}
        </p>
      ) : null}
      <Actions
        readyText={statusText}
        checking={check.isPending}
        publishing={publish.isPending}
        canCheck={lineError === null}
        canPublish={ready}
        onCheck={() => check.mutate({ key, draft: built.draft })}
        onCancel={onCancel}
      />
    </form>
  );
}
