import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type DragEvent,
  type RefObject,
} from "react";
import { Navigate, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  publishArtifact,
  validateArtifact,
  listArtifactTypes,
  listTeams,
} from "../api/client.ts";
import { roleAtLeast, useMe } from "../lib/auth.tsx";
import type { PublishErrorBody, ValidateResponse } from "../api/types.ts";
import { IssueList } from "../components/IssueList.tsx";
import { QualityReportView } from "../components/QualityReportView.tsx";
import { DuplicatesList } from "../components/DuplicatesList.tsx";
import {
  collectDroppedFiles,
  encodeFiles,
  filesFromInput,
  localFileFromText,
  type LocalFile,
} from "../lib/files.ts";
import { formatBytes } from "../lib/format.ts";
import { STR } from "../lib/strings.ts";
import { apiErrorMessage } from "../i18n/index.ts";
import { PageHeader } from "../components/PageHeader.tsx";
import { HelpTip } from "../components/HelpTip.tsx";
import { FALLBACK_TYPE_IDS } from "../lib/artifact-types.ts";

type Mode = "files" | "paste";

type FormState = {
  type: string;
  typeTouched: boolean;
  name: string;
  description: string;
  version: string;
  changelog: string;
  provenanceSource: string;
  provenanceRef: string;
  visibility: string;
  ownerTeam: string;
};

type State = {
  files: LocalFile[];
  mode: Mode;
  pasteText: string;
  pasteFilename: string;
  form: FormState;
  result: ValidateResponse | null;
  clientIssues: Array<{ code: string; message: string; path?: string }>;
  submitting: boolean;
  submitError: PublishErrorBody | null;
  validating: boolean;
};

type Action =
  | { type: "set_mode"; mode: Mode }
  | { type: "set_files"; files: LocalFile[] }
  | { type: "remove_file"; path: string }
  | { type: "set_paste"; text?: string; filename?: string }
  | { type: "patch_form"; patch: Partial<FormState> }
  | { type: "set_result"; result: ValidateResponse | null }
  | { type: "set_client_issues"; issues: State["clientIssues"] }
  | { type: "set_submitting"; value: boolean }
  | { type: "set_submit_error"; error: PublishErrorBody | null }
  | { type: "set_validating"; value: boolean };

const initialForm: FormState = {
  type: "",
  typeTouched: false,
  name: "",
  description: "",
  version: "",
  changelog: "",
  provenanceSource: "human",
  provenanceRef: "",
  visibility: "org",
  ownerTeam: "",
};

const initial: State = {
  files: [],
  mode: "files",
  pasteText: "",
  pasteFilename: "SKILL.md",
  form: initialForm,
  result: null,
  clientIssues: [],
  submitting: false,
  submitError: null,
  validating: false,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "set_mode":
      return {
        ...state,
        mode: action.mode,
        files: [],
        pasteText: "",
        pasteFilename: "SKILL.md",
        result: null,
        clientIssues: [],
        submitError: null,
        form: { ...state.form, typeTouched: false, type: "" },
      };
    case "set_files":
      return { ...state, files: action.files, submitError: null, clientIssues: [] };
    case "remove_file":
      return {
        ...state,
        files: state.files.filter((f) => f.path !== action.path),
        submitError: null,
      };
    case "set_paste": {
      const pasteText = action.text ?? state.pasteText;
      const pasteFilename = action.filename ?? state.pasteFilename;
      const files =
        pasteText.length > 0 ? [localFileFromText(pasteFilename || "SKILL.md", pasteText)] : [];
      return { ...state, pasteText, pasteFilename, files, submitError: null };
    }
    case "patch_form":
      return { ...state, form: { ...state.form, ...action.patch }, submitError: null };
    case "set_result":
      return { ...state, result: action.result };
    case "set_client_issues":
      return { ...state, clientIssues: action.issues };
    case "set_submitting":
      return { ...state, submitting: action.value };
    case "set_submit_error":
      return { ...state, submitError: action.error };
    case "set_validating":
      return { ...state, validating: action.value };
    default:
      return state;
  }
}

