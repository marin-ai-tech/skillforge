import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  getRoutine,
  getRunOutputContent,
  listRoutineRuns,
  listRoutines,
  listRunOutputs,
  putRoutine,
  runRoutineNow,
  setRoutineEnabled,
  type RoutineRun,
} from "../../api/client.ts";
import { Skeleton } from "../../components/Skeleton.tsx";
import { ErrorState } from "../../components/ErrorState.tsx";
import { HelpTip } from "../../components/HelpTip.tsx";
import { STR } from "../../lib/strings.ts";
import { errorText } from "../../i18n/index.ts";

type Props = { type: string; name: string; canManage: boolean; isAdmin: boolean };

const TEMPLATE = {
  version: 1,
  name: "my-routine",
  schedule: { kind: "every", seconds: 3600 },
  command: { argv: ["node", "-e", "console.log('tick')"], timeout_s: 60 },
  budgets: { max_runs_per_day: 24, max_consecutive_failures: 5 },
};

/** Example routine id shown in the empty id field (content, not interface text). */
const ID_EXAMPLE = "my-routine";

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.detail || errorText(err);
  }
  return STR.flow.common.requestFailed;
}

/** Caption of an API value from a dictionary map; unknown values are shown as they are. */
function pick(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}

const STATUS_BADGE: Record<string, string> = {
  queued: "badge badge-muted",
  running: "badge badge-info",
  done: "badge badge-ok",
  failed: "badge badge-danger",
  skipped: "badge badge-warn",
};

