import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  backfillValidation,
  getAdminLlm,
  putAdminLlm,
  testAdminLlm,
  type AdminLlmView,
  type LlmSettings,
  type LlmTestResult,
  type TaskUsageTotals,
  type UsageTotals,
} from "../../api/assistant.ts";
import { RequireUser } from "../../components/RequireUser.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { HelpTip } from "../../components/HelpTip.tsx";
import { STR } from "../../lib/strings.ts";
import { apiErrorMessage, errorText } from "../../i18n/index.ts";

/**
 * LLM settings for the help assistant. Every setting except the API key is
 * edited here; the key lives only in the server environment, the page shows whether it is set and allowed.
 */
type NumberField =
  | "temperature"
  | "max_output_tokens"
  | "timeout_s"
  | "daily_requests_per_user"
  | "context_topics"
  | "validation_daily_requests"
  | "validation_max_output_tokens"
  | "validation_timeout_s";

const NUMBER_FIELDS: Array<{ id: NumberField; label: () => string; step: string }> = [
  { id: "temperature", label: () => STR.adm.assistant.temperature, step: "0.1" },
  { id: "max_output_tokens", label: () => STR.adm.assistant.maxOutputTokens, step: "1" },
  { id: "timeout_s", label: () => STR.adm.assistant.timeout, step: "1" },
  { id: "daily_requests_per_user", label: () => STR.adm.assistant.dailyLimit, step: "1" },
  { id: "context_topics", label: () => STR.adm.assistant.contextTopics, step: "1" },
];

const VALIDATION_FIELDS: Array<{ id: NumberField; label: () => string; step: string }> = [
  { id: "validation_daily_requests", label: () => STR.adm.assistant.validationDaily, step: "1" },
  {
    id: "validation_max_output_tokens",
    label: () => STR.adm.assistant.validationTokens,
    step: "1",
  },
  { id: "validation_timeout_s", label: () => STR.adm.assistant.validationTimeout, step: "1" },
];

const inputCls = "w-full rounded-sf border border-line bg-surface px-3 py-1.5 text-sm";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium text-ink">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

function KeyStatus({ view, baseUrl }: { view: AdminLlmView; baseUrl: string }) {
  const k = view.key;
  // The allowed-origin flag reflects the saved address; an unsaved edit is checked after saving.
  const saved = baseUrl === view.settings.base_url;
  return (
    <div
      data-testid="llm-key-status"
      className="space-y-1 rounded-sf border border-line bg-surface-2 p-3 text-sm"
    >
      <div className="font-medium text-ink">{STR.adm.assistant.keyTitle}</div>
      <p className="text-ink-2">
        {k.set ? STR.adm.assistant.keySet(k.env) : STR.adm.assistant.keyNotSet(k.env)}
      </p>
      {k.set && view.settings.base_url && saved ? (
        <p className={k.allowed_for_base_url ? "text-ink-2" : "text-warning"}>
          {k.allowed_for_base_url
            ? STR.adm.assistant.keyAllowed
            : STR.adm.assistant.keyNotAllowed(k.origins_env)}
        </p>
      ) : null}
    </div>
  );
}

function Usage({ usage }: { usage: AdminLlmView["usage"] }) {
  const row = (label: string, u: UsageTotals) => (
    <li>
      <span className="font-medium text-ink">{label}:</span>{" "}
      {STR.adm.assistant.usageRow(u.requests, u.input_tokens, u.output_tokens, u.users)}
    </li>
  );
  const taskRow = (label: string, u: TaskUsageTotals) => (
    <li>
      <span className="font-medium text-ink">{label}:</span>{" "}
      {STR.adm.assistant.taskUsageRow(u.requests, u.input_tokens, u.output_tokens)}
    </li>
  );
  return (
    <section className="space-y-1 text-sm text-ink-2">
      <h2 className="text-base font-semibold text-ink">{STR.adm.assistant.usageTitle}</h2>
      <ul data-testid="llm-usage" className="space-y-0.5">
        {row(STR.adm.assistant.usageToday, usage.today)}
        {row(STR.adm.assistant.usage30, usage.last_30_days)}
      </ul>
      <h3 className="pt-2 text-sm font-semibold text-ink">{STR.adm.assistant.validationTitle}</h3>
      <ul data-testid="llm-validation-usage" className="space-y-0.5">
        {taskRow(STR.adm.assistant.usageToday, usage.tasks.skill_validation.today)}
        {taskRow(STR.adm.assistant.usage30, usage.tasks.skill_validation.last_30_days)}
      </ul>
    </section>
  );
}