/** Caption of an artifact type; plugin-provided types are shown by their id. */
function typeCaption(type: string): string {
  return (STR.flow.publish.types as Record<string, string | undefined>)[type] ?? type;
}

/** Dry-run summary of what would be published. */
function PublishSummary({
  summary,
  filesCount,
}: {
  summary: ValidateResponse;
  filesCount: number;
}) {
  return (
    <dl data-testid="publish-summary" className="grid gap-2 text-sm sm:grid-cols-[auto_1fr]">
      <dt className="text-muted">{STR.publish.summaryType}</dt>
      <dd>{summary.type ? typeCaption(String(summary.type)) : "—"}</dd>
      <dt className="text-muted">{STR.publish.summaryName}</dt>
      <dd className="font-mono">{summary.artifact?.name ?? "—"}</dd>
      <dt className="text-muted">{STR.publish.summaryDescription}</dt>
      <dd translate="no">{summary.artifact?.description ?? "—"}</dd>
      <dt className="text-muted">{STR.publish.summaryFiles}</dt>
      <dd>{summary.artifact?.files.length ?? filesCount}</dd>
      <dt className="text-muted">{STR.publish.summaryDigest}</dt>
      <dd className="font-mono text-[12px]">
        {summary.artifact?.digest ? summary.artifact.digest.slice(0, 12) : "—"}
      </dd>
      <dt className="text-muted">{STR.publish.summaryNext}</dt>
      <dd className="font-mono">{summary.next_version ?? "—"}</dd>
      {summary.existing?.latest_version ? (
        <>
          <dt className="text-muted">{STR.publish.summaryExisting}</dt>
          <dd className="font-mono">{summary.existing.latest_version}</dd>
        </>
      ) : null}
    </dl>
  );
}

function PublishIssues({
  summary,
  clientIssues,
  submitError,
}: {
  summary: ValidateResponse | null;
  clientIssues: State["clientIssues"];
  submitError: PublishErrorBody | null;
}) {
  return (
    <>
      <IssueList
        testId="publish-errors"
        level="error"
        issues={[
          ...(summary?.errors ?? []).map((i) => ({ ...i, level: "error" as const })),
          ...clientIssues,
          ...(submitError?.errors ?? []),
        ]}
      />
      <IssueList
        testId="publish-warnings"
        level="warning"
        issues={(summary?.warnings ?? []).map((i) => ({ ...i, level: "warning" as const }))}
      />
    </>
  );
}

function PublishConflicts({ summary }: { summary: ValidateResponse | null }) {
  return summary?.conflicts?.map((c) => (
    <div
      key={c}
      data-testid="publish-conflict"
      data-conflict={c}
      className="rounded-sf bg-warning-bg px-2 py-1.5 text-sm text-warning"
    >
      {STR.publish.conflict}: <span className="font-mono">{c}</span>
    </div>
  ));
}

function SubmitErrorBox({ submitError }: { submitError: PublishErrorBody | null }) {
  if (!submitError || submitError.errors) return null;
  const text = apiErrorMessage(submitError.error, submitError.message ?? "");
  return (
    <div className="rounded-sf bg-danger-bg px-2 py-1.5 text-sm text-danger">
      <span className="font-mono">{submitError.error}</span>
      {text ? ` — ${text}` : null}
    </div>
  );
}

type TeamItem = Awaited<ReturnType<typeof listTeams>>["items"][number];

