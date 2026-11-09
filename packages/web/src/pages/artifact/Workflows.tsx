import { WorkflowRunActions } from "../../components/WorkflowRunActions.tsx";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  cancelWorkflowRun,
  decideWorkflowGate,
  resumeWorkflowRun,
  getWorkflow,
  getWorkflowRun,
  getRunOutputContent,
  listRunOutputs,
  listWorkflowRuns,
  listWorkflows,
  putWorkflow,
  replayWorkflowRun,
  startWorkflowRun,
  type WorkflowRun,
} from "../../api/client.ts";
import { Skeleton } from "../../components/Skeleton.tsx";
import { ErrorState } from "../../components/ErrorState.tsx";
import { HelpTip } from "../../components/HelpTip.tsx";
import { STR } from "../../lib/strings.ts";
import { errorText } from "../../i18n/index.ts";

type Props = { type: string; name: string; canManage: boolean; isAdmin: boolean };

const TEMPLATE = {
  version: 1,
  name: "my-workflow",
  steps: [
    { id: "first", kind: "command", argv: ["node", "-e", "console.log('step one')"] },
    {
      id: "second",
      kind: "command",
      argv: ["node", "-e", "console.log('step two')"],
      on_failure: "fail",
    },
  ],
};

/** Example workflow id shown in the empty id field (content, not interface text). */
const ID_EXAMPLE = "my-pipeline";

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.detail || errorText(err);
  }
  return STR.flow.common.requestFailed;
}

/** Caption of a run/step status; unknown values are shown as they are. */
function statusText(status: string): string {
  return (STR.flow.common.status as Record<string, string | undefined>)[status] ?? status;
}

const STATUS_BADGE: Record<string, string> = {
  queued: "badge badge-muted",
  running: "badge badge-info",
  done: "badge badge-ok",
  failed: "badge badge-danger",
  cancelled: "badge badge-warn",
  waiting: "badge badge-info",
  exhausted: "badge badge-danger",
  resumed: "badge badge-muted",
};

