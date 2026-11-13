import { EvalCostMatrix } from "../../components/EvalCostMatrix.tsx";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  getEvalJournal,
  getEvalRun,
  getEvalSuite,
  listEvalRuns,
  putEvalSuite,
  startEvalRun,
} from "../../api/client.ts";
import type {
  EvalCase,
  EvalCheck,
  EvalCheckType,
  EvalGate,
  EvalJournalItem,
  EvalRun,
  EvalRunKind,
  EvalRunScope,
  VersionDetail,
} from "../../api/types.ts";
import { Skeleton } from "../../components/Skeleton.tsx";
import { ErrorState } from "../../components/ErrorState.tsx";
import { HelpTip } from "../../components/HelpTip.tsx";
import { useMe, roleAtLeast } from "../../lib/auth.tsx";
import { STR } from "../../lib/strings.ts";
import { errorText } from "../../i18n/index.ts";
import { Button } from "../../components/Button.tsx";

type Props = {
  type: string;
  name: string;
  versions: VersionDetail[];
  canManage: boolean;
};

type DraftCase = EvalCase & { _key: string };

const CHECK_TYPES: EvalCheckType[] = ["contains", "not_contains", "equals"];

function newKey(): string {
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function toDraft(cases: EvalCase[]): DraftCase[] {
  return cases.map((c) => ({ ...c, _key: c.id || newKey() }));
}

/** Caption of an API value from a dictionary map; unknown values are shown as they are. */
function pick(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}

/** Unmapped API error: its code, followed by the translated or server message when there is one. */
function codeWithText(err: ApiError): string {
  const text = errorText(err);
  return text && text !== err.error ? `${err.error}: ${text}` : err.error;
}

function suiteErrorMessage(err: unknown): string {
  const t = STR.flow.evals.suiteErrors;
  if (!(err instanceof ApiError)) return STR.flow.common.requestFailed;
  if (err.error === "suite_invalid") {
    return err.detail
      ? t.invalidDetail(err.detail)
      : err.message && err.message !== err.error
        ? t.invalidDetail(err.message)
        : t.invalid;
  }
  if (err.error === "gate_needs_holdout") return t.gateNeedsHoldout;
  if (err.error === "forbidden") return t.gateOffForbidden;
  if (err.error === "type_not_supported") return t.typeNotSupported;
  if (err.error === "mcp_token_forbidden") return t.mcpTokenForbidden;
  return codeWithText(err);
}

function runErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return STR.flow.common.requestFailed;
  const table: Record<string, string | undefined> = STR.flow.evals.runErrors;
  return table[err.error] ?? codeWithText(err);
}

function gateLabel(g: EvalJournalItem["gate"]): string {
  return pick(STR.flow.evals.gateLabels, String(g));
}

function fmtRate(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return String(Number(v.toFixed(3)));
}

function emptyCase(kind: "trigger" | "task" = "trigger"): DraftCase {
  const id = `case-${Math.random().toString(36).slice(2, 8)}`;
  if (kind === "trigger") {
    return {
      _key: newKey(),
      id,
      kind: "trigger",
      prompt: "",
      holdout: false,
      expect_trigger: true,
    };
  }
  return {
    _key: newKey(),
    id,
    kind: "task",
    prompt: "",
    holdout: false,
    checks: [{ type: "contains", value: "" }],
  };
}

type EvalRunner = Awaited<ReturnType<typeof getEvalSuite>>["runners"][number];

function suiteLoadErrorMessage(err: unknown): string {
  return err instanceof ApiError && err.status === 403
    ? STR.flow.evals.loadForbidden
    : STR.flow.evals.loadFailed;
}

type EvalRunListItem = Awaited<ReturnType<typeof listEvalRuns>>["items"][number];