function ModeSwitch({ state, dispatch }: { state: State; dispatch: Dispatch<Action> }) {
  return (
    <div className="flex flex-wrap gap-2">
      <HelpTip action="publish-mode-files">
        <button
          type="button"
          data-testid="publish-mode-files"
          className={`rounded-sf border px-3 py-1.5 text-sm ${state.mode === "files" ? "border-accent bg-accent-soft" : "border-line"}`}
          onClick={() => dispatch({ type: "set_mode", mode: "files" })}
        >
          {STR.publish.modeFiles}
        </button>
      </HelpTip>
      <HelpTip action="publish-mode-paste">
        <button
          type="button"
          data-testid="publish-mode-paste"
          className={`rounded-sf border px-3 py-1.5 text-sm ${state.mode === "paste" ? "border-accent bg-accent-soft" : "border-line"}`}
          onClick={() => dispatch({ type: "set_mode", mode: "paste" })}
        >
          {STR.publish.modePaste}
        </button>
      </HelpTip>
    </div>
  );
}

/** Drop zone / pickers in files mode, filename + body inputs in paste mode. */
function FileSource({
  state,
  dispatch,
  dropRef,
  dirRef,
  filesRef,
  onDrop,
  onDirChange,
  onFilesChange,
}: {
  state: State;
  dispatch: Dispatch<Action>;
  dropRef: RefObject<HTMLDivElement | null>;
  dirRef: RefObject<HTMLInputElement | null>;
  filesRef: RefObject<HTMLInputElement | null>;
  onDrop(e: DragEvent): Promise<void>;
  onDirChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onFilesChange: (e: ChangeEvent<HTMLInputElement>) => void;
}) {
  return state.mode === "files" ? (
    <HelpTip action="publish-dropzone">
      <div
        ref={dropRef}
        data-testid="publish-dropzone"
        className="rounded-sf border border-dashed border-line bg-surface px-6 py-10 text-center"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => void onDrop(e)}
      >
        <p className="text-sm text-ink-2">{STR.publish.dropHint}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <HelpTip action="publish-pick-dir">
            <button
              type="button"
              data-testid="publish-pick-dir"
              className="rounded-sf border border-line bg-bg px-3 py-1.5 text-sm hover:bg-surface-2"
              onClick={() => dirRef.current?.click()}
            >
              {STR.publish.pickDir}
            </button>
          </HelpTip>
          <HelpTip action="publish-pick-files">
            <button
              type="button"
              data-testid="publish-pick-files"
              className="rounded-sf border border-line bg-bg px-3 py-1.5 text-sm hover:bg-surface-2"
              onClick={() => filesRef.current?.click()}
            >
              {STR.publish.pickFiles}
            </button>
          </HelpTip>
        </div>
        <input
          ref={dirRef}
          data-testid="publish-dir-input"
          type="file"
          className="hidden"
          multiple
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          onChange={onDirChange}
        />
        <input
          ref={filesRef}
          data-testid="publish-files-input"
          type="file"
          className="hidden"
          multiple
          onChange={onFilesChange}
        />
      </div>
    </HelpTip>
  ) : (
    <div className="space-y-3 rounded-sf border border-line bg-surface p-4">
      <label className="block text-sm">
        <span className="text-muted">{STR.publish.pasteFilename}</span>
        <HelpTip action="publish-paste-filename">
          <input
            data-testid="publish-paste-filename"
            className="mt-1 w-full rounded-sf border border-line bg-bg px-3 py-1.5 font-mono text-sm"
            value={state.pasteFilename}
            onChange={(e) => dispatch({ type: "set_paste", filename: e.target.value })}
          />
        </HelpTip>
        <span className="mt-1 block text-xs text-muted">{STR.publish.pasteHint}</span>
      </label>
      <label className="block text-sm">
        <span className="text-muted">{STR.publish.pasteBody}</span>
        <HelpTip action="publish-paste">
          <textarea
            data-testid="publish-paste"
            className="mt-1 min-h-[200px] w-full rounded-sf border border-line bg-bg px-3 py-2 font-mono text-sm"
            value={state.pasteText}
            onChange={(e) => dispatch({ type: "set_paste", text: e.target.value })}
          />
        </HelpTip>
      </label>
    </div>
  );
}