export function Workflows({ type, name, canManage, isAdmin }: Props) {
  const qc = useQueryClient();
  const [selectedWf, setSelectedWf] = useState<string | null>(null);
  const [editorText, setEditorText] = useState<string | null>(null);
  const [editorWf, setEditorWf] = useState<string>("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [runId, setRunId] = useState<number | null>(null);

  const defsQ = useQuery({
    queryKey: ["workflows", type, name],
    queryFn: () => listWorkflows(type, name),
  });
  const runsQ = useQuery({
    queryKey: ["workflow-runs", type, name],
    queryFn: () => listWorkflowRuns(type, name),
    refetchInterval: (q) =>
      (q.state.data?.items ?? []).some((r) => r.status === "queued" || r.status === "running")
        ? 1500
        : false,
  });
  const runQ = useQuery({
    queryKey: ["workflow-run", type, name, runId],
    queryFn: () => getWorkflowRun(type, name, runId!),
    enabled: runId !== null,
    refetchInterval: (q) =>
      q.state.data?.run.status === "queued" || q.state.data?.run.status === "running"
        ? 1500
        : false,
  });
  const outputsQ = useQuery({
    queryKey: ["workflow-outputs", type, name, runId],
    queryFn: () => listRunOutputs(type, name, `wf:${runId}`),
    enabled: runId !== null && !!runQ.data && runQ.data.run.status !== "queued",
  });

  const openEditor = async (wf: string | null) => {
    setSaveError(null);
    if (wf === null) {
      setEditorWf("");
      setEditorText(JSON.stringify(TEMPLATE, null, 2));
      return;
    }
    const data = await getWorkflow(type, name, wf);
    setEditorWf(wf);
    setEditorText(JSON.stringify(data.workflow.definition, null, 2));
  };

  const selectWorkflow = (wf: string) => {
    setSelectedWf(wf);
    if (isAdmin) {
      void openEditor(wf);
      return;
    }
    setEditorText(null);
  };

  const runM = useMutation({
    mutationFn: (wf: string) => startWorkflowRun(type, name, wf),
    onSuccess: (d) => {
      setRunId(d.run.id);
      void qc.invalidateQueries({ queryKey: ["workflow-runs", type, name] });
    },
  });
  const cancelM = useMutation({
    mutationFn: (id: number) => cancelWorkflowRun(type, name, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["workflow-run", type, name, runId] }),
  });
  const gateM = useMutation({
    mutationFn: (v: { id: number; step: string; decision: "approve" | "reject"; reason: string }) =>
      decideWorkflowGate(type, name, v.id, v.step, v.decision, v.reason),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["workflow-runs", type, name] }),
  });
  const resumeM = useMutation({
    mutationFn: (id: number) => resumeWorkflowRun(type, name, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["workflow-runs", type, name] }),
  });
  const replayM = useMutation({
    mutationFn: (id: number) => replayWorkflowRun(type, name, id),
    onSuccess: (d) => {
      setRunId(d.run.id);
      void qc.invalidateQueries({ queryKey: ["workflow-runs", type, name] });
    },
  });

  const items = useMemo(() => defsQ.data?.items ?? [], [defsQ.data]);
  const runs = useMemo(() => runsQ.data?.items ?? [], [runsQ.data]);

  if (defsQ.isLoading) return <Skeleton className="h-40" />;
  if (defsQ.isError) {
    return (
      <ErrorState
        message={defsQ.error ? errorText(defsQ.error) : undefined}
        onRetry={() => void defsQ.refetch()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="workflows-tab">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{STR.detail.workflows}</h3>
        <HelpTip action="workflow-save">
          <span className="text-xs text-muted">{STR.flow.workflows.hint}</span>
        </HelpTip>
        {isAdmin ? (
          <button className="btn btn-sm" data-testid="wf-new" onClick={() => void openEditor(null)}>
            {STR.flow.workflows.newWorkflow}
          </button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted" data-testid="wf-empty">
          {STR.flow.workflows.empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-1" data-testid="wf-list">
          {items.map((w) => (
            <li key={w.workflow_id} className="flex items-center gap-2">
              <button
                className={`btn btn-sm ${selectedWf === w.workflow_id ? "btn-primary" : ""}`}
                onClick={() => selectWorkflow(w.workflow_id)}
                translate="no"
              >
                {w.workflow_id}
              </button>
              <span className="text-xs text-muted" translate="no">
                {w.name ?? ""}
              </span>
              {canManage ? (
                <HelpTip action="workflow-run-start">
                  <button
                    className="btn btn-sm"
                    data-testid={`wf-run-${w.workflow_id}`}
                    disabled={runM.isPending}
                    onClick={() => runM.mutate(w.workflow_id)}
                  >
                    {STR.flow.workflows.run}
                  </button>
                </HelpTip>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {editorText !== null ? (
        <WorkflowEditor
          type={type}
          name={name}
          editorWf={editorWf}
          editorText={editorText}
          saveError={saveError}
          onWfChange={setEditorWf}
          onTextChange={setEditorText}
          onError={setSaveError}
          onSaved={(wf) => {
            setSaveError(null);
            setSelectedWf(wf);
            setEditorText(null);
            void qc.invalidateQueries({ queryKey: ["workflows", type, name] });
          }}
          onCancel={() => setEditorText(null)}
        />
      ) : null}

      <div>
        <h4 className="text-sm font-semibold">{STR.flow.common.runs}</h4>
        {runsQ.isLoading ? (
          <Skeleton className="h-16" />
        ) : runs.length === 0 ? (
          <p className="text-sm text-muted">{STR.flow.common.noRuns}</p>
        ) : (
          <table className="table-xs mt-1 w-full" data-testid="wf-runs">
            <thead>
              <tr>
                <th>{STR.flow.common.col.id}</th>
                <th>{STR.flow.workflows.colWorkflow}</th>
                <th>{STR.flow.common.col.status}</th>
                <th>{STR.flow.workflows.colRequested}</th>
                <th>{STR.flow.common.col.created}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>
                    <button className="link" onClick={() => setRunId(r.id)}>
                      {r.id}
                    </button>
                  </td>
                  <td className="font-mono">{r.workflow_id}</td>
                  <td>
                    <span className={STATUS_BADGE[r.status] ?? "badge"}>
                      {statusText(r.status)}
                    </span>
                  </td>
                  <td translate="no">{r.requested_by}</td>
                  <td className="text-xs">{r.created_at}</td>
                  <td>
                    <WorkflowRunActions
                      run={r}
                      onCancel={() => cancelM.mutate(r.id)}
                      onReplay={() => replayM.mutate(r.id)}
                      onResume={() => resumeM.mutate(r.id)}
                      onDecide={(decision, reason) =>
                        gateM.mutate({ id: r.id, step: r.current_step ?? "", decision, reason })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {runId !== null && runQ.data ? (
        <RunTrace
          run={runQ.data.run}
          outputs={outputsQ.data?.items ?? []}
          type={type}
          name={name}
        />
      ) : null}
    </div>
  );
}

function WorkflowEditor({
  type,
  name,
  editorWf,
  editorText,
  saveError,
  onWfChange,
  onTextChange,
  onError,
  onSaved,
  onCancel,
}: {
  type: string;
  name: string;
  editorWf: string;
  editorText: string;
  saveError: string | null;
  onWfChange: (v: string) => void;
  onTextChange: (v: string) => void;
  onError: (v: string) => void;
  onSaved: (wf: string) => void;
  onCancel: () => void;
}) {
  const saveM = useMutation({
    mutationFn: async () => {
      const wf = editorWf.trim();
      if (!wf) throw new ApiError(400, "invalid_workflow_id", STR.flow.workflows.idRequired);
      let def: unknown;
      try {
        def = JSON.parse(editorText ?? "");
      } catch {
        throw new ApiError(400, "invalid_json", STR.flow.common.invalidJson);
      }
      return putWorkflow(type, name, wf, def);
    },
    onSuccess: () => onSaved(editorWf.trim()),
    onError: (e) => onError(errorMessage(e)),
  });
  return (
    <div className="card flex flex-col gap-2 p-3" data-testid="wf-editor">
      <label className="text-xs text-muted">
        {STR.flow.workflows.workflowId}{" "}
        <input
          className="input input-sm font-mono"
          data-testid="wf-id-input"
          value={editorWf}
          onChange={(e) => onWfChange(e.target.value)}
          placeholder={ID_EXAMPLE}
        />
      </label>
      <textarea
        className="textarea font-mono text-xs"
        rows={14}
        data-testid="wf-def-editor"
        value={editorText}
        onChange={(e) => onTextChange(e.target.value)}
      />
      {saveError ? (
        <pre className="text-xs text-danger whitespace-pre-wrap" data-testid="wf-save-error">
          {saveError}
        </pre>
      ) : null}
      <div className="flex gap-2">
        <button
          className="btn btn-sm btn-primary"
          data-testid="wf-save"
          disabled={saveM.isPending}
          onClick={() => saveM.mutate()}
        >
          {STR.flow.common.save}
        </button>
        <button className="btn btn-sm" onClick={onCancel}>
          {STR.flow.common.cancel}
        </button>
      </div>
    </div>
  );
}

function RunTrace({
  run,
  outputs,
  type,
  name,
}: {
  run: WorkflowRun;
  outputs: { id: number; stream: string; name: string | null; size: number }[];
  type: string;
  name: string;
}) {
  const [content, setContent] = useState<{ id: number; text: string } | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const load = async (id: number) => {
    setLoadingId(id);
    try {
      const text = await getRunOutputContent(type, name, id);
      setContent({ id, text });
    } finally {
      setLoadingId(null);
    }
  };
  return (
    <div className="card flex flex-col gap-2 p-3" data-testid="wf-trace">
      <h4 className="text-sm font-semibold">
        {STR.flow.common.runTitle(run.id)} —{" "}
        <span className={STATUS_BADGE[run.status] ?? "badge"}>{statusText(run.status)}</span>
        {run.error ? (
          <span className="text-danger text-xs" translate="no">
            {" "}
            {run.error}
          </span>
        ) : null}
      </h4>
      {run.steps && run.steps.length > 0 ? (
        <table className="table-xs w-full">
          <thead>
            <tr>
              <th>{STR.flow.workflows.colStep}</th>
              <th>{STR.flow.common.col.status}</th>
              <th>{STR.flow.common.col.exit}</th>
              <th>{STR.flow.common.col.ms}</th>
              <th>{STR.flow.workflows.colNext}</th>
              <th>{STR.flow.common.col.output}</th>
            </tr>
          </thead>
          <tbody>
            {run.steps.map((s) => {
              const outs = outputs.filter(
                (o) => o.name === `${run.workflow_id}:${s.step_id}` && o.stream !== "trace",
              );
              return (
                <tr key={s.step_id}>
                  <td className="font-mono">{s.step_id}</td>
                  <td>
                    <span className={STATUS_BADGE[s.status] ?? "badge"}>
                      {statusText(s.status)}
                    </span>
                    {s.timed_out ? (
                      <span className="text-xs"> {STR.flow.common.timeout}</span>
                    ) : null}
                  </td>
                  <td>{s.exit_code ?? "—"}</td>
                  <td>{s.duration_ms ?? "—"}</td>
                  <td className="font-mono">{s.next_step ?? "—"}</td>
                  <td className="flex flex-col gap-1">
                    {outs.map((o) => (
                      <button
                        key={o.id}
                        className="link text-xs"
                        translate="no"
                        onClick={() => void load(o.id)}
                      >
                        {loadingId === o.id ? "…" : o.stream}
                      </button>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="text-xs text-muted">{STR.flow.workflows.noSteps}</p>
      )}
      {outputs.some((o) => o.stream === "trace") ? (
        <button
          className="link self-start text-xs"
          onClick={() => void load(outputs.find((o) => o.stream === "trace")!.id)}
        >
          {STR.flow.workflows.fullTrace}
        </button>
      ) : null}
      {content ? (
        <pre
          className="max-h-64 overflow-auto rounded bg-surface p-2 text-xs"
          data-testid="wf-output-content"
        >
          {content.text}
        </pre>
      ) : null}
    </div>
  );
}
