import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  checkArtifactSource,
  getArtifactSource,
  putArtifactSource,
} from "../api/client.ts";
import type { SourceEdit, SourceState, TrackedSource } from "../api/types.ts";
import { HelpTip } from "./HelpTip.tsx";
import { STR } from "../lib/strings.ts";
import { apiErrorMessage, errorText, formatDateTime } from "../i18n/index.ts";

/**
 * Tracked source of an artifact (tracked-sources): where it comes from upstream, the last check and the edit rules;
 * the owner, a co-author or an admin checks it now, turns tracking on or off and pins a branch or tag. Artifacts
 * without a source (most hand-made ones) render nothing.
 */
type Props = { type: string; name: string; canManage: boolean };

type Outcome = {
  state: SourceState;
  detail?: string | null;
  readyAt?: string;
  version?: string;
};

const REF_RE = /^[A-Za-z0-9._/-]{1,200}$/;
const PROBLEMS = new Set<SourceState>(["failed", "edits_outdated", "path_missing"]);

/** The branch or tag field under the server's rule; empty means the default branch (null). */
function parseRef(input: string): { ok: true; ref: string | null } | { ok: false } {
  const v = input.trim();
  if (v === "") return { ok: true, ref: null };
  return REF_RE.test(v) && !v.split("/").includes("..") ? { ok: true, ref: v } : { ok: false };
}

/** The edit rule an `edits_outdated` check reports (JSON from the server), or null when it is not one. */
function parseRule(detail: string | null | undefined): SourceEdit | null {
  let raw: unknown;
  try {
    raw = JSON.parse(detail ?? "");
  } catch {
    return null;
  }
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.op === "delete" && typeof r.glob === "string") return { op: "delete", glob: r.glob };
  const replace =
    r.op === "replace" &&
    typeof r.file === "string" &&
    typeof r.find === "string" &&
    typeof r.with === "string";
  return replace
    ? { op: "replace", file: r.file as string, find: r.find as string, with: r.with as string }
    : null;
}

function detailText(code: string): string {
  return STR.art.source.details[code] ?? apiErrorMessage(code);
}

/** Plain-text note of an outcome (the outdated rule is shown as a rule, not as text). */
function outcomeNote(o: Outcome): string | null {
  const t = STR.art.source;
  if (o.state === "quarantined") return o.readyAt ? t.readyAt(formatDateTime(o.readyAt)) : null;
  if (o.state === "ok") return o.version ? t.newVersion(o.version) : null;
  const next = t.nextStep[o.state] ?? null;
  if (o.state === "path_missing") return `${t.pathMissing} ${next}`;
  if (o.state === "failed") return o.detail ? `${detailText(o.detail)} ${next}` : next;
  return next;
}

/** Readable state; a state this interface does not know yet is shown as its code. */
function stateLabel(state: SourceState): string {
  return (STR.art.source.states as Record<string, string | undefined>)[state] ?? state;
}

function outcomeSentence(o: Outcome): string {
  const note = outcomeNote(o);
  const label = stateLabel(o.state);
  return note ? `${label}. ${note}` : label;
}

/** The stored state: the server keeps the ready time of a quarantined commit and the new version of an ok check in the detail. */
function currentOutcome(source: TrackedSource): Outcome | null {
  if (!source.state) return null;
  const detail = source.state_detail;
  return {
    state: source.state,
    detail,
    ...(source.state === "quarantined" && detail ? { readyAt: detail } : {}),
    ...(source.state === "ok" && detail ? { version: detail } : {}),
  };
}

function sourceErrorText(err: unknown): string {
  const t = STR.art.source.errors;
  if (!(err instanceof ApiError)) return errorText(err);
  if (err.error === "forbidden") return t.forbidden;
  if (err.error === "source_disabled") return t.disabled;
  if (err.error === "bad_request") return t.badRequest;
  return errorText(err);
}