function PublishFileList({ state, dispatch }: { state: State; dispatch: Dispatch<Action> }) {
  return state.files.length > 0 ? (
    <ul
      data-testid="publish-files"
      className="space-y-1 rounded-sf border border-line bg-surface p-2"
    >
      {state.files.map((f) => (
        <HelpTip action="publish-file">
          <li
            key={f.path}
            data-testid="publish-file"
            data-path={f.path}
            className="flex items-center justify-between gap-2 rounded-sf px-2 py-1.5 text-sm"
          >
            <span className="truncate font-mono text-[12px]">{f.path}</span>
            <span className="shrink-0 text-xs text-muted">{formatBytes(f.size)}</span>
            <button
              type="button"
              className="shrink-0 rounded-sf border border-line px-2 py-0.5 text-xs text-danger hover:bg-danger-bg"
              aria-label={STR.publish.removeFile}
              onClick={() => dispatch({ type: "remove_file", path: f.path })}
            >
              {STR.publish.removeFile}
            </button>
          </li>
        </HelpTip>
      ))}
    </ul>
  ) : null;
}

function MetadataFields({
  state,
  dispatch,
  typeValue,
  artifactTypeOptions,
  summary,
}: {
  state: State;
  dispatch: Dispatch<Action>;
  typeValue: string;
  artifactTypeOptions: Array<{ id: string; label: string }>;
  summary: ValidateResponse | null;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm">
        <span className="text-muted">{STR.publish.type}</span>
        <HelpTip action="publish-type">
          <select
            data-testid="publish-type"
            className="mt-1 w-full rounded-sf border border-line bg-bg px-3 py-1.5 text-sm"
            value={typeValue}
            onChange={(e) =>
              dispatch({
                type: "patch_form",
                patch: { type: e.target.value, typeTouched: true },
              })
            }
          >
            <option value="">—</option>
            {artifactTypeOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {typeCaption(t.label)}
              </option>
            ))}
          </select>
        </HelpTip>
      </label>
      <label className="block text-sm">
        <span className="text-muted">{STR.publish.name}</span>
        <HelpTip action="publish-name">
          <input
            data-testid="publish-name"
            className="mt-1 w-full rounded-sf border border-line bg-bg px-3 py-1.5 font-mono text-sm"
            value={state.form.name}
            onChange={(e) => dispatch({ type: "patch_form", patch: { name: e.target.value } })}
          />
        </HelpTip>
      </label>
      <label className="block text-sm sm:col-span-2">
        <span className="text-muted">{STR.publish.description}</span>
        <HelpTip action="publish-description">
          <input
            data-testid="publish-description"
            className="mt-1 w-full rounded-sf border border-line bg-bg px-3 py-1.5 text-sm"
            value={state.form.description}
            onChange={(e) =>
              dispatch({ type: "patch_form", patch: { description: e.target.value } })
            }
          />
        </HelpTip>
      </label>
      <label className="block text-sm">
        <span className="text-muted">{STR.publish.version}</span>
        <HelpTip action="publish-version">
          <input
            data-testid="publish-version"
            className="mt-1 w-full rounded-sf border border-line bg-bg px-3 py-1.5 font-mono text-sm"
            placeholder={summary?.next_version ?? ""}
            value={state.form.version}
            onChange={(e) => dispatch({ type: "patch_form", patch: { version: e.target.value } })}
          />
        </HelpTip>
      </label>
      <label className="block text-sm">
        <span className="text-muted">{STR.publish.changelog}</span>
        <HelpTip action="publish-changelog">
          <input
            data-testid="publish-changelog"
            className="mt-1 w-full rounded-sf border border-line bg-bg px-3 py-1.5 text-sm"
            value={state.form.changelog}
            onChange={(e) => dispatch({ type: "patch_form", patch: { changelog: e.target.value } })}
          />
        </HelpTip>
      </label>
      <label className="block text-sm">
        <span className="text-muted">{STR.publish.provenanceSource}</span>
        <HelpTip action="publish-provenance-source">
          <select
            data-testid="publish-provenance-source"
            className="mt-1 w-full rounded-sf border border-line bg-bg px-3 py-1.5 text-sm"
            value={state.form.provenanceSource}
            onChange={(e) =>
              dispatch({
                type: "patch_form",
                patch: { provenanceSource: e.target.value },
              })
            }
          >
            <option value="human">human</option>
            <option value="reckon">reckon</option>
            <option value="agentspace">agentspace</option>
            <option value="dreamteam">dreamteam</option>
            <option value="import">import</option>
          </select>
        </HelpTip>
      </label>
      <label className="block text-sm">
        <span className="text-muted">{STR.publish.provenanceRef}</span>
        <HelpTip action="publish-provenance-ref">
          <input
            data-testid="publish-provenance-ref"
            className="mt-1 w-full rounded-sf border border-line bg-bg px-3 py-1.5 font-mono text-sm"
            value={state.form.provenanceRef}
            onChange={(e) =>
              dispatch({ type: "patch_form", patch: { provenanceRef: e.target.value } })
            }
          />
        </HelpTip>
      </label>
    </div>
  );
}