/** Skill checks use the same connection: the switch, what leaves the server and the budget are spelled out here. */
function ValidationSection({
  view,
  draft,
  set,
}: {
  view: AdminLlmView;
  draft: LlmSettings;
  set: <K extends keyof LlmSettings>(key: K, value: LlmSettings[K]) => void;
}) {
  const [result, setResult] = useState<string | null>(null);
  const backfill = useMutation({
    mutationFn: backfillValidation,
    onSuccess: (r) => setResult(STR.adm.assistant.backfillDone(r.queued, r.skipped)),
    onError: (e) => setResult(errorText(e)),
  });
  const { active, reason, consumer_ready: ready } = view.validation;
  return (
    <fieldset data-testid="llm-validation" className="space-y-3 rounded-sf border border-line p-3">
      <legend className="px-1 text-sm font-semibold text-ink">
        {STR.adm.assistant.validationTitle}
      </legend>
      <label className="flex items-center gap-2 text-sm font-medium text-ink">
        <input
          type="checkbox"
          data-testid="llm-validation-enabled"
          checked={draft.validation_enabled === true}
          onChange={(e) => set("validation_enabled", e.target.checked)}
        />
        {STR.adm.assistant.validationEnabled}
      </label>
      <p data-testid="llm-validation-warning" className="text-sm text-warning">
        {STR.adm.assistant.validationWarning}
      </p>
      {reason === "undecided" ? (
        <p data-testid="llm-validation-undecided" className="text-sm text-ink-2">
          {STR.adm.assistant.validationUndecided}
        </p>
      ) : null}
      {ready ? null : (
        <p data-testid="llm-validation-no-plugin" className="text-sm text-warning">
          {STR.adm.assistant.validationNoPlugin}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {VALIDATION_FIELDS.map((f) => (
          <Field key={f.id} label={f.label()}>
            <input
              type="number"
              step={f.step}
              data-testid={`llm-${f.id.replace(/_/g, "-")}`}
              className={inputCls}
              value={draft[f.id]}
              onChange={(e) => set(f.id, Number(e.target.value))}
            />
          </Field>
        ))}
      </div>
      {active && ready ? (
        <div className="flex flex-wrap items-center gap-2">
          <HelpTip action="llm-validation-backfill">
            <button
              type="button"
              data-testid="llm-validation-backfill"
              disabled={backfill.isPending}
              onClick={() => backfill.mutate()}
              className="rounded-sf border border-line px-3 py-1.5 text-sm text-ink-2 disabled:opacity-50"
            >
              {STR.adm.assistant.backfill}
            </button>
          </HelpTip>
          {result ? (
            <span
              data-testid="llm-validation-backfill-result"
              role="status"
              className="text-sm text-ink-2"
            >
              {result}
            </span>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}

function testText(r: LlmTestResult): string {
  return r.ok
    ? STR.adm.assistant.testOk(r.model, r.latency_ms)
    : STR.adm.assistant.testFailed(apiErrorMessage(r.error, r.error));
}

function SettingsForm({ view }: { view: AdminLlmView }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<LlmSettings>(view.settings);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => putAdminLlm(draft),
    onSuccess: (next) => {
      setError(null);
      setNotice(STR.adm.assistant.saved);
      queryClient.setQueryData(["admin-llm"], next);
      void queryClient.invalidateQueries({ queryKey: ["assistant-status"] });
    },
    onError: (e) => setError(errorText(e)),
  });
  const check = useMutation({
    mutationFn: testAdminLlm,
    onSuccess: (r) => setTest(testText(r)),
    onError: (e) => setTest(errorText(e)),
  });
  const set = <K extends keyof LlmSettings>(key: K, value: LlmSettings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <form
      className="max-w-2xl space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setNotice(null);
        save.mutate();
      }}
    >
      <label className="flex items-center gap-2 text-sm font-medium text-ink">
        <input
          type="checkbox"
          data-testid="llm-enabled"
          checked={draft.enabled}
          onChange={(e) => set("enabled", e.target.checked)}
        />
        {STR.adm.assistant.enabled}
      </label>
      <Field label={STR.adm.assistant.baseUrl} hint={STR.adm.assistant.baseUrlHint}>
        <input
          data-testid="llm-base-url"
          className={`${inputCls} font-mono`}
          value={draft.base_url}
          onChange={(e) => set("base_url", e.target.value)}
          translate="no"
        />
      </Field>
      <Field label={STR.adm.assistant.model}>
        <input
          data-testid="llm-model"
          className={`${inputCls} font-mono`}
          value={draft.model}
          onChange={(e) => set("model", e.target.value)}
          translate="no"
        />
      </Field>
      <KeyStatus view={view} baseUrl={draft.base_url} />
      <div className="grid gap-3 sm:grid-cols-2">
        {NUMBER_FIELDS.map((f) => (
          <Field key={f.id} label={f.label()}>
            <input
              type="number"
              step={f.step}
              data-testid={`llm-${f.id.replace(/_/g, "-")}`}
              className={inputCls}
              value={draft[f.id]}
              onChange={(e) => set(f.id, Number(e.target.value))}
            />
          </Field>
        ))}
      </div>
      <ValidationSection view={view} draft={draft} set={set} />
      {error ? (
        <p data-testid="llm-error" role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p data-testid="llm-notice" role="status" className="text-sm text-ink-2">
          {notice}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <HelpTip action="llm-save">
          <button
            type="submit"
            data-testid="llm-save"
            disabled={save.isPending}
            className="rounded-sf bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {STR.adm.assistant.save}
          </button>
        </HelpTip>
        <HelpTip action="llm-test">
          <button
            type="button"
            data-testid="llm-test"
            disabled={check.isPending}
            onClick={() => check.mutate()}
            className="rounded-sf border border-line px-3 py-1.5 text-sm text-ink-2 disabled:opacity-50"
          >
            {STR.adm.assistant.test}
          </button>
        </HelpTip>
        {test ? (
          <span data-testid="llm-test-result" role="status" className="text-sm text-ink-2">
            {test}
          </span>
        ) : null}
      </div>
    </form>
  );
}

function AssistantAdminPage() {
  const view = useQuery({ queryKey: ["admin-llm"], queryFn: getAdminLlm });
  useEffect(() => {
    document.title = STR.adm.assistant.docTitle;
  }, []);
  return (
    <div className="space-y-6">
      <PageHeader
        title={STR.adm.assistant.title}
        description={STR.adm.assistant.description}
        topic="pages/admin-assistant"
      />
      {view.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorText(view.error)}
        </p>
      ) : view.data ? (
        <>
          <SettingsForm view={view.data} />
          <Usage usage={view.data.usage} />
        </>
      ) : null}
    </div>
  );
}

export function AdminAssistant() {
  return <RequireUser requireAdmin>{() => <AssistantAdminPage />}</RequireUser>;
}