export function Routines({ type, name, canManage, isAdmin }: Props) {
  const qc = useQueryClient();
  const [selectedRt, setSelectedRt] = useState<string | null>(null);
  const [editorText, setEditorText] = useState<string | null>(null);
  const [editorRt, setEditorRt] = useState<string>("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [runId, setRunId] = useState<number | null>(null);

  const defsQ = useQuery({
    queryKey: ["routines", type, name],
    queryFn: () => listRoutines(type, name),
    refetchInterval: 5000,
  });
  const runsQ = useQuery({
    queryKey: ["routine-runs", type, name],
    queryFn: () => listRoutineRuns(type, name),
    refetchInterval: (q) =>
      (q.state.data?.items ?? []).some((r) => r.status === "queued" || r.status === "running")
        ? 1500
        : 5000,
  });
  const outputsQ = useQuery({
    queryKey: ["routine-outputs", type, name, runId],
    queryFn: () => listRunOutputs(type, name, `rt:${runId}`),
    enabled: runId !== null,
  });

  const openEditor = async (rt: string | null) => {
    setSaveError(null);
    if (rt === null) {
      setEditorRt("");
      setEditorText(JSON.stringify(TEMPLATE, null, 2));
      return;
    }
    const data = await getRoutine(type, name, rt);
    setEditorRt(rt);
    setEditorText(JSON.stringify(data.routine.definition, null, 2));
  };

  const saveM = useMutation({
    mutationFn: async () => {
      const rt = editorRt.trim();
      if (!rt) throw new ApiError(400, "invalid_routine_id", STR.flow.routines.idRequired);
      let def: unknown;
      try {
        def = JSON.parse(editorText ?? "");
      } catch {
        throw new ApiError(400, "invalid_json", STR.flow.common.invalidJson);
      }
      return putRoutine(type, name, rt, def);
    },
    onSuccess: () => {
      setSaveError(null);
      setSelectedRt(editorRt.trim());
      setEditorText(null);
      void qc.invalidateQueries({ queryKey: ["routines", type, name] });
    },
    onError: (e) => setSaveError(errorMessage(e)),
  });

  const runM = useMutation({
    mutationFn: (rt: string) => runRoutineNow(type, name, rt),
    onSuccess: (d) => {
      setRunId(d.run.id);
      void qc.invalidateQueries({ queryKey: ["routine-runs", type, name] });
    },
  });
  const toggleM = useMutation({
    mutationFn: ({ rt, enabled }: { rt: string; enabled: boolean }) =>
      setRoutineEnabled(type, name, rt, enabled),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["routines", type, name] }),
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
    <div className="flex flex-col gap-4" data-testid="routines-tab">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{STR.detail.routines}</h3>
        <HelpTip action="routine-save">
          <span className="text-xs text-muted">{STR.flow.routines.hint}</span>
        </HelpTip>
        {isAdmin ? (
          <button className="btn btn-sm" data-testid="rt-new" onClick={() => void openEditor(null)}>
            {STR.flow.routines.newRoutine}
          </button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted" data-testid="rt-empty">
          {STR.flow.routines.empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-1" data-testid="rt-list">
          {items.map((r) => (
            <li key={r.routine_id} className="flex items-center gap-2">
              <button
                className={`btn btn-sm ${selectedRt === r.routine_id ? "btn-primary" : ""}`}
                onClick={() => {
                  setSelectedRt(r.routine_id);
                  if (isAdmin) void openEditor(r.routine_id);
                  else setEditorText(null);
                }}
                translate="no"
              >
                {r.routine_id}
              </button>
              <span className="text-xs text-muted" translate="no">
                {r.name ?? ""}
              </span>
              <span className="text-xs">
                {r.enabled ? (
                  <span className="badge badge-ok">
                    {STR.flow.routines.nextRun(r.next_run_at ?? "—")}
                  </span>
                ) : (
                  <span className="badge badge-warn">{STR.flow.routines.disabled}</span>
                )}
              </span>
              {canManage ? (
                <HelpTip action="routine-run-now">
                  <button
                    className="btn btn-sm"
                    data-testid={`rt-run-${r.routine_id}`}
                    disabled={runM.isPending}
                    onClick={() => runM.mutate(r.routine_id)}
                  >
                    {STR.flow.routines.runNow}
                  </button>
                </HelpTip>
              ) : null}
              {r.enabled && canManage ? (
                <button
                  className="btn btn-sm"
                  data-testid={`rt-toggle-${r.routine_id}`}
                  disabled={toggleM.isPending}
                  onClick={() => toggleM.mutate({ rt: r.routine_id, enabled: false })}
                >
                  {STR.flow.routines.disable}
                </button>
              ) : null}
              {!r.enabled && isAdmin ? (
                <button
                  className="btn btn-sm"
                  data-testid={`rt-toggle-${r.routine_id}`}
                  disabled={toggleM.isPending}
                  onClick={() => toggleM.mutate({ rt: r.routine_id, enabled: true })}
                >
                  {STR.flow.routines.enable}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {isAdmin && editorText !== null ? (
        <div className="card flex flex-col gap-2 p-3" data-testid="rt-editor">
          <label className="text-xs text-muted">
            {STR.flow.routines.routineId}{" "}
            <input
              className="input input-sm font-mono"
              data-testid="rt-id-input"
              value={editorRt}
              onChange={(e) => setEditorRt(e.target.value)}
              placeholder={ID_EXAMPLE}
            />
          </label>
          <textarea
            className="textarea font-mono text-xs"
            rows={14}
            data-testid="rt-def-editor"
            value={editorText}
            onChange={(e) => setEditorText(e.target.value)}
          />
          {saveError ? (
            <pre className="text-xs text-danger whitespace-pre-wrap" data-testid="rt-save-error">
              {saveError}
            </pre>
          ) : null}
          <div className="flex gap-2">
            <button
              className="btn btn-sm btn-primary"
              data-testid="rt-save"
              disabled={saveM.isPending}
              onClick={() => saveM.mutate()}
            >
              {STR.flow.common.save}
            </button>
            <button className="btn btn-sm" onClick={() => setEditorText(null)}>
              {STR.flow.common.cancel}
            </button>
          </div>
        </div>
      ) : null}

      <div>
        <h4 className="text-sm font-semibold">{STR.flow.common.runs}</h4>
        {runsQ.isLoading ? (
          <Skeleton className="h-16" />
        ) : runs.length === 0 ? (
          <p className="text-sm text-muted">{STR.flow.common.noRuns}</p>
        ) : (
          <table className="table-xs mt-1 w-full" data-testid="rt-runs">
            <thead>
              <tr>
                <th>{STR.flow.common.col.id}</th>
                <th>{STR.flow.routines.colRoutine}</th>
                <th>{STR.flow.common.col.status}</th>
                <th>{STR.flow.routines.colTrigger}</th>
                <th>{STR.flow.common.col.exit}</th>
                <th>{STR.flow.common.col.ms}</th>
                <th>{STR.flow.common.col.created}</th>
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
                  <td className="font-mono">{r.routine_id}</td>
                  <td>
                    <span className={STATUS_BADGE[r.status] ?? "badge"}>
                      {pick(STR.flow.common.status, r.status)}
                    </span>
                    {r.timed_out ? (
                      <span className="text-xs"> {STR.flow.common.timeout}</span>
                    ) : null}
                  </td>
                  <td>{pick(STR.flow.routines.triggers, r.trigger)}</td>
                  <td>{r.exit_code ?? "—"}</td>
                  <td>{r.duration_ms ?? "—"}</td>
                  <td className="text-xs">{r.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {runId !== null ? (
        <RunDetail
          run={runs.find((r) => r.id === runId)}
          outputs={outputsQ.data?.items ?? []}
          type={type}
          name={name}
        />
      ) : null}
    </div>
  );
}

function RunDetail({
  run,
  outputs,
  type,
  name,
}: {
  run: RoutineRun | undefined;
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
  if (!run) return null;
  return (
    <div className="card flex flex-col gap-2 p-3" data-testid="rt-run-detail">
      <h4 className="text-sm font-semibold">
        {STR.flow.common.runTitle(run.id)} —{" "}
        <span className={STATUS_BADGE[run.status] ?? "badge"}>
          {pick(STR.flow.common.status, run.status)}
        </span>
        {run.error ? (
          <span className="text-danger text-xs" translate="no">
            {" "}
            {run.error}
          </span>
        ) : null}
      </h4>
      <div className="flex flex-col gap-1">
        {outputs.map((o) => (
          <button
            key={o.id}
            className="link self-start text-xs"
            translate="no"
            onClick={() => void load(o.id)}
          >
            {loadingId === o.id ? "…" : STR.flow.routines.outputSize(o.stream, o.size)}
          </button>
        ))}
      </div>
      {content ? (
        <pre
          className="max-h-64 overflow-auto rounded bg-surface p-2 text-xs"
          data-testid="rt-output-content"
        >
          {content.text}
        </pre>
      ) : null}
    </div>
  );
}