function VisibilityFields({
  state,
  dispatch,
  myTeams,
}: {
  state: State;
  dispatch: Dispatch<Action>;
  myTeams: TeamItem[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm">
        <span className="text-muted">{STR.flow.publish.visibility}</span>
        <select
          data-testid="publish-visibility"
          className="mt-1 w-full rounded-sf border border-line bg-bg px-3 py-1.5 text-sm"
          value={state.form.visibility}
          onChange={(e) => dispatch({ type: "patch_form", patch: { visibility: e.target.value } })}
        >
          <option value="org">{STR.flow.publish.visibilityOrg}</option>
          <option value="team">{STR.flow.publish.visibilityTeam}</option>
        </select>
      </label>
      {state.form.visibility === "team" ? (
        <label className="block text-sm">
          <span className="text-muted">{STR.flow.publish.team}</span>
          <select
            data-testid="publish-team"
            className="mt-1 w-full rounded-sf border border-line bg-bg px-3 py-1.5 font-mono text-sm"
            value={state.form.ownerTeam}
            onChange={(e) => dispatch({ type: "patch_form", patch: { ownerTeam: e.target.value } })}
          >
            <option value="">{STR.flow.publish.selectTeam}</option>
            {myTeams.map((tm) => (
              <option key={tm.name} value={tm.name} translate="no">
                {tm.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}

/** Dry-run outcome: summary, issues, conflicts, submit error, quality and duplicates. */
function ValidationResult({ state, summary }: { state: State; summary: ValidateResponse | null }) {
  return (
    <div
      data-testid="publish-result"
      className="space-y-3 rounded-sf border border-line bg-surface p-4"
    >
      {summary ? (
        <PublishSummary summary={summary} filesCount={state.files.length} />
      ) : (
        <p className="text-sm text-muted">
          {state.validating ? STR.publish.validating : STR.publish.awaitingFiles}
        </p>
      )}

      <PublishIssues
        summary={summary}
        clientIssues={state.clientIssues}
        submitError={state.submitError}
      />

      <PublishConflicts summary={summary} />

      <SubmitErrorBox submitError={state.submitError} />

      {summary?.quality ? (
        <section data-testid="publish-quality" className="space-y-2 border-t border-line pt-3">
          <h2 className="text-sm font-semibold text-ink">{STR.flow.publish.quality}</h2>
          <QualityReportView
            quality={summary.quality}
            gradeTestId="publish-quality-grade"
            showScore={true}
            showMetrics={false}
            showHook={false}
          />
        </section>
      ) : null}

      {summary && summary.duplicates !== undefined ? (
        <section data-testid="publish-duplicates" className="space-y-2 border-t border-line pt-3">
          <h2 className="text-sm font-semibold text-ink">{STR.flow.publish.duplicates}</h2>
          <DuplicatesList items={summary.duplicates ?? []} />
        </section>
      ) : null}
    </div>
  );
}

function isSubmittable(state: State): boolean {
  return (
    !!state.result &&
    state.result.ok &&
    state.result.conflicts.length === 0 &&
    state.clientIssues.length === 0 &&
    !state.submitting &&
    !!state.form.type
  );
}

/** Type shown in the select: the user's pick, else the dry-run's detected type. */
function effectiveType(state: State): string {
  return state.form.typeTouched
    ? state.form.type
    : state.form.type || (state.result?.detected_type ? String(state.result.detected_type) : "");
}

type EncodedFiles = Parameters<typeof publishArtifact>[0]["files"];

/** Publish request body from the form (empty optional fields are omitted). */
function buildPublishBody(form: FormState, files: EncodedFiles) {
  return {
    type: form.type,
    files,
    provenance: {
      source: form.provenanceSource || "human",
      ref: form.provenanceRef.trim() ? form.provenanceRef.trim() : null,
    },
    ...(form.name.trim() ? { name: form.name.trim() } : {}),
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
    ...(form.version.trim() ? { version: form.version.trim() } : {}),
    ...(form.changelog.trim() ? { changelog: form.changelog.trim() } : {}),
    visibility: (form.visibility === "team" ? "team" : "org") as "org" | "team",
    ...(form.visibility === "team" && form.ownerTeam.trim()
      ? { owner_team: form.ownerTeam.trim() }
      : {}),
  };
}

function publishErrorFrom(e: unknown): PublishErrorBody {
  if (e instanceof ApiError) {
    const body = (e as ApiError & { body?: PublishErrorBody }).body;
    return body ?? { error: e.error, message: e.message };
  }
  return { error: "request_failed", message: String(e) };
}

export function Publish() {
  const [state, dispatch] = useReducer(reducer, initial);
  const [artifactTypeOptions, setArtifactTypeOptions] = useState<
    Array<{ id: string; label: string }>
  >(FALLBACK_TYPE_IDS.map((id) => ({ id, label: id })));
  useEffect(() => {
    let cancelled = false;
    void listArtifactTypes()
      .then((r) => {
        if (!cancelled) setArtifactTypeOptions(r.items.map((t) => ({ id: t.id, label: t.id })));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const meTeams = useQuery({
    queryKey: ["teams"],
    queryFn: listTeams,
    staleTime: 30_000,
  });
  const myTeams = (meTeams.data?.items ?? []).filter((x) => x.is_member);
  const meQuery = useMe();
  const user = meQuery.data;
  const dirRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = STR.flow.publish.pageTitle;
  }, []);

  // Auto dry-run <= 500ms (design: 400ms)
  useEffect(() => {
    if (state.files.length === 0) {
      dispatch({ type: "set_result", result: null });
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      void (async () => {
        dispatch({ type: "set_validating", value: true });
        try {
          const encoded = await encodeFiles(state.files);
          if (!encoded.ok) {
            if (cancelled) return;
            dispatch({ type: "set_client_issues", issues: encoded.issues });
            dispatch({ type: "set_result", result: null });
            return;
          }
          dispatch({ type: "set_client_issues", issues: [] });
          const body: Parameters<typeof validateArtifact>[0] = {
            files: encoded.files,
          };
          if (state.form.typeTouched && state.form.type) body.type = state.form.type;
          if (state.form.name.trim()) body.name = state.form.name.trim();
          if (state.form.description.trim()) body.description = state.form.description.trim();
          if (state.form.version.trim()) body.version = state.form.version.trim();
          const result = await validateArtifact(body);
          if (cancelled) return;
          dispatch({ type: "set_result", result });
          if (!state.form.typeTouched && result.detected_type) {
            dispatch({
              type: "patch_form",
              patch: { type: String(result.detected_type) },
            });
          }
        } catch (e) {
          if (cancelled) return;
          if (e instanceof ApiError) {
            dispatch({
              type: "set_submit_error",
              error: { error: e.error, message: e.message },
            });
          }
        } finally {
          if (!cancelled) dispatch({ type: "set_validating", value: false });
        }
      })();
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [
    state.files,
    state.form.type,
    state.form.typeTouched,
    state.form.name,
    state.form.description,
    state.form.version,
  ]);

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    const collected = await collectDroppedFiles(e.dataTransfer);
    dispatch({ type: "set_files", files: collected });
  }

  function onDirChange(e: ChangeEvent<HTMLInputElement>) {
    dispatch({ type: "set_mode", mode: "files" });
    dispatch({ type: "set_files", files: filesFromInput(e.target.files) });
    e.target.value = "";
  }

  function onFilesChange(e: ChangeEvent<HTMLInputElement>) {
    dispatch({ type: "set_mode", mode: "files" });
    dispatch({ type: "set_files", files: filesFromInput(e.target.files) });
    e.target.value = "";
  }

  const canSubmit = isSubmittable(state);

  async function onSubmit() {
    if (!canSubmit || !state.result) return;
    dispatch({ type: "set_submitting", value: true });
    dispatch({ type: "set_submit_error", error: null });
    try {
      const encoded = await encodeFiles(state.files);
      if (!encoded.ok) {
        dispatch({ type: "set_client_issues", issues: encoded.issues });
        return;
      }
      const body = buildPublishBody(state.form, encoded.files);
      const created = await publishArtifact(body);
      await queryClient.invalidateQueries({ queryKey: ["artifacts"] });
      await queryClient.invalidateQueries({ queryKey: ["artifact"] });
      navigate(`/artifacts/${created.artifact.type}/${created.artifact.name}`, {
        state: { published: created.version.version },
      });
    } catch (e) {
      dispatch({ type: "set_submit_error", error: publishErrorFrom(e) });
    } finally {
      dispatch({ type: "set_submitting", value: false });
    }
  }

  const typeValue = effectiveType(state);

  const summary = state.result;

  if (meQuery.isLoading) {
    return <p className="text-sm text-muted">{STR.common.loading}</p>;
  }
  if (!user) {
    return <Navigate to="/login?next=/publish" replace />;
  }
  if (!roleAtLeast(user.role, "contributor")) {
    return (
      <div
        data-testid="publish-forbidden"
        className="rounded-sf border border-line bg-surface p-4 text-sm"
      >
        {STR.publish.forbidden}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={STR.publish.title}
        description={STR.publish.subtitle}
        topic="pages/publish"
      />

      <ModeSwitch state={state} dispatch={dispatch} />

      <FileSource
        state={state}
        dispatch={dispatch}
        dropRef={dropRef}
        dirRef={dirRef}
        filesRef={filesRef}
        onDrop={onDrop}
        onDirChange={onDirChange}
        onFilesChange={onFilesChange}
      />

      <PublishFileList state={state} dispatch={dispatch} />

      <MetadataFields
        state={state}
        dispatch={dispatch}
        typeValue={typeValue}
        artifactTypeOptions={artifactTypeOptions}
        summary={summary}
      />

      <VisibilityFields state={state} dispatch={dispatch} myTeams={myTeams} />

      <ValidationResult state={state} summary={summary} />

      <HelpTip action="publish-submit">
        <button
          type="button"
          data-testid="publish-submit"
          disabled={!canSubmit}
          className="rounded-sf bg-accent px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => void onSubmit()}
        >
          {state.submitting ? STR.publish.submitting : STR.publish.submit}
        </button>
      </HelpTip>
    </div>
  );
}