export function SourcePanel({ type, name, canManage }: Props) {
  const q = useQuery({
    queryKey: ["source", type, name],
    queryFn: () => getArtifactSource(type, name),
    retry: false,
    staleTime: 30_000,
  });
  // Loading renders nothing: most artifacts have no source, and a placeholder would only flash and shift the page.
  if (q.isLoading) return null;
  if (q.isError) return <SourceLoadError onRetry={() => void q.refetch()} />;
  if (!q.data) return null;
  return <SourceView source={q.data} type={type} name={name} canManage={canManage} />;
}

function SourceLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      data-testid="source-panel"
      className="flex flex-wrap items-center gap-2 rounded-sf border border-line bg-surface-2 p-3 text-sm"
    >
      <span data-testid="source-load-error" role="alert" className="text-danger">
        {STR.art.source.loadFailed}
      </span>
      <button
        type="button"
        data-testid="source-retry"
        className="min-h-8 rounded-sf border border-line px-3 py-1 text-xs"
        onClick={onRetry}
      >
        {STR.art.source.retry}
      </button>
    </div>
  );
}

function SourceView({ source, type, name, canManage }: { source: TrackedSource } & Props) {
  const headingId = useId();
  const t = STR.art.source;
  return (
    <section
      data-testid="source-panel"
      aria-labelledby={headingId}
      className="space-y-3 rounded-sf border border-line bg-surface-2 p-3"
    >
      <h2 id={headingId} className="text-xs uppercase tracking-wide text-muted">
        {t.title}
      </h2>
      <p className="text-xs text-ink-2">{t.hint}</p>
      <SourceFacts source={source} outcome={currentOutcome(source)} />
      <EditRules edits={source.edits} />
      {canManage ? <SourceControls source={source} type={type} name={name} /> : null}
    </section>
  );
}

function Fact({ label, children, testId }: { label: string; children: ReactNode; testId: string }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd data-testid={testId} className="min-w-0 text-ink">
        {children}
      </dd>
    </>
  );
}

function RepositoryLink({ url }: { url: string }) {
  // The server keeps https addresses only; anything else is shown as text, never as a link.
  if (!/^https:\/\//i.test(url)) return <span translate="no">{url}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      translate="no"
      className="break-all font-mono text-accent underline"
    >
      {url}
    </a>
  );
}

function SourceFacts({ source, outcome }: { source: TrackedSource; outcome: Outcome | null }) {
  const t = STR.art.source;
  return (
    <dl className="grid grid-cols-1 gap-x-3 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
      <Fact label={t.repository} testId="source-url">
        <RepositoryLink url={source.url} />
      </Fact>
      <Fact label={t.folder} testId="source-path">
        {source.path ? (
          <span translate="no" className="break-all font-mono">
            {source.path}
          </span>
        ) : (
          t.repositoryRoot
        )}
      </Fact>
      <Fact label={t.ref} testId="source-ref-value">
        {source.ref ? (
          <span translate="no" className="break-all font-mono">
            {source.ref}
          </span>
        ) : (
          t.defaultBranch
        )}
      </Fact>
      <Fact label={t.lastCommit} testId="source-commit">
        {source.last_commit ? (
          <code translate="no" title={source.last_commit}>
            {source.last_commit.slice(0, 7)}
          </code>
        ) : (
          t.unknown
        )}
      </Fact>
      <Fact label={t.lastChecked} testId="source-checked-at">
        {source.last_checked_at ? formatDateTime(source.last_checked_at) : t.never}
      </Fact>
      <Fact label={t.tracking} testId="source-tracking">
        {source.enabled ? t.trackingOn : t.trackingOff}
      </Fact>
      <Fact label={t.state} testId="source-state">
        <StateView outcome={outcome} />
      </Fact>
    </dl>
  );
}