/** Recent eval runs; the expanded run shows its summary and per-case results. */
function RunsPanel({
  items,
  expanded,
  expandedRun,
  openRun,
}: {
  items: EvalRunListItem[];
  expanded: string | null;
  expandedRun: EvalRun | null;
  openRun(id: string): Promise<void>;
}) {
  return (
    <div className="rounded-sf border border-line bg-surface p-4 space-y-2">
      <h3 className="text-sm font-medium uppercase tracking-wide text-muted">
        {STR.flow.common.runs}
      </h3>
      {items.length === 0 ? (
        <p className="text-xs text-muted">{STR.flow.common.noRuns}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((r) => (
            <li key={r.id} className="rounded-sf border border-line bg-surface-2 p-2">
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-2 text-left text-xs"
                onClick={() => void openRun(r.id)}
              >
                <span className="font-mono">{String(r.id).slice(0, 8)}</span>
                <span>{pick(STR.flow.evals.kinds, r.kind)}</span>
                <span className="font-mono">{r.version}</span>
                <span
                  className={
                    r.status === "done"
                      ? "text-ok"
                      : r.status === "failed"
                        ? "text-danger"
                        : "text-warning"
                  }
                >
                  {pick(STR.flow.common.status, r.status)}
                </span>
                <span className="text-muted">{STR.flow.evals.errorsCount(r.errors)}</span>
              </button>
              {expanded === r.id && expandedRun ? (
                <div className="mt-2 space-y-2 border-t border-line pt-2 text-xs">
                  {expandedRun.summary ? (
                    <pre className="whitespace-pre-wrap font-mono text-[11px] text-ink-2">
                      {JSON.stringify(expandedRun.summary, null, 2)}
                    </pre>
                  ) : null}
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-muted">
                        <th className="pr-2">{STR.flow.evals.col.case}</th>
                        <th className="pr-2">{STR.flow.evals.col.side}</th>
                        <th className="pr-2">{STR.flow.evals.col.passed}</th>
                        <th className="pr-2">{STR.flow.evals.col.error}</th>
                        <th>{STR.flow.evals.col.output}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(expandedRun.results ?? []).map((row, i) => (
                        <tr key={`${row.case_id}-${row.side}-${i}`}>
                          <td className="pr-2 font-mono">{row.case_id}</td>
                          <td className="pr-2">{pick(STR.flow.evals.sides, row.side)}</td>
                          <td className="pr-2">
                            {row.passed ? STR.flow.evals.yes : STR.flow.evals.no}
                          </td>
                          <td className="pr-2" translate="no">
                            {row.error ?? "—"}
                          </td>
                          <td className="max-w-md break-words font-mono">
                            {row.output_excerpt ?? ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function JournalPanel({ items }: { items: EvalJournalItem[] }) {
  return (
    <div className="rounded-sf border border-line bg-surface p-4 space-y-2">
      <h3 className="text-sm font-medium uppercase tracking-wide text-muted">
        {STR.flow.evals.journal}
      </h3>
      {items.length === 0 ? (
        <p className="text-xs text-muted">{STR.flow.evals.noJournal}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.version}
              data-testid={`eval-journal-row-${item.version}`}
              className="rounded-sf border border-line bg-surface-2 p-2 text-xs space-y-1"
            >
              <div className="flex flex-wrap gap-2 font-mono">
                <span>{item.version}</span>
                <span className="text-muted">{item.channel}</span>
                <span>{gateLabel(item.gate)}</span>
              </div>
              <div className="text-muted">
                {STR.flow.evals.triggerMetrics(
                  fmtRate(item.trigger?.recall),
                  fmtRate(item.trigger?.specificity),
                  fmtRate(item.trigger?.accuracy),
                )}
              </div>
              <div className="text-muted">
                {STR.flow.evals.holdoutMetrics(fmtRate(item.holdout?.pass_rate))}
              </div>
              <div className="text-muted">
                {STR.flow.evals.vsPrevious(
                  item.vs_previous
                    ? STR.flow.evals.vsPreviousValue(
                        item.vs_previous.against,
                        item.vs_previous.wins_candidate,
                        item.vs_previous.wins_baseline,
                        item.vs_previous.ties,
                      )
                    : "—",
                )}
              </div>
              <div className="text-muted">
                {STR.flow.evals.ablationMetrics(
                  fmtRate(item.ablation?.uplift),
                  String(item.ablation?.tasks ?? "—"),
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Run-eval form: kind, version, baseline, runner, scope and the start button. */
function RunEvalPanel({
  runKind,
  setRunKind,
  runVersion,
  setRunVersion,
  liveVersions,
  runAgainst,
  setRunAgainst,
  runners,
  runRunner,
  setRunRunner,
  runScope,
  setRunScope,
  runMut,
  runMsg,
  setRunMsg,
}: {
  runKind: EvalRunKind;
  setRunKind: (v: EvalRunKind) => void;
  runVersion: string;
  setRunVersion: (v: string) => void;
  liveVersions: VersionDetail[];
  runAgainst: string;
  setRunAgainst: (v: string) => void;
  runners: EvalRunner[];
  runRunner: string;
  setRunRunner: (v: string) => void;
  runScope: EvalRunScope;
  setRunScope: (v: EvalRunScope) => void;
  runMut: { isPending: boolean; mutate: () => void };
  runMsg: string | null;
  setRunMsg: (v: string | null) => void;
}) {
  return (
    <div className="rounded-sf border border-line bg-surface p-4 space-y-3">
      <h3 className="text-sm font-medium uppercase tracking-wide text-muted">
        {STR.flow.evals.runEval}
      </h3>
      <div className="flex flex-wrap gap-2 items-end">
        <label className="text-xs text-muted">
          {STR.flow.evals.kind}
          <select
            data-testid="eval-run-kind"
            className="mt-1 block rounded-sf border border-line bg-bg px-2 py-1 text-sm"
            value={runKind}
            onChange={(e) => setRunKind(e.target.value as EvalRunKind)}
          >
            <option value="trigger">{STR.flow.evals.kinds.trigger}</option>
            <option value="compare">{STR.flow.evals.kinds.compare}</option>
            <option value="ablation">{STR.flow.evals.kinds.ablation}</option>
          </select>
        </label>
        <label className="text-xs text-muted">
          {STR.flow.evals.version}
          <select
            data-testid="eval-run-version"
            className="mt-1 block rounded-sf border border-line bg-bg px-2 py-1 font-mono text-sm"
            value={runVersion}
            onChange={(e) => setRunVersion(e.target.value)}
          >
            {liveVersions.map((v) => (
              <option key={v.version} value={v.version}>
                {v.version}
              </option>
            ))}
          </select>
        </label>
        {runKind === "compare" ? (
          <label className="text-xs text-muted">
            {STR.flow.evals.against}
            <input
              data-testid="eval-run-against"
              className="mt-1 block rounded-sf border border-line bg-bg px-2 py-1 font-mono text-sm"
              value={runAgainst}
              placeholder={STR.flow.evals.againstPlaceholder}
              onChange={(e) => setRunAgainst(e.target.value)}
            />
          </label>
        ) : null}
        {runners.length > 0 ? (
          <label className="text-xs text-muted">
            {STR.flow.evals.runner}
            <select
              data-testid="eval-run-runner"
              className="mt-1 block rounded-sf border border-line bg-bg px-2 py-1 text-sm"
              value={runRunner}
              onChange={(e) => setRunRunner(e.target.value)}
            >
              {runners.length > 1 ? <option value="">{STR.flow.evals.selectRunner}</option> : null}
              {runners.map((r) => (
                <option key={r.id} value={r.id} translate="no">
                  {r.label || r.id}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="text-xs text-muted">
          {STR.flow.evals.scope}
          <select
            data-testid="eval-run-scope"
            className="mt-1 block rounded-sf border border-line bg-bg px-2 py-1 text-sm"
            value={runScope}
            onChange={(e) => setRunScope(e.target.value as EvalRunScope)}
          >
            <option value="all">{STR.flow.evals.scopes.all}</option>
            <option value="holdout">{STR.flow.evals.scopes.holdout}</option>
          </select>
        </label>
        <HelpTip action="eval-run-start">
          <Button
            type="button"
            data-testid="eval-run-start"
            className="rounded-sf bg-accent px-3 py-1.5 text-xs font-medium text-white"
            pending={runMut.isPending}
            disabled={!runVersion}
            onClick={() => {
              setRunMsg(null);
              runMut.mutate();
            }}
          >
            {STR.flow.evals.startRun}
          </Button>
        </HelpTip>
      </div>
      {runMsg ? (
        <p data-testid="eval-run-error" className="text-xs text-danger">
          {runMsg}
        </p>
      ) : null}
    </div>
  );
}

export function Evals({ type, name, versions, canManage }: Props) {
  const me = useMe();
  const isReviewerPlus = roleAtLeast(me.data?.role, "reviewer");
  const queryClient = useQueryClient();
  const authOk = !!me.data;
  // Eval data needs a session and the right to manage evals of this artifact.
  const live = canManage && authOk;

  const suiteQ = useQuery({
    queryKey: ["evals-suite", type, name],
    queryFn: () => getEvalSuite(type, name),
    enabled: live,
    staleTime: 10_000,
    retry: false,
  });

  const runsQ = useQuery({
    queryKey: ["evals-runs", type, name],
    queryFn: () => listEvalRuns(type, name),
    enabled: live,
    staleTime: 2_000,
    refetchInterval: (q) => {
      const items = q.state.data?.items ?? [];
      const busy = items.some((r) => r.status === "queued" || r.status === "running");
      return busy && live ? 2000 : false;
    },
  });

  const journalQ = useQuery({
    queryKey: ["evals-journal", type, name],
    queryFn: () => getEvalJournal(type, name),
    enabled: live,
    staleTime: 5_000,
  });

  const [draftCases, setDraftCases] = useState<DraftCase[]>([]);
  const [gate, setGate] = useState<EvalGate>("off");
  const [suiteMsg, setSuiteMsg] = useState<string | null>(null);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedRun, setExpandedRun] = useState<EvalRun | null>(null);

  const [runKind, setRunKind] = useState<EvalRunKind>("trigger");
  const [runVersion, setRunVersion] = useState("");
  const [runAgainst, setRunAgainst] = useState("");
  const [runRunner, setRunRunner] = useState("");
  const [runScope, setRunScope] = useState<EvalRunScope>("all");

  useEffect(() => {
    if (!suiteQ.data) return;
    setDraftCases(toDraft(suiteQ.data.cases));
    setGate(suiteQ.data.gate);
    if (suiteQ.data.runners.length === 1) setRunRunner(suiteQ.data.runners[0]!.id);
  }, [suiteQ.data]);

  useEffect(() => {
    if (!runVersion && versions.length > 0) {
      const head = versions.find((v) => !v.purged);
      if (head) setRunVersion(head.version);
    }
  }, [versions, runVersion]);

  const runners = suiteQ.data?.runners ?? [];

  const saveMut = useMutation({
    mutationFn: (body: { gate?: EvalGate; cases: EvalCase[] }) => putEvalSuite(type, name, body),
    onSuccess: async (data) => {
      setSuiteMsg(null);
      setDraftCases(toDraft(data.cases));
      setGate(data.gate);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["evals-suite", type, name] }),
        queryClient.invalidateQueries({ queryKey: ["evals-journal", type, name] }),
      ]);
    },
    onError: (err) => setSuiteMsg(suiteErrorMessage(err)),
  });

  const runMut = useMutation({
    mutationFn: () => {
      const body: {
        kind: EvalRunKind;
        version: string;
        against?: string;
        runner?: string;
        scope?: EvalRunScope;
      } = { kind: runKind, version: runVersion, scope: runScope };
      if (runKind === "compare" && runAgainst.trim()) body.against = runAgainst.trim();
      if (runRunner) body.runner = runRunner;
      return startEvalRun(type, name, body);
    },
    onSuccess: async () => {
      setRunMsg(null);
      await queryClient.invalidateQueries({ queryKey: ["evals-runs", type, name] });
    },
    onError: (err) => setRunMsg(runErrorMessage(err)),
  });

  const liveVersions = useMemo(() => versions.filter((v) => !v.purged), [versions]);

  function updateCase(key: string, patch: Partial<EvalCase>) {
    setDraftCases((prev) => prev.map((c) => (c._key === key ? { ...c, ...patch } : c)));
  }

  function setChecks(key: string, checks: EvalCheck[]) {
    updateCase(key, { checks });
  }

  function onGateChange(next: EvalGate) {
    setSuiteMsg(null);
    if (gate === "required" && next === "off" && !isReviewerPlus) {
      setSuiteMsg(STR.flow.evals.suiteErrors.gateOffForbidden);
      return;
    }
    if (next === "required") {
      const hasHoldout = draftCases.some((c) => c.holdout);
      if (!hasHoldout) {
        setSuiteMsg(STR.flow.evals.suiteErrors.gateNeedsHoldout);
        return;
      }
    }
    setGate(next);
  }

  function buildPayloadCases(): EvalCase[] {
    return draftCases.map(({ _key, ...rest }) => {
      const c: EvalCase = {
        id: rest.id.trim(),
        kind: rest.kind,
        prompt: rest.prompt,
        holdout: !!rest.holdout,
      };
      if (rest.kind === "trigger") c.expect_trigger = !!rest.expect_trigger;
      if (rest.kind === "task") {
        c.checks = (rest.checks ?? []).slice(0, 10).map((ch) => ({
          type: ch.type,
          value: ch.value,
          ...(ch.ci ? { ci: true } : {}),
        }));
      }
      return c;
    });
  }

  async function openRun(id: string) {
    if (expanded === id) {
      setExpanded(null);
      setExpandedRun(null);
      return;
    }
    setExpanded(id);
    try {
      const { run } = await getEvalRun(type, name, id);
      setExpandedRun(run);
    } catch {
      setExpandedRun(null);
    }
  }

  useEffect(() => {
    if (!expanded) return;
    const item = runsQ.data?.items.find((r) => r.id === expanded);
    if (!item) return;
    if (item.status === "queued" || item.status === "running") {
      void getEvalRun(type, name, expanded)
        .then((r) => setExpandedRun(r.run))
        .catch(() => {});
    }
  }, [runsQ.data, expanded, type, name]);

  if (!canManage) return null;

  if (suiteQ.isLoading) {
    return (
      <section data-testid="evals-panel" className="space-y-3">
        <Skeleton className="h-40" />
      </section>
    );
  }

  if (suiteQ.isError) {
    const err = suiteQ.error;
    const msg = suiteLoadErrorMessage(err);
    return (
      <section data-testid="evals-panel" className="space-y-3">
        <p className="text-sm text-danger">{msg}</p>
        <ErrorState onRetry={() => void suiteQ.refetch()} />
      </section>
    );
  }

  return (
    <section data-testid="evals-panel" className="space-y-6 text-sm">
      <div className="rounded-sf border border-line bg-surface p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium uppercase tracking-wide text-muted">
            {STR.flow.evals.suite}
          </h3>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted" htmlFor="eval-gate">
              {STR.flow.evals.gate}
            </label>
            <HelpTip action="eval-gate-toggle">
              <select
                id="eval-gate"
                data-testid="eval-gate"
                className="rounded-sf border border-line bg-bg px-2 py-1 text-sm"
                value={gate}
                onChange={(e) => onGateChange(e.target.value as EvalGate)}
              >
                <option value="off">{STR.flow.evals.gateOptions.off}</option>
                <option value="required">{STR.flow.evals.gateOptions.required}</option>
              </select>
            </HelpTip>
          </div>
        </div>

        <ul className="space-y-3">
          {draftCases.map((c) => (
            <li
              key={c._key}
              data-testid={`eval-case-${c.id || c._key}`}
              className="rounded-sf border border-line bg-surface-2 p-3 space-y-2"
            >
              <div className="flex flex-wrap gap-2 items-center">
                <input
                  className="w-32 rounded-sf border border-line bg-bg px-2 py-1 font-mono text-xs"
                  value={c.id}
                  placeholder={STR.flow.evals.caseId}
                  onChange={(e) => updateCase(c._key, { id: e.target.value })}
                />
                <select
                  className="rounded-sf border border-line bg-bg px-2 py-1 text-xs"
                  value={c.kind}
                  onChange={(e) => {
                    const kind = e.target.value as "trigger" | "task";
                    if (kind === "trigger") {
                      updateCase(c._key, {
                        kind,
                        expect_trigger: c.expect_trigger ?? true,
                        checks: undefined,
                      });
                    } else {
                      updateCase(c._key, {
                        kind,
                        expect_trigger: undefined,
                        checks: c.checks?.length ? c.checks : [{ type: "contains", value: "" }],
                      });
                    }
                  }}
                >
                  <option value="trigger">{STR.flow.evals.kinds.trigger}</option>
                  <option value="task">{STR.flow.evals.kinds.task}</option>
                </select>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    data-testid={`eval-holdout-${c.id || c._key}`}
                    checked={!!c.holdout}
                    onChange={(e) => updateCase(c._key, { holdout: e.target.checked })}
                  />
                  {STR.flow.evals.holdout}
                </label>
                <button
                  type="button"
                  className="ml-auto rounded-sf border border-danger px-2 py-0.5 text-xs text-danger"
                  onClick={() => setDraftCases((prev) => prev.filter((x) => x._key !== c._key))}
                >
                  {STR.flow.evals.deleteCase}
                </button>
              </div>
              <textarea
                className="w-full rounded-sf border border-line bg-bg px-2 py-1.5 text-sm"
                rows={2}
                placeholder={STR.flow.evals.prompt}
                value={c.prompt}
                onChange={(e) => updateCase(c._key, { prompt: e.target.value })}
              />
              {c.kind === "trigger" ? (
                <label className="flex items-center gap-2 text-xs">
                  {STR.flow.evals.expectTrigger}
                  <select
                    className="rounded-sf border border-line bg-bg px-2 py-1"
                    value={c.expect_trigger === false ? "false" : "true"}
                    onChange={(e) =>
                      updateCase(c._key, { expect_trigger: e.target.value === "true" })
                    }
                  >
                    <option value="true">{STR.flow.evals.bool.true}</option>
                    <option value="false">{STR.flow.evals.bool.false}</option>
                  </select>
                </label>
              ) : (
                <div className="space-y-1">
                  <div className="text-xs text-muted">{STR.flow.evals.checks}</div>
                  {(c.checks ?? []).map((ch, idx) => (
                    <div key={idx} className="flex flex-wrap gap-1 items-center">
                      <select
                        className="rounded-sf border border-line bg-bg px-1 py-0.5 text-xs"
                        value={ch.type}
                        onChange={(e) => {
                          const next = [...(c.checks ?? [])];
                          next[idx] = { ...ch, type: e.target.value as EvalCheckType };
                          setChecks(c._key, next);
                        }}
                      >
                        {CHECK_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {pick(STR.flow.evals.checkTypes, t)}
                          </option>
                        ))}
                      </select>
                      <input
                        className="min-w-[10rem] flex-1 rounded-sf border border-line bg-bg px-2 py-0.5 text-xs"
                        value={ch.value}
                        placeholder={STR.flow.evals.checkValue}
                        onChange={(e) => {
                          const next = [...(c.checks ?? [])];
                          next[idx] = { ...ch, value: e.target.value };
                          setChecks(c._key, next);
                        }}
                      />
                      <label className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={!!ch.ci}
                          onChange={(e) => {
                            const next = [...(c.checks ?? [])];
                            next[idx] = { ...ch, ci: e.target.checked };
                            setChecks(c._key, next);
                          }}
                        />
                        {STR.flow.evals.ci}
                      </label>
                      <button
                        type="button"
                        className="text-xs text-danger"
                        aria-label={STR.flow.evals.removeCheck}
                        onClick={() => {
                          const next = (c.checks ?? []).filter((_, i) => i !== idx);
                          setChecks(c._key, next.length ? next : [{ type: "contains", value: "" }]);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {(c.checks?.length ?? 0) < 10 ? (
                    <button
                      type="button"
                      className="text-xs text-accent"
                      onClick={() =>
                        setChecks(c._key, [...(c.checks ?? []), { type: "contains", value: "" }])
                      }
                    >
                      {STR.flow.evals.addCheck}
                    </button>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-sf border border-line px-2 py-1 text-xs"
            onClick={() => setDraftCases((prev) => [...prev, emptyCase("trigger")])}
          >
            {STR.flow.evals.addTriggerCase}
          </button>
          <button
            type="button"
            className="rounded-sf border border-line px-2 py-1 text-xs"
            onClick={() => setDraftCases((prev) => [...prev, emptyCase("task")])}
          >
            {STR.flow.evals.addTaskCase}
          </button>
          <HelpTip action="eval-save">
            <Button
              type="button"
              data-testid="eval-save"
              className="rounded-sf bg-accent px-3 py-1 text-xs font-medium text-white"
              pending={saveMut.isPending}
              onClick={() => {
                setSuiteMsg(null);
                saveMut.mutate({ gate, cases: buildPayloadCases() });
              }}
            >
              {STR.flow.evals.saveSuite}
            </Button>
          </HelpTip>
        </div>
        {suiteMsg ? (
          <p data-testid="eval-suite-error" className="text-xs text-danger">
            {suiteMsg}
          </p>
        ) : null}
      </div>

      <RunEvalPanel
        runKind={runKind}
        setRunKind={setRunKind}
        runVersion={runVersion}
        setRunVersion={setRunVersion}
        liveVersions={liveVersions}
        runAgainst={runAgainst}
        setRunAgainst={setRunAgainst}
        runners={runners}
        runRunner={runRunner}
        setRunRunner={setRunRunner}
        runScope={runScope}
        setRunScope={setRunScope}
        runMut={runMut}
        runMsg={runMsg}
        setRunMsg={setRunMsg}
      />

      <RunsPanel
        items={runsQ.data?.items ?? []}
        expanded={expanded}
        expandedRun={expandedRun}
        openRun={openRun}
      />

      <EvalCostMatrix type={type} name={name} enabled={live} />

      <JournalPanel items={journalQ.data?.items ?? []} />
    </section>
  );
}