function StateView({ outcome }: { outcome: Outcome | null }) {
  const t = STR.art.source;
  if (!outcome) return <>{t.notChecked}</>;
  const note = outcomeNote(outcome);
  const problem = PROBLEMS.has(outcome.state);
  return (
    <div className="space-y-1">
      <span
        data-state={outcome.state}
        className={problem ? "font-medium text-danger" : "font-medium"}
      >
        {stateLabel(outcome.state)}
      </span>
      {outcome.state === "edits_outdated" ? <OutdatedRule detail={outcome.detail} /> : null}
      {note ? (
        <p data-testid="source-state-detail" className="text-xs text-ink-2">
          {note}
        </p>
      ) : null}
    </div>
  );
}

function OutdatedRule({ detail }: { detail: string | null | undefined }) {
  const rule = parseRule(detail);
  return (
    <div data-testid="source-outdated-rule" className="space-y-1 text-xs text-ink-2">
      <p>{STR.art.source.outdatedRule}</p>
      {rule ? (
        <RuleView rule={rule} />
      ) : (
        <code translate="no" className="whitespace-pre-wrap break-all">
          {detail ?? ""}
        </code>
      )}
    </div>
  );
}

/** One edit rule as text: the find/with strings are shown literally (React escapes them), never as markdown. */
function RuleView({ rule }: { rule: SourceEdit }) {
  const t = STR.art.source;
  const code = "whitespace-pre-wrap break-all rounded-sf bg-bg px-1 font-mono";
  if (rule.op === "delete") {
    return (
      <div>
        {t.ruleDelete}{" "}
        <code translate="no" className={code}>
          {rule.glob}
        </code>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div>
        {t.ruleReplaceIn}{" "}
        <code translate="no" className={code}>
          {rule.file}
        </code>
      </div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-2 gap-y-1">
        <dt className="text-muted">{t.ruleFind}</dt>
        <dd className="min-w-0">
          <code translate="no" className={code}>
            {rule.find}
          </code>
        </dd>
        <dt className="text-muted">{t.ruleWith}</dt>
        <dd className="min-w-0">
          {rule.with ? (
            <code translate="no" className={code}>
              {rule.with}
            </code>
          ) : (
            <span className="italic">{t.ruleRemove}</span>
          )}
        </dd>
      </dl>
    </div>
  );
}

function EditRules({ edits }: { edits: SourceEdit[] }) {
  const t = STR.art.source;
  return (
    <div data-testid="source-edits" className="space-y-1 text-sm">
      <h3 className="font-medium text-ink">{t.editsTitle}</h3>
      <p className="text-xs text-ink-2">{t.editsHint}</p>
      {edits.length === 0 ? (
        <p data-testid="source-edits-empty" className="text-xs text-muted">
          {t.noEdits}
        </p>
      ) : (
        <ol className="list-decimal space-y-2 pl-5 text-xs">
          {edits.map((rule, i) => (
            <li key={i} data-testid="source-edit">
              <RuleView rule={rule} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

type ControlsProps = {
  source: TrackedSource;
  type: string;
  name: string;
};

function SourceControls({ source, type, name }: ControlsProps) {
  const t = STR.art.source;
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const key = ["source", type, name];

  const save = useMutation({
    mutationFn: (patch: { enabled?: boolean; ref?: string | null }) =>
      putArtifactSource(type, name, patch),
    onMutate: () => {
      setError(null);
      setMessage("");
    },
    onSuccess: (next, patch) => {
      queryClient.setQueryData(key, next);
      if (patch.ref === undefined) setMessage(t.saved);
      else setMessage(patch.ref ? t.savedRef(patch.ref) : t.savedDefault);
    },
    onError: (err: unknown) => setError(sourceErrorText(err)),
  });

  const check = useMutation({
    mutationFn: () => checkArtifactSource(type, name),
    onMutate: () => {
      setError(null);
      setMessage(t.checking);
    },
    onSuccess: async (result) => {
      setMessage(t.checkResult(outcomeSentence(result)));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: key }),
        queryClient.invalidateQueries({ queryKey: ["artifact", type, name] }),
        queryClient.invalidateQueries({ queryKey: ["versions", type, name] }),
        queryClient.invalidateQueries({ queryKey: ["audit", type, name] }),
      ]);
    },
    onError: (err: unknown) => {
      setMessage("");
      setError(sourceErrorText(err));
    },
  });

  const busy = save.isPending || check.isPending;
  return (
    <div className="space-y-3 border-t border-line pt-3">
      <TrackingToggle
        enabled={source.enabled}
        disabled={busy}
        onChange={(enabled) => save.mutate({ enabled })}
      />
      <RefForm
        current={source.ref}
        disabled={busy}
        onSave={(ref) => save.mutate({ ref })}
        onUnchanged={() => setMessage(t.refUnchanged)}
      />
      <CheckRow
        enabled={source.enabled}
        pending={check.isPending}
        disabled={busy}
        onCheck={() => check.mutate()}
      />
      <p data-testid="source-message" role="status" className="text-xs text-ink-2">
        {message}
      </p>
      {error ? (
        <p data-testid="source-error" role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function TrackingToggle(props: {
  enabled: boolean;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2 text-sm">
      <HelpTip action="source-toggle">
        <input
          id={id}
          type="checkbox"
          data-testid="source-enabled"
          className="h-5 w-5"
          checked={props.enabled}
          disabled={props.disabled}
          onChange={(e) => props.onChange(e.target.checked)}
        />
      </HelpTip>
      <label htmlFor={id} className="text-ink">
        {STR.art.source.enabled}
      </label>
    </div>
  );
}

function RefForm(props: {
  current: string | null;
  disabled: boolean;
  onSave: (ref: string | null) => void;
  onUnchanged: () => void;
}) {
  const t = STR.art.source;
  const [value, setValue] = useState(props.current ?? "");
  const [invalid, setInvalid] = useState(false);
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-error`;

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = parseRef(value);
    setInvalid(!parsed.ok);
    if (!parsed.ok) return;
    if (parsed.ref === props.current) props.onUnchanged();
    else props.onSave(parsed.ref);
  }

  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={submit} noValidate>
      <div className="min-w-[200px] flex-1 text-sm">
        <label htmlFor={id} className="block text-muted">
          {t.ref}
        </label>
        <input
          id={id}
          data-testid="source-ref"
          className="mt-1 block w-full rounded-sf border border-line bg-bg px-2 py-1.5 font-mono text-sm text-ink"
          value={value}
          placeholder={t.defaultBranch}
          onChange={(e) => {
            setValue(e.target.value);
            setInvalid(false);
          }}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${hintId} ${errId}` : hintId}
          autoComplete="off"
          spellCheck={false}
          translate="no"
          maxLength={200}
        />
        <p id={hintId} className="mt-1 text-xs text-ink-2">
          {t.refHint}
        </p>
        {invalid ? (
          <p id={errId} data-testid="source-ref-error" className="mt-1 text-xs text-danger">
            {t.refInvalid}
          </p>
        ) : null}
      </div>
      <HelpTip action="source-ref-save">
        <button
          type="submit"
          data-testid="source-ref-save"
          className="rounded-sf border border-line px-3 py-1.5 text-sm font-medium text-ink disabled:opacity-50"
          disabled={props.disabled}
        >
          {t.refSave}
        </button>
      </HelpTip>
    </form>
  );
}

function CheckRow(props: {
  enabled: boolean;
  pending: boolean;
  disabled: boolean;
  onCheck: () => void;
}) {
  const t = STR.art.source;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <HelpTip action="source-check">
        <button
          type="button"
          data-testid="source-check"
          className="rounded-sf bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg disabled:opacity-50"
          disabled={props.disabled || !props.enabled}
          aria-busy={props.pending || undefined}
          onClick={props.onCheck}
        >
          {props.pending ? t.checking : t.check}
        </button>
      </HelpTip>
      {props.enabled ? null : (
        <span data-testid="source-check-off" className="text-xs text-ink-2">
          {t.checkOff}
        </span>
      )}
    </div>
  );
}
